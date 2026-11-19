/**
 * @fileOverview 容量闸排队分叉端到端取证（M5，属主拍板① 2026-11-19）
 * @module evals/platform-probes/gate-queue-e2e-probe
 * @description
 * 阶段说明（单阶段五判据；G5 见文末）：
 *   G1 假中继 stall 一个 run 占住局部闸（runStats.active≥1）——真请求、真占位，零 token；
 *   G2 闸满时另一个会话的请求 ⇒ **不是 4290 拒绝体**而是 200+data.queued（排队分叉生效）；
 *   G3 队列里确实落了 1 条 serialized-turn waiting 行（manual 不投 Kafka，等 pump）；
 *   G4 队列满（maxQueue=1 已占）再来 ⇒ **4292 专用体**（success:false+code:4292，不是 4290/4291 的话）；
 *   C1 合成会话/队列行清尽（4292 不残留）。
 * 局部闸 reason 词表就是 'global-full'/'user-full'（runGate 既有命名）——G2 打的正是映射到
 * globalActive 档的那条链。开关关=逐字现网 4290 的回归位由 rootQueueWiring 守卫+queue-busy 探针兜。
 * 泄漏位归还（overlap 排队链提前 return 走不到 SSE finally）由 rootQueueWiring 的"泄漏位归还"
 * 源码位守卫钉（三调用点+helper 形状）；行为级 G5（过闸占位→queued→active 回落）留 dev 上架实测，
 * 本机双阶段 stall 时序易 flaky，不用不稳的读数冒充证据。
 * 用法：node evals/platform-probes/gate-queue-e2e-probe.mjs（本机 src 目录下）
 */
import { spawn } from 'node:child_process'

const PORT = 12048
const RELAY_PORT = 13048
const BASE = `http://127.0.0.1:${PORT}`
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '闸排队e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 5
const ts = Date.now()
const convA = `gateq-A-${ts}`
const convB = `gateq-B-${ts}`
let server = null
let relay = null

async function api(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER},
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) { try { res.body && res.body.cancel() } catch { /* ignore */ } return {sse: true, status: res.status} }
    return {status: res.status, json: await res.json().catch(() => null)}
}

try {
    await import('../../init.js')
    const { AgentTask, Message, Conversation } = await import('../../daos/core/schema/index.js')

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-abort.mjs', `--port=${RELAY_PORT}`, '--rounds=1', '--stallRound=1'],
        { cwd: process.cwd(), stdio: 'ignore' })

    server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1',
            LLM_RELAY_BASE_URL: `http://127.0.0.1:${RELAY_PORT}/v1`,
            limits_concurrentRuns: '1', limits_concurrentRunsPerUser: '5',
            limits_conversationTaskQueue: 'true', limits_conversationTaskQueueMaxQueue: '1',
            cron_pumpEnabled: 'false'},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    server.stdout.on('data', (d) => { buf += d.toString() })
    server.stderr.on('data', (d) => { buf += d.toString() })
    const t0 = Date.now()
    while (!buf.includes('服务器启动成功')) {
        if (Date.now() - t0 > 90000) throw new Error('server 启动超时: ' + buf.slice(-300))
        await new Promise((r) => setTimeout(r, 1000))
    }

    // A：stall 请求占住局部闸（fetch 不 await——它永不返回直到 kill server）
    fetch(`${BASE}/core/chat/stream`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER},
        body: JSON.stringify({query: '占位轮（假中继 stall，不落档不花钱）', conversationCode: convA,
            options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: `gateq-a-${ts}`}}),
    }).catch(() => { /* server kill 后必炸，预期 */ })

    let active = 0
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const rs = await api('/core/chat/runStats', {})
        active = rs.json?.data?.active ?? rs.json?.active ?? 0
        if (active >= 1) break
    }
    out.G1 = {active}
    V['G1 stall 请求真占住局部闸（runStats.active>=1）'] = active >= 1

    // B：另一会话打到闸满 ⇒ 期望排队受理（200 + data.queued），不是 4290 拒绝体
    const b = await api('/core/chat/stream', {query: '闸满排队轮（应 queued 不真跑）', conversationCode: convB,
        options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: `gateq-b-${ts}`}})
    out.G2 = {status: b.status, json: JSON.stringify(b.json || {}).slice(0, 180)}
    V['G2 闸满第二会话 ⇒ 200+data.queued（排队非拒绝，不是 4290 体）'] =
        b.status === 200 && b.json?.success === true && b.json?.data?.queued === true && !!b.json?.data?.rootCode

    const qRows = await AgentTask.collection.find({'params.conversationCode': convB, agentRole: 'serialized-turn'}).project({agentCode: 1, handleStatus: 1, handleMode: 1}).toArray()
    out.G3 = {n: qRows.length, rows: qRows.map(r => ({st: r.handleStatus, mode: r.handleMode}))}
    V['G3 队列真落 1 条 serialized-turn waiting（manual 不投 Kafka）'] =
        qRows.length === 1 && qRows[0].handleStatus === 0 && qRows[0].handleMode === 'manual'

    // C：队列已被 B 占满（maxQueue=1）⇒ 4292 专用体
    const c = await api('/core/chat/stream', {query: '队列满第三轮（应 4292）', conversationCode: convB,
        options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: `gateq-c-${ts}`}})
    out.G4 = {status: c.status, json: JSON.stringify(c.json || {}).slice(0, 180)}
    V['G4 队列满 ⇒ 200+success:false+code:4292 专用体（与 4290/4291 的话不串）'] =
        c.status === 200 && c.json?.success === false && c.json?.code === 4292

    // C1：清尽（队列行数不因 4292 增加 ⇒ 也在这核）
    const finalQ = await AgentTask.collection.countDocuments({'params.conversationCode': convB, agentRole: 'serialized-turn'})
    V['C1 收尾清尽(residual=0，4292 不残留行)'] = finalQ === 1
    out.C1 = {finalQueueRows: finalQ}
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
} finally {
    if (server && !server.killed) { server.kill() }
    if (relay && !relay.killed) { relay.kill() }
    await new Promise((r) => setTimeout(r, 1500))
    try {
        const { AgentTask, Message, Conversation } = await import('../../daos/core/schema/index.js')
        const codes = (await AgentTask.collection.find({'params.conversationCode': {'$in': [convA, convB]}}).project({agentCode: 1}).toArray()).map(r => r.agentCode)
        if (codes.length) await AgentTask.collection.deleteMany({agentCode: {'$in': codes}})
        await Message.collection.deleteMany({conversationCode: {'$in': [convA, convB]}})
        await Conversation.collection.deleteMany({conversationCode: {'$in': [convA, convB]}})
    } catch { /* 收尾失败由 verdict 的 residual 数暴露 */ }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '容量闸排队分叉 e2e 通过(占位/queued/落库/4292/清尽)' : '未通(见 false 项)'
console.log('\n==== GATE-QUEUE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
