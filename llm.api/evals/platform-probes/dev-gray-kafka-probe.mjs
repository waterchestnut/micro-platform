/**
 * @fileOverview dev 开闸批④验证探针——finalize 走 kafka 的生产形态端到端
 * @module evals/platform-probes/dev-gray-kafka-probe
 * @description
 * 读数逻辑（唯一能"由结果证过程"的形态声明）：dispatch=kafka 时 finalize 只有一条路——
 * `dispatchFanOutFinalize` sendMessage 投 agent-task topic → executor consumer
 * `execAgentTask`（内存形状）执行 → 写回 root。**投递/消费/执行任何一段断 ⇒ root 永远
 * 没有 orchestration 写回**。所以"写回存在且 synthesize"就是三段全通的证明，不需要读 pod 日志。
 * 判据：
 *   K0 扇出受理（≤3 试，planner 判定入口家规）；
 *   K1 kafka 链写回：root orchestration.action=synthesize + synthesis.usable（executor 消费执行）；
 *   K2 宽限窗账锚（批②功能在 kafka 形态下照常）：synth-timer 行 dueAt-insert ∈ [44s,60s]、
 *      settle 距 dueAt ≤ 120s（cron 泵派发重算在 executor 之外，链路独立，一并验）；
 *   K3 清账。
 * 用法：node evals/platform-probes/dev-gray-kafka-probe.mjs（src 下；真 relay token 少量）
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'https://api.xxzx.paretop.net/llm'
const TOKEN = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '开闸实测'})).toString('base64')
const H = {'content-type': 'application/json', 'user-info': USER, 'param-accessToken': TOKEN}
const ts = Date.now()
const V = {}
const out = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const QUERY = process.env.KAFKA_QUERY || '分别调研 CCUS 技术、长时储能技术、绿氢制备技术各自的技术成熟度与代表项目，再对比三者的商业化进度，最后给一段排序建议。'

async function postStreamHead(body) {
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    if ((r.headers.get('content-type') || '').includes('json')) return JSON.stringify(await r.json().catch(() => null) || {})
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let acc = ''
    const tEnd = Date.now() + 12000
    while (acc.length < 2000 && Date.now() < tEnd) {
        const {done, value} = await reader.read()
        if (done) break
        acc += dec.decode(value, {stream: true})
    }
    await reader.cancel().catch(() => {})
    return acc
}
const detail = async (rootCode) => (await fetch(`${BASE}/core/agentTask/detail`, {
    method: 'POST', headers: H, body: JSON.stringify({agentCode: rootCode}), signal: AbortSignal.timeout(30000),
}).then((x) => x.json()).catch(() => null))?.data || null

try {
    await import('../../init.js')
    const {AgentTask, Message, Conversation} = await import('../../daos/core/schema/index.js')

    const conv = `gray-kafka-${ts}`
    let rootCode = null
    for (let i = 1; i <= 3 && !rootCode; i++) {
        let head = ''
        try {
            head = await postStreamHead({
                query: QUERY, conversationCode: `${conv}-${i}`,
                options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(), taskMode: true},
            })
        } catch (e) { head = `stream-timeout: ${String(e?.message || e).slice(0, 80)}` }
        rootCode = head.match(/"rootCode":"([^"]+)"/)?.[1] || null
        out.发起 = {attempt: i, head: head.slice(0, 200)}
        if (!rootCode) await sleep(1500)
    }
    V['K0 扇出受理'] = !!rootCode
    if (!rootCode) throw new Error('三轮没扇出（与 kafka 无关，见发起读数）')

    // K1/K2：等终局（kafka finalize + 45s 窗 + 泵重算 + 综合；预算 8 分钟）
    let view = null
    for (let i = 0; i < 120; i++) {
        await sleep(4000)
        view = await detail(rootCode)
        if (['synthesized', 'partial', 'failed', 'cancelled'].includes(view?.phase)) break
    }
    const root = await AgentTask.collection.findOne({agentCode: rootCode})
    const orch = root?.handleRet?.orchestration || {}
    const synth = root?.handleRet?.synthesis || null
    out.K1 = {phase: view?.phase, action: orch.action, usable: synth?.usable, synthDurMs: synth?.durMs}
    V['K1 kafka 链写回：synthesize 落账+synthesis.usable（写回存在=投递/消费/执行三段全通）'] =
        orch.action === 'synthesize' && synth?.usable === true

    const timer = await AgentTask.collection.findOne({'params.rootCode': rootCode, agentRole: 'synth-timer'})
    const winMs = timer ? (new Date(timer.params.dueAt) - new Date(timer.insertTime)) : -1
    const settleMs = timer ? (new Date(root?.updateTime) - new Date(timer.params.dueAt)) : -1
    out.K2 = {winMs, settleMs, timerStatus: timer?.handleStatus}
    V['K2 宽限窗账锚在 kafka 形态下照常（44s≤窗≤60s、settle≤120s）'] =
        winMs >= 44000 && winMs <= 60000 && settleMs >= -5000 && settleMs <= 120000

    // K3 清账
    const codes = (await AgentTask.collection.find({agentCodePath: rootCode}).toArray()).map((r) => r.agentCode)
    codes.push(rootCode, ...(await AgentTask.collection.find({'params.rootCode': rootCode}).toArray()).map((r) => r.agentCode))
    await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
    await Message.collection.deleteMany({conversationCode: {$in: [`root:${rootCode}`]}})
    await Message.collection.deleteMany({conversationCode: {$regex: `^gray-kafka-${ts}`}})
    await Conversation.collection.deleteMany({conversationCode: {$regex: `^gray-kafka-${ts}`}})
    const residual = await AgentTask.collection.countDocuments({agentCode: {$in: codes}})
        + await Message.collection.countDocuments({conversationCode: {$regex: `^gray-kafka-${ts}`}})
    out.K3 = {residual}
    V['K3 探针账清尽'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const allTrue = !out.错误 && ['K0 扇出受理', 'K1 kafka 链写回：synthesize 落账+synthesis.usable（写回存在=投递/消费/执行三段全通）',
    'K2 宽限窗账锚在 kafka 形态下照常（44s≤窗≤60s、settle≤120s）', 'K3 探针账清尽'].every((k) => V[k] === true)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 160)})` : allTrue ? 'dev 批④ kafka 形态端到端通过（finalize 投递/消费/执行+宽限窗照常）' : '未通(见 false 项)'
console.log('\n==== DEV-GRAY-KAFKA RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
