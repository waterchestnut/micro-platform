/**
 * @fileOverview 队列第二入口端到端取证（开闸测验实锤的洞：长任务追问该排队不该并发）
 * @module evals/platform-probes/queue-busy-e2e-probe
 * @description
 * 真 HTTP + 真库（3 次请求，1 次小 relay）：
 *   Q1 上一轮 processing、insertTime 已过 overlap 窗(5s>1.5s)、心跳新鲜 ⇒ 追问回 **queued**
 *      （修复前这里是 stale-open-run 放行 ⇒ 同会话并发双跑——2026-11-19 开闸实测抓到的洞）
 *   Q2 队列已满(maxQueue=1) ⇒ 第二入口同样落 **4292 专用体**（与第一入口同码同体）
 *   Q3 心跳变僵尸(updateTime 60s>staleMs 45s) ⇒ 维持放行（SSE 真起流，读首帧即掐——僵尸不锁死会话）
 *   Q4 入队行是 serialized-turn + handleMode manual（不投 kafka，pump 已关防真执行）
 * server env：limits_conversationTaskQueue=true + MaxQueue=1 + cron_pumpEnabled=false。
 * 收尾按血统清尽（agentTask/llmUsage/message/conversation residual=0 是判据）。
 * 用法：node evals/platform-probes/queue-busy-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12046
const BASE = `http://127.0.0.1:${PORT}`
const USER = (c) => Buffer.from(JSON.stringify({userCode: c, realName: '排队e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 5
const ts = Date.now()
const conv = `qbusy-${ts}`
const busyCode = `qbusy-prev-${ts}`
let server = null
let AgentTask = null, LlmUsage = null, Message = null, Conversation = null
let msgA = null, msgB = null

async function apiRaw(body, user = 'menglb') {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER(user)},
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('json')) { const j = await res.json().catch(() => null); return {sse: false, status: res.status, j} }
    // SSE：读首帧就掐（Q3 的 pass 证明；abort 温和收尾）
    try { const rd = res.body.getReader(); await Promise.race([rd.read(), new Promise((r) => setTimeout(r, 8000))]); rd.cancel() } catch { /* 掐失败无所谓 */ }
    return {sse: true, status: res.status}
}

try {
    await import('../../init.js')
    const si = await import('../../daos/core/schema/index.js')
    AgentTask = si.AgentTask; LlmUsage = si.LlmUsage; Message = si.Message; Conversation = si.Conversation
    const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const {randomUUID} = await import('node:crypto')

    server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1',
            limits_conversationTaskQueue: 'true', limits_conversationTaskQueueMaxQueue: '1', cron_pumpEnabled: 'false'},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    server.stdout.on('data', (d) => { buf += d.toString() })
    server.stderr.on('data', (d) => { buf += d.toString() })
    const t0 = Date.now()
    while (!buf.includes('服务器启动成功')) {
        if (Date.now() - t0 > 90000) throw new Error('server 启动超时')
        await new Promise((r) => setTimeout(r, 1000))
    }

    // 上一轮"真在跑"：processing 行，insertTime 拨到 5s 前（过 overlap 1.5s 窗），心跳保持新鲜
    await llmUsageDac.markStarted({messageCode: busyCode, conversationCode: conv, userCode: 'menglb'})
    await LlmUsage.collection.updateOne({messageCode: busyCode},
        {$set: {insertTime: new Date(Date.now() - 5000), updateTime: new Date()}})

    msgA = randomUUID().replace(/-/g, '')
    msgB = randomUUID().replace(/-/g, '')
    const mk = (mc, q) => ({query: q, conversationCode: conv, options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: mc}})

    const r1 = await apiRaw(mk(msgA, '用一句话回答：31-7 等于几？'))
    out.Q1 = r1
    V['Q1 心跳新鲜的 stale-open-run ⇒ 追问 queued（第二入口接管，不再并发双跑）'] =
        !r1.sse && r1.j?.success === true && r1.j?.data?.queued === true && r1.j?.data?.queuePosition === 1 && !!r1.j?.data?.rootCode

    const r2 = await apiRaw(mk(msgB, '用一句话回答：6×6 等于几？'))
    out.Q2 = {sse: r2.sse, code: r2.j?.code, msg: r2.j?.message || r2.j?.msg, data: r2.j?.data}
    V['Q2 队列满(maxQueue=1) ⇒ 4292 专用体（第二入口同码同体）'] =
        !r2.sse && r2.j?.success === false && r2.j?.code === 4292 && r2.j?.data?.reason === 'queue-full' && r2.j?.data?.active === 1

    // 僵尸化：心跳拨旧到 staleMs(45s) 之外 ⇒ 维持放行（真起流，读首帧掐掉——1 次小 relay）
    await LlmUsage.collection.updateOne({messageCode: busyCode},
        {$set: {updateTime: new Date(Date.now() - 60000)}})
    const r3 = await apiRaw(mk(randomUUID().replace(/-/g, ''), '用一句话回答：1+1 等于几？'))
    out.Q3 = r3
    V['Q3 心跳僵尸(>staleMs) ⇒ 维持放行真起流（僵尸不锁死会话）'] = r3.sse === true && r3.status === 200

    const queuedRow = await dac.getByCode(r1.j?.data?.rootCode)
    V['Q4 入队行 serialized-turn + handleMode manual（不投 kafka 不真执行）'] =
        queuedRow?.agentRole === 'serialized-turn' && queuedRow?.handleMode === 'manual' && queuedRow?.handleStatus === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    if (server && !server.killed) { server.kill(); await new Promise((r) => setTimeout(r, 1500)) }
    try {
        await AgentTask.collection.deleteMany({conversationCode: conv})
        const convsAll = [conv, `root:${(out.Q1 && out.Q1.j?.data?.rootCode) || 'none'}`, `agent:${msgA}`, `agent:${msgB}`]
        await LlmUsage.collection.deleteMany({$or: [{messageCode: {$in: [busyCode, msgA, msgB]}}, {conversationCode: {$in: convsAll}}]})
        await Message.collection.deleteMany({conversationCode: {$in: [...convsAll, busyCode]}})
        await Message.collection.deleteMany({messageCode: {$in: [busyCode, msgA, msgB]}})
        await Conversation.collection.deleteMany({conversationCode: {$in: convsAll}})
        const residual = await AgentTask.collection.countDocuments({conversationCode: conv})
            + await LlmUsage.collection.countDocuments({$or: [{messageCode: {$in: [busyCode, msgA, msgB]}}, {conversationCode: conv}]})
            + await Message.collection.countDocuments({conversationCode: {$in: [conv, ...convsAll]}})
            + await Conversation.collection.countDocuments({conversationCode: {$in: convsAll}})
        out.residual = residual
        if (!out.错误) V['C1 四表按血统清尽(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '队列第二入口 e2e 通过(心跳新鲜排队/满则4292/僵尸放行/manual不投kafka/清尽)' : '未通(见 false 项)'
console.log('\n==== QUEUE-BUSY E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
