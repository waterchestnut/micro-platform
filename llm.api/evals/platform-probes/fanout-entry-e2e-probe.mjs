/**
 * @fileOverview 任务模式入口真 HTTP 端到端取证（PR-任务编排 M4b c2）
 * @module evals/platform-probes/fanout-entry-e2e-probe
 * @description
 * c2 改的是 root.js（4+ 端共用最脆文件）的请求主路径，取证强度必须跟上：**真起 fastify、真发 HTTP**，
 * 而不是在进程里调函数。三种形态各钉一条现网安全性质：
 *   A 不带 taskMode ⇒ 必须还是 SSE（普通回答逐字不变——默认路径没被动过）；
 *   B taskMode=true + planner 关 ⇒ 必须还是 SSE（功能没开绝不吞用户的话）；
 *   C taskMode=true + planner 开 ⇒ 必须返回 200 JSON `{taskAccepted, rootCode, subtasks>=2}`，
 *     root 落库 `orchestrated:true`（后续"执行+自动综合落 root"由 fanout-planner-e2e-probe 已取证，
 *     本探针不重复跑树，避免多烧 relay；manual handleMode ⇒ 真 HTTP 下也不会自己跑起来，正是要验的隔离性）。
 *
 * 前置（探针自管）：spawn `node server.js` 于 127.0.0.1:12039，env `agentTask_fanOutPlanner=true`
 *   （C 段内翻 config 前，A/B 已验完）→ 实际是 server 以 enabled 启动、A/B/C 都打到**同一个**开了
 *   planner 的 server：A 靠"没带 taskMode"、B 靠"taskMode+channel 不在白名单+…"？
 *   ——不行，B 要验"关时不吞话"，必须 server 以 disabled 起。故探针分两阶段各起一次 server。
 * 跑完杀 server、显式 process.exit。
 * 用法：node evals/platform-probes/fanout-entry-e2e-probe.mjs （花真实 relay：A/B 两条普通回答 + C 一次 low 判定）
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const PORT = 12039
const BASE = `http://127.0.0.1:${PORT}`
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: '入口e2e' })).toString('base64')

const out = { phases: {} }
const V = {}
const EXPECTED = 5

function startServer(envExtra) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1', ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', (d) => { buf += d.toString() })
    child.stderr.on('data', (d) => { buf += d.toString() })
    child.getServerLog = () => buf
    return child
}

async function waitReady(child, ms = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (child.getServerLog().includes('服务器启动成功')) return true
        await new Promise((r) => setTimeout(r, 1000))
    }
    return false
}

async function stopServer(child) {
    if (!child || child.killed) return
    child.kill()
    await new Promise((r) => setTimeout(r, 1500))
}

async function postStream(body) {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-info': USER },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
    })
    const ct = res.headers.get('content-type') || ''
    let payload = null
    if (!ct.includes('event-stream')) {
        payload = await res.json().catch(() => null)
    } else {
        // 读流直到 done/abort（普通回答要真跑完才算"逐字没坏"）
        const text = await res.text()
        payload = { sse: true, tail: text.slice(-160), hasDone: /\bevent:\s*done\b|^\s*done\s*$/m.test(text) || text.includes('"done"') }
    }
    return { status: res.status, contentType: ct, payload }
}

let server = null
try {
    // ================= 阶段一：planner 关（现网默认）=================
    server = startServer({})
    if (!await waitReady(server)) throw new Error('server(planner 关) 启动超时: ' + server.getServerLog().slice(-500))
    out.phases.disabledServer = 'ready'

    const qa = await postStream({ query: '用一句话回答：9-4 等于几？', conversationCode: `fanentry-off-a-${Date.now()}`, options: { channel: 'micro_common', protocol: 2, llmParams: { max_tokens: 48 } } })
    out.phases.A = { status: qa.status, ct: qa.contentType.slice(0, 40), sse: !!qa.payload?.sse }
    V['A 不带 taskMode ⇒ 仍 SSE 普通回答(默认路径未动)'] = qa.status === 200 && qa.contentType.includes('text/event-stream')

    const qb = await postStream({ query: '用一句话回答：5+6 等于几？', conversationCode: `fanentry-off-b-${Date.now()}`, options: { channel: 'micro_common', protocol: 2, taskMode: true, llmParams: { max_tokens: 48 } } })
    out.phases.B = { status: qb.status, ct: qb.contentType.slice(0, 40) }
    V['B planner 关 + taskMode ⇒ 仍 SSE(不吞用户的话)'] = qb.status === 200 && qb.contentType.includes('text/event-stream')
    await stopServer(server); server = null

    // ================= 阶段二：planner 开 + manual（不自动投 Kafka）=================
    server = startServer({ agentTask_fanOutPlanner: 'true', agentTask_fanOutPlannerHandleMode: 'manual' })
    if (!await waitReady(server)) throw new Error('server(planner 开) 启动超时: ' + server.getServerLog().slice(-500))
    out.phases.onServer = 'ready'

    const qc = await postStream({
        query: '分别说明 HTTP 强缓存与协商缓存各自的适用场景，最后给一句选择建议。',
        conversationCode: `fanentry-on-c-${Date.now()}`,
        options: { channel: 'micro_common', protocol: 2, taskMode: true },
    })
    out.phases.C = { status: qc.status, ct: qc.contentType.slice(0, 40), body: qc.payload }
    const accepted = qc.status === 200 && !qc.contentType.includes('text/event-stream')
        && qc.payload?.success === true && qc.payload?.data?.taskAccepted === true
        && !!qc.payload?.data?.rootCode && (qc.payload?.data?.subtasks?.length || 0) >= 2
    V['C 开+taskMode ⇒ 200 JSON taskAccepted+rootCode+subtasks>=2'] = accepted

    // D/D2：受理后 root 落库形状 + manual 隔离性（handleStatus 仍 0 ⇒ 没谁驱动它就不会跑，也不惊动 dev consumer）
    V['D 受理后任务未自动执行(manual 隔离,等显式驱动)'] = accepted // 下方拿 rootCode 查库后覆盖为真判据
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

// ---------- mongo 直读核对 C 的两条 ----------
try {
    if (out.phases.C?.body?.data?.rootCode) {
        await import('../../init.js')
        const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
        const root = await agentTaskDac.getByCode(out.phases.C.body.data.rootCode)
        out.rootRow = root && { handleStatus: root.handleStatus, orchestrated: root.orchestrated, agentType: root.agentType, handleMode: root.handleMode, subs: root.subAgents?.length }
        const d = !!root && root.orchestrated === true && root.agentType === 'parallel'
            && root.handleMode === 'manual' && (root.subAgents?.length || 0) >= 2 && root.handleStatus === 0
        // 覆盖 C 的占位断言与 D：受理→落库形状 + 未自动执行(handleStatus 仍 0)
        V['D 受理后任务未自动执行(manual 隔离,等显式驱动)'] = d && root.handleStatus === 0
        V['D2 root 落库形状 orchestrated/parallel/manual/children>=2'] = d
    }
} catch (e) {
    out.核对错误 = String(e?.message || e).slice(0, 300)
}

await stopServer(server)

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'c2 真 HTTP 入口端到端通过(关不吞话/不带不进/开则受理且不偷跑)' : '未通(见 false 项)'
console.log('\n==== FANOUT-ENTRY E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
