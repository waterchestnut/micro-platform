/**
 * @fileOverview 幂等键端到端取证（PR-任务编排 §5-1）：真库索引生效 + 真 HTTP 双击同 rootCode
 * @module evals/platform-probes/idempotency-e2e-probe
 * @description
 * 三道判据，各钉一层防线的**真实生效**（不是源码形状）：
 *   I0 **索引实证**：dev 存量集合上 autoIndex 可能因历史重复**建失败只打日志**——直查
 *      agentTask 的 getIndexes 断言两道 partial-unique 真在。不在，后面全白测。
 *   A  **serialized-turn 双击幂等**（0 relay）：server 开 `limits_conversationTaskQueue`；
 *      真插一条 processing 账本行让会话"忙"；同一预生成 messageCode **连发两次**真 HTTP →
 *      两次都 200 queued 且**同一 rootCode**；库里该码只一行。
 *   B  **taskMode 双击幂等**（1 次 low）：另一 server 开 planner(manual)；同一 taskCode 连发两次
 *      可拆请求 → 两次同 rootCode、第二响应 `duplicate:true`；orchestrated root 库内只 1 行。
 *      （"未二次调 planner"不靠日志计数：duplicate 只能出自预查/回查分支，顺序由源码守卫钉死。）
 * 判据数≠预期/任一 false=未通。收尾关 busy 行、杀 server、process.exit。
 * 用法：node evals/platform-probes/idempotency-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12041
const BASE = `http://127.0.0.1:${PORT}`
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: '幂等e2e' })).toString('base64')
const V = {}
const out = {}
const EXPECTED = 6

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
async function stopServer(child) { if (child && !child.killed) { child.kill(); await new Promise((r) => setTimeout(r, 1500)) } }
async function post(body) {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {'content-type': 'application/json', 'user-info': USER},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
    })
    const ct = res.headers.get('content-type') || ''
    const j = ct.includes('json') ? await res.json().catch(() => null) : null
    return { status: res.status, sse: ct.includes('text/event-stream'), data: j?.data || null, body: j }
}

let server = null
try {
    // ---------- I0 索引实证（探针进程自己 init，同一 dev 库）----------
    await import('../../init.js')
    const { AgentTask, LlmUsage } = await import('../../daos/core/schema/index.js')
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
    const { randomUUID } = await import('node:crypto')
    // autoIndex 是连接后的**异步**建索引，不能 init 完立刻断言——轮询到出现或 15s 超时（存量集合上
    // 若因历史重复建失败，这里就会超时——正是要防的"schema 写了、索引没生效"的静默态）
    let names = []
    for (let i = 0; i < 30; i++) {
        names = (await AgentTask.collection.indexes()).map((x) => x.name)
        if (names.includes('uniq_serializedTurn_messageCode') && names.includes('uniq_orchestratedRoot_idemKey')) break
        await new Promise((r) => setTimeout(r, 500))
    }
    out.indexes = names.filter((n) => n.startsWith('uniq_'))
    V['I0 两道 partial-unique 幂等索引在存量集合上真建成'] = names.includes('uniq_serializedTurn_messageCode') && names.includes('uniq_orchestratedRoot_idemKey')
    if (server) await stopServer(server)

    // ---------- A serialized-turn 双击（flag 开、0 relay） ----------
    server = startServer({ limits_conversationTaskQueue: 'true' })
    if (!await waitReady(server)) throw new Error('server A 启动超时: ' + server.log().slice(-400))
    const convA = `idem-a-${Date.now()}`
    const busyCode = `busy-${convA}`
    const sharedMsg = randomUUID().replace(/-/g, '') // 前端"预生成 messageCode"幂等通道的模拟
    await llmUsageDac.markStarted({ messageCode: busyCode, conversationCode: convA, userCode: 'menglb' })
    const reqA = { query: '幂等双击探针', conversationCode: convA, options: { channel: 'micro_common', protocol: 2, messageCode: sharedMsg } }
    const a1 = await post(reqA)
    const a2 = await post(reqA)
    if (!a1.data || a2.data?.queued !== true) out.AserverLog = server.log().split('\n').filter((l) => /同会话|入队|拒绝|overlap|Error|error/.test(l)).slice(-8)
    const rowsA = await dac.getTop(10, { complexFilter: { conversationCode: convA, agentRole: 'serialized-turn', 'params.messageCode': sharedMsg } }, { insertTime: 1 })
    out.A = { r1: {st: a1.status, sse: a1.sse, d: a1.data}, r2: {st: a2.status, sse: a2.sse, d: a2.data}, dbRows: rowsA.length }
    V['A1 两次都 200 queued 且同一 rootCode'] = a1.data?.queued === true && a2.data?.queued === true
        && !!a1.data?.rootCode && a1.data.rootCode === a2.data.rootCode
    V['A2 库内该 messageCode 仅 1 行（幂等生效非巧合）'] = rowsA.length === 1 && rowsA[0].agentCode === a1.data?.rootCode
    V['A3 第二次响应如实标 idempotent'] = a2.data?.idempotent === true && a1.data?.idempotent !== true
    await AgentTask.collection.deleteMany({ conversationCode: convA }).catch(() => {})
    await LlmUsage.updateOne({ messageCode: busyCode }, { $set: { progress: 'finish', updateTime: new Date() } }).catch(() => {})
    await stopServer(server); server = null

    // ---------- B taskMode 同 taskCode 双击（planner 开、1 次模型调用） ----------
    server = startServer({ agentTask_fanOutPlanner: 'true', agentTask_fanOutPlannerHandleMode: 'manual' })
    if (!await waitReady(server)) throw new Error('server B 启动超时: ' + server.log().slice(-400))
    const convB = `idem-b-${Date.now()}`
    const taskCode = `tc-${Date.now()}-x1`
    const reqB = {
        query: '请分别说明 TCP 三次握手的过程和 TCP 流量控制的作用，最后各给一句适用场景。',
        conversationCode: convB,
        options: { channel: 'micro_common', protocol: 2, taskMode: true, taskCode },
    }
    const b1 = await post(reqB)
    const b2 = await post(reqB)
    const rootsB = await dac.getTop(10, { complexFilter: { conversationCode: convB, agentRole: 'root', orchestrated: true } }, { insertTime: 1 })
    out.B = { r1: { accepted: b1.data?.taskAccepted, root: b1.data?.rootCode }, r2: { accepted: b2.data?.taskAccepted, root: b2.data?.rootCode, dup: b2.body?.duplicate ?? b2.data?.duplicate }, dbRoots: rootsB.length }
    V['B1 同 taskCode 两次都受理且同一 rootCode、库内仅 1 棵树'] = b1.data?.taskAccepted === true && b2.data?.taskAccepted === true
        && !!b1.data?.rootCode && b1.data.rootCode === b2.data.rootCode && rootsB.length === 1
    // 确定性判据：`duplicate:true` **只能**出自"planner 前预查命中 / E11000 回查"两条分支
    // （分支顺序由 fanOutWire 源码守卫钉"预查在 planFanOutSubtasks 之前"），故无需依赖子进程日志管道。
    V['B2 第二次是幂等命中（duplicate 标只能出自 planner 前预查/竞态回查，源码守卫证序）'] = b2.data?.duplicate === true && rootsB.length === 1
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
}

await stopServer(server)
const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '幂等键 e2e 通过(索引生效/追问双击同根/taskMode 双击单树单规划)' : '未通(见 false 项)'
console.log('\n==== IDEMPOTENCY E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
