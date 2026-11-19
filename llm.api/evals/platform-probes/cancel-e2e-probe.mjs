/**
 * @fileOverview 任务取消端到端取证（PR-任务编排 §5-2）：真 HTTP 走完"入队→取消→幂等/越权/在途不覆盖"
 * @module evals/platform-probes/cancel-e2e-probe
 * @description
 * 全链真库真路由，**零 relay**（排队轮不执行、树不开跑；在途行用置 1 模拟而非真跑——引擎无把手，
 * 取消语义本来就是"不覆盖在途行"，无需模型参与）。钉五条判据：
 *   K1 排队轮经真 HTTP 入队（busy 行挡道）⇒ queued；
 *   K2 本人取消 ⇒ code 0、行 -1 + cancelNote、**再取消 already-terminal（幂等）**；
 *   K3 非本人取消 ⇒ 403（归属 fail-closed 走真 HTTP 状态码，不是 200 假成功）；
 *   K4 未开跑的编排树取消 ⇒ waiting children 全 -1、root 3 + orchestration.cancelled；
 *   K5 树里 handling(1) 行 ⇒ runningNoted 计数但**行不被覆盖**（还在 1）；legacy root（无 orchestrated）⇒ scope-reject。
 * server 以 limits_conversationTaskQueue=true 起（其余 flag 不动=扇出/追活链路不受影响）。
 * 收尾删净自造行（agentTask 按会话系、llmUsage 按 messageCode 精确），显式 process.exit。
 * 用法：node evals/platform-probes/cancel-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12042
const BASE = `http://127.0.0.1:${PORT}`
const USER = (code) => Buffer.from(JSON.stringify({ userCode: code, realName: '取消e2e' })).toString('base64')
const V = {}
const out = {}
const EXPECTED = 8

function startServer(envExtra) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1', ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', (d) => { buf += d.toString() })
    child.stderr.on('data', (d) => { buf += d.toString() })
    child.log = () => buf
    return child
}
async function waitReady(child, ms = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (child.log().includes('服务器启动成功')) return true
        await new Promise((r) => setTimeout(r, 1000))
    }
    return false
}
async function stopServer(c) { if (c && !c.killed) { c.kill(); await new Promise((r) => setTimeout(r, 1500)) } }
async function api(path, body, userCode) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-info': USER(userCode) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    })
    const ct = res.headers.get('content-type') || ''
    const j = ct.includes('json') ? await res.json().catch(() => null) : null
    return { status: res.status, json: j, data: j?.data ?? null }
}

let server = null
const cleanup = { convs: [], msgCodes: [] }
let AgentTask = null, LlmUsage = null
let probeError = null
try {
    await import('../../init.js')
    const schemaIndex = await import('../../daos/core/schema/index.js')
    AgentTask = schemaIndex.AgentTask
    LlmUsage = schemaIndex.LlmUsage
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
    const { addAgentTask } = await import('../../services/core/agentTask.js')
    const { buildRootTask, buildSerializedTurnTask } = await import('../../services/core/session/taskQueueComposer.js')
    const { randomUUID } = await import('node:crypto')

    server = startServer({ limits_conversationTaskQueue: 'true' })
    if (!await waitReady(server)) throw new Error('server 启动超时: ' + server.log().slice(-400))

    // ---------- K1/K2/K3 排队追问轮：真 HTTP 入队 → 本人取消 → 再取消 → 非本人 ----------
    const convA = `cxl-turn-${Date.now()}`
    const busy = `busy-${convA}`
    await llmUsageDac.markStarted({ messageCode: busy, conversationCode: convA, userCode: 'menglb' })
    cleanup.msgCodes.push(busy)
    const sharedMsg = randomUUID().replace(/-/g, '')
    const q = await api('/core/chat/stream', { query: '取消探针追问', conversationCode: convA, options: { channel: 'micro_common', protocol: 2, messageCode: sharedMsg } }, 'menglb')
    cleanup.convs.push(convA)
    V['K1 排队经真 HTTP 受理(queued)'] = q.status === 200 && q.data?.queued === true && !!q.data?.rootCode
    const turnCode = q.data?.rootCode

    const c1 = await api('/core/agentTask/cancel', { agentCode: turnCode }, 'menglb')
    const row1 = turnCode ? await dac.getByCode(turnCode) : null
    out.C1 = { code: c1.json?.code, d: c1.data, row: row1 && { s: row1.handleStatus, note: row1.handleRet?.cancelNote } }
    V['K2 本人取消⇒行置-1带cancelNote;再取消 already-terminal(幂等)'] = c1.json?.code === 0 && c1.data?.aborted === 1
        && row1?.handleStatus === -1 && row1?.handleRet?.cancelNote === 'user-cancelled'
    const c1b = await api('/core/agentTask/cancel', { agentCode: turnCode }, 'menglb')
    V['K2b 二次取消如实 already-terminal 不装再次成功'] = c1b.json?.code === -1 && c1b.data?.reason === 'already-terminal'

    // K3 非本人：再造一条排队行（直接 in-proc 落库，归属 menglb），用 attacker 取消
    const t2 = buildSerializedTurnTask({ conversationCode: convA, messageCode: `m-${randomUUID()}`, query: 'q', operator: { userCode: 'menglb' }, handler: 'turnRunner' })
    await addAgentTask(t2)
    const c3 = await api('/core/agentTask/cancel', { agentCode: t2.agentCode }, 'attacker-zzz')
    const row3 = await dac.getByCode(t2.agentCode)
    V['K3 非本人取消⇒403 且行未动'] = c3.status === 403 && row3?.handleStatus === 0

    // ---------- K4/K5 编排树：未开跑整树取消 + handling 不覆盖 + legacy 拒绝 ----------
    const convB = `cxl-tree-${Date.now()}`
    const root = buildRootTask({
        conversationCode: convB, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: [
            { title: 'A', query: 'qa', handler: 'agentChat' },
            { title: 'B', query: 'qb', handler: 'agentChat' },
        ],
        operator: { userCode: 'menglb' },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    cleanup.convs.push(convB)
    // 把一个 child 置 handling(1)：模拟"在途"——取消不许覆盖它（引擎无把手强停）
    const [subA] = root.subAgents
    await dac.update({ handleStatus: 1 }, { agentCode: subA.agentCode })
    const c4 = await api('/core/agentTask/cancel', { agentCode: root.agentCode }, 'menglb')
    const freshRoot = await dac.getByCode(root.agentCode)
    const rowsB = []
    for (const s of (freshRoot.subAgents || [])) rowsB.push(await dac.getByCode(s.agentCode))
    out.C4 = { code: c4.json?.code, d: c4.data, rootS: freshRoot.handleStatus, orch: freshRoot.handleRet?.orchestration, kids: rowsB.map((r) => r.handleStatus) }
    V['K4 树取消⇒waiting 全-1、root 3 且 orchestration.cancelled'] = c4.json?.code === 0 && c4.data?.aborted === 1
        && freshRoot.handleStatus === 3 && freshRoot.handleRet?.orchestration?.cancelled === true
        && rowsB.filter((r) => r.handleStatus === -1).length === 1
    V['K5 handling 行只计数不覆盖(仍=1) + runningNoted=1'] = c4.data?.runningNoted === 1
        && rowsB.some((r) => r.agentCode === subA.agentCode && r.handleStatus === 1)
    const legacy = buildRootTask({ conversationCode: convB, agentType: 'parallel', handler: 'parallelDispatch', subtasks: [], operator: { userCode: 'menglb' }, extra: { handleMode: 'manual' } })
    await addAgentTask(legacy)
    const c5 = await api('/core/agentTask/cancel', { agentCode: legacy.agentCode }, 'menglb')
    V['K5b 存量/非编排 root ⇒ scope-reject（不碰别人状态机）'] = c5.json?.code === -1 && c5.data?.reason === 'scope-reject'
        && (await dac.getByCode(legacy.agentCode))?.handleStatus === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    await stopServer(server)
    // 清理自造行：agentTask 按会话系全删（含 root/children/turn），llmUsage 按精确 messageCode 删
    try {
        for (const conv of cleanup.convs) await AgentTask.collection.deleteMany({ conversationCode: conv })
        let left = 0
        for (const conv of cleanup.convs) left += await AgentTask.collection.countDocuments({ conversationCode: conv })
        if (cleanup.msgCodes.length) await LlmUsage.deleteMany({ messageCode: { $in: cleanup.msgCodes } })
        out.cleanup = { residualAgentRows: left }
        V['K6 自造行清尽(residual=0)'] = left === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '取消链路 e2e 通过(幂等/越权403/在途不覆盖/存量免疫/零残留)' : '未通(见 false 项)'
console.log('\n==== CANCEL E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
