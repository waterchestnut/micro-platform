/**
 * @fileOverview 消耗读数面端到端取证（PR-任务编排 §5-4 后半）：日汇总三值/本人限定/树账各就各位
 * @module evals/platform-probes/usage-stats-e2e-probe
 * @description
 * 消费面三处真跑（3 次小 relay）：
 *   U1 serialized-turn 直驱 ⇒ getUserDailyUsage(本人,今日) credits>0 且 creditsPriced===false
 *      （本期无权重，"未计价"是事实；混合历史行走三值语义，用例已穷举）。
 *   U2 真 HTTP /core/chat/runStats ⇒ usageDaily 在体、credits>=U1（同日累计只多不少）、无 error。
 *   U3 1 全成树 + finalize(synthesis) ⇒ 真 HTTP /core/agentTask/detail 的 usage.byRole 有 child/synthesis
 *      两类行、credits 与树累计同源（getTreeUsage 直接读 llmUsage.rootCode——关联列的查询面成立）。
 * 归属负例：非 owner 查 detail ⇒ 403（树账同受面保护，usage 只是 detail 的字段）。
 * 收尾血统清尽（agentTask/llmUsage/message/conversation residual=0 是判据）。
 * 用法：node evals/platform-probes/usage-stats-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12044
const BASE = `http://127.0.0.1:${PORT}`
const USER = (c) => Buffer.from(JSON.stringify({userCode: c, realName: '读数e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 5
const ts = Date.now()
const convTree = `usg-tree-${ts}`
const convTurn = `usg-turn-${ts}`
let server = null, rootCode = null, turnCode = null

function startServer() {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(), env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1'},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', (d) => { buf += d.toString() })
    child.stderr.on('data', (d) => { buf += d.toString() })
    child.log = () => buf
    return child
}
async function waitReady(c, ms = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (c.log().includes('服务器启动成功')) return true
        await new Promise((r) => setTimeout(r, 1000))
    }
    return false
}
async function stopServer(c) { if (c && !c.killed) { c.kill(); await new Promise((r) => setTimeout(r, 1500)) } }
async function api(path, body, user = 'menglb') {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER(user)},
        body: JSON.stringify(body || {}), signal: AbortSignal.timeout(60000),
    })
    return {status: res.status, json: await res.json().catch(() => null)}
}

let AgentTask = null, LlmUsage = null, Message = null, Conversation = null
try {
    await import('../../init.js')
    const si = await import('../../daos/core/schema/index.js')
    AgentTask = si.AgentTask; LlmUsage = si.LlmUsage; Message = si.Message; Conversation = si.Conversation
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const {addAgentTask} = await import('../../services/core/agentTask.js')
    const {execAgentTask} = await import('../../services/agent/index.js')
    const {getUserDailyUsage, getTreeUsage} = await import('../../services/core/usageStats.js')
    const {normalizeFanOutPlan} = await import('../../services/agent/fanOutPlanner.js')
    const {buildRootTask, buildSerializedTurnTask} = await import('../../services/core/session/taskQueueComposer.js')
    const {randomUUID} = await import('node:crypto')
    const EXTRA = {cache: false, llmParams: {maxTokens: 48}}

    server = startServer()
    if (!await waitReady(server)) throw new Error('server 启动超时')

    // U1 serialized-turn 直驱 + 日汇总
    const msgCode = `usgturn-${ts}`
    const turn = buildSerializedTurnTask({
        conversationCode: convTurn, messageCode: msgCode, query: '用一句话回答：12-5 等于几？',
        options: {channel: 'micro_common', protocol: 2, ...EXTRA}, userInfo: {userCode: 'menglb'},
        operator: {userCode: 'menglb'}, handler: 'turnRunner',
    })
    await addAgentTask(turn)
    turnCode = turn.agentCode
    await execAgentTask(await dac.getByCode(turnCode))
    const daily1 = await getUserDailyUsage('menglb', new Date().toISOString().slice(0, 10))
    out.U1 = {credits: daily1.credits, priced: daily1.creditsPriced, runs: daily1.runs}
    V['U1 日汇总:credits>0 且 creditsPriced===false(未计价是事实,不装钱也不装免费)'] =
        daily1.credits > 0 && daily1.creditsPriced === false && daily1.runs > 0

    // U2 runStats 本人面（真 HTTP）
    const rs = await api('/core/chat/runStats', {})
    // /core/chat/* 经 format-reply 包 data 信封；agentTask 路由是手写 {statusCode,code,data}——两种都认
    const ud = rs.json?.usageDaily ?? rs.json?.data?.usageDaily
    out.U2 = {status: rs.status, credits: ud?.credits, priced: ud?.creditsPriced, rawTop: JSON.stringify(rs.json || {}).slice(0, 160)}
    V['U2 /runStats.usageDaily 在体且>=本人当日账(只查自己,非枚举面)'] =
        rs.status === 200 && !!ud && !ud.error && ud.credits >= daily1.credits && ud.creditsPriced === false

    // U3 全成树 + finalize ⇒ detail.usage 树账（关联列查询面）
    const plan = normalizeFanOutPlan({
        subtasks: [{title: '算术', query: '用一句话回答：4×4 等于几？', params: {execOptionsExtra: EXTRA}}],
        subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode: convTree, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: {userCode: 'menglb'}, extra: {handleMode: 'manual', orchestrated: true},
    })
    await addAgentTask(root)
    rootCode = root.agentCode
    await execAgentTask(await dac.getByCode(rootCode))
    await execAgentTask({
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask', handleMode: 'manual',
        handleStatus: 0, agentRole: 'finalize', conversationCode: convTree, operator: {userCode: 'menglb'},
        params: {rootCode, originalQuery: '4×4', channel: 'micro_common', protocol: 2, execOptionsExtra: EXTRA},
    })
    const dt = await api('/core/agentTask/detail', {agentCode: rootCode})
    const usage = dt.json?.data?.usage
    const treeDirect = await getTreeUsage(rootCode)
    out.U3 = {byRole: usage?.byRole, rows: usage?.rows, directRows: treeDirect.rows}
    V['U3 detail.usage 按 rootCode 聚合:child 与 synthesis 行各就位(in-proc 同值)'] =
        usage && usage.byRole?.child?.rows >= 1 && usage.byRole?.synthesis?.rows === 1 && usage.tokens > 0
        && treeDirect.rows === usage.rows
    const nx = await api('/core/agentTask/detail', {agentCode: rootCode}, 'attacker-zzz')
    V['U3b 非 owner 查 detail(含树账) ⇒ 403'] = nx.status === 403
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    await stopServer(server)
    try {
        const codes = new Set()
        for (const anchor of [rootCode, turnCode].filter(Boolean)) {
            codes.add(anchor)
            const tree = await AgentTask.collection.find({agentCodePath: anchor}).project({agentCode: 1}).toArray()
            tree.forEach((t) => codes.add(t.agentCode))
        }
        const arr = [...codes]
        if (arr.length) await AgentTask.collection.deleteMany({agentCode: {$in: arr}})
        const convsAll = [convTree, convTurn, `usgturn-${ts}`, ...arr.map((c) => `root:${c}`), ...arr.map((c) => `agent:${c}`)]
        await LlmUsage.collection.deleteMany({$or: [{messageCode: {$in: [...arr, `usgturn-${ts}`]}}, {rootCode: {$in: arr}}, {conversationCode: {$in: convsAll}}]})
        await Message.collection.deleteMany({$or: [{messageCode: {$in: [...arr, `usgturn-${ts}`]}}, {conversationCode: {$in: convsAll}}]})
        await Conversation.collection.deleteMany({conversationCode: {$in: convsAll}})
        const residual =
            await AgentTask.collection.countDocuments({agentCode: {$in: arr}}) +
            await LlmUsage.collection.countDocuments({$or: [{rootCode: {$in: arr}}, {messageCode: `usgturn-${ts}`}, {conversationCode: {$in: [convTree, convTurn]}}]}) +
            await Message.collection.countDocuments({conversationCode: {$in: [convTree, convTurn]}}) +
            await Conversation.collection.countDocuments({conversationCode: {$in: [convTree, convTurn]}})
        out.residual = residual
        if (!out.错误) V['C1 四表血统清尽(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '消耗读数面 e2e 通过(日汇总三值/本人限定/树账聚合/归属 403/零残留)' : '未通(见 false 项)'
console.log('\n==== USAGE-STATS E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
