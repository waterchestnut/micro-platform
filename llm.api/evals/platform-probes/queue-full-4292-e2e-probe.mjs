/**
 * @fileOverview 4292 队列满专用响应体端到端取证（PR-任务编排 M8 刀三解锁件）
 * @module evals/platform-probes/queue-full-4292-e2e-probe
 * @description
 * 钉的是"话说对"这一格：队列满的拒绝必须带 4292 专用体（rejectQueueFull 单源），
 * 不能再落回 4291 的"上一条还在处理中"——两句是两种事实，前端分不开就会把
 * "排满了"演成"等一会儿"（用户等不到，因为要等的根本不是那一条）。
 *   Q1 第一条追问 ⇒ 200 queued position 1（maxQueue=1，0 relay——busy 行 markStarted 造真忙）
 *   Q2 第二条追问 ⇒ HTTP **200** + success:false + **code:4292** + "排队已满"字样
 *      + data{reason:'queue-full', active:1, limit:1}；判别负断言：4291 的文案与码**不许出现**
 *   Q3 库内 serialized-turn 恰 1 行 ⇒ 4292 拒绝不留排队残行（拒了就什么都没受理）
 *   C1 收尾清尽（agentTask/llmUsage residual=0）
 * server 以 limits_conversationTaskQueue=true + MaxQueue=1 + cron_pumpEnabled=false 起
 * （泵关掉：探针的排队行不许被真执行烧 relay）。
 * 用法：node evals/platform-probes/queue-full-4292-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12045
const BASE = `http://127.0.0.1:${PORT}`
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '队列满e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 4

function startServer(envExtra) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1', ...envExtra},
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
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER},
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    const ct = res.headers.get('content-type') || ''
    const j = ct.includes('json') ? await res.json().catch(() => null) : null
    return {status: res.status, sse: ct.includes('text/event-stream'), data: j?.data || null, body: j}
}

let server = null
const ts = Date.now()
const conv = `q4292-${ts}`
const busyCode = `q4292busy-${ts}`
let AgentTask = null, LlmUsage = null

try {
    await import('../../init.js')
    const si = await import('../../daos/core/schema/index.js')
    AgentTask = si.AgentTask; LlmUsage = si.LlmUsage
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
    const {randomUUID} = await import('node:crypto')

    server = startServer({
        limits_conversationTaskQueue: 'true',
        limits_conversationTaskQueueMaxQueue: '1',
        cron_pumpEnabled: 'false', // 排队行不被泵排水（否则真执行烧 relay、判据窗口被搬走）
    })
    if (!await waitReady(server)) throw new Error('server 启动超时: ' + server.log().slice(-400))

    // 真忙：processing 账本行让 runOverlap 判 admit:false（与 idempotency 探针 A 段同款）
    await llmUsageDac.markStarted({messageCode: busyCode, conversationCode: conv, userCode: 'menglb'})
    const mk = (tag) => ({
        query: `队列满探针 ${tag}`, conversationCode: conv,
        options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: randomUUID().replace(/-/g, '')},
    })

    const q1 = await post(mk('A'))
    const q2 = await post(mk('B'))
    out.Q = {q1: {st: q1.status, sse: q1.sse, d: q1.data}, q2: {st: q2.status, sse: q2.sse, d: q2.data, body: q2.body}}

    V['Q1 第一条追问 ⇒ queued position 1'] = q1.status === 200 && !q1.sse
        && q1.data?.queued === true && q1.data?.queuePosition === 1 && !!q1.data?.rootCode
    // 话必须对题：4292 专用体（200+success:false 通道，非 2xx 各端读不到体）；4291 的文案/码不许出现
    V['Q2 第二条 ⇒ 200+4292 专用体"排队已满"，4291 话不串体'] = q2.status === 200 && !q2.sse
        && q2.body?.success === false && q2.body?.code === 4292
        && /排队已满/.test(String(q2.body?.message || '') + String(q2.body?.msg || ''))
        && q2.body?.data?.reason === 'queue-full' && q2.body?.data?.active === 1 && q2.body?.data?.limit === 1
        && !/上一条还在处理中/.test(JSON.stringify(q2.body))
    const rows = await dac.getTop(10, {complexFilter: {conversationCode: conv, agentRole: 'serialized-turn'}}, {insertTime: 1})
    V['Q3 4292 不留排队残行（库内 serialized-turn 恰 1）'] = rows.length === 1 && rows[0].agentCode === q1.data?.rootCode
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
    if (server?.log) out.tailLog = server.log().split('\n').filter((l) => /同会话|排队|拒绝|overlap|Error/.test(l)).slice(-8)
} finally {
    await stopServer(server)
    try {
        await AgentTask.collection.deleteMany({conversationCode: conv})
        await LlmUsage.collection.deleteMany({messageCode: busyCode})
        const residual = await AgentTask.collection.countDocuments({conversationCode: conv})
            + await LlmUsage.collection.countDocuments({messageCode: busyCode})
        out.residual = residual
        if (!out.错误) V['C1 收尾清尽(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '4292 专用体 e2e 通过(queued 位次/对题拒绝体/不残留/清尽)' : '未通(见 false 项)'
console.log('\n==== QUEUE-FULL 4292 E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
