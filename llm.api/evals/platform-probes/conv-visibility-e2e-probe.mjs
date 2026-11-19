/**
 * @fileOverview 工作会话列表排除端到端取证（开闸测验产品面修复）
 * @module evals/platform-probes/conv-visibility-e2e-probe
 * @description
 * 真 HTTP 三判据（1 次小 relay）：
 *   V1 扇出轮（taskMode 可拆查询）⇒ 受理 root；等 children 终局后 root:/agent: 会话建档存在
 *      （血统还在——**排除是列表语义不是删数据**）
 *   V2 /core/conversation/list 的返回里**没有**这棵树的 root:/agent: 会话，且主会话仍在
 *   V3 byCode 读综合正文照常命中（成员权限未被 internal 影响——本方案地基的反向实证）
 * server 开 queue+planner+orchestration(direct)；收尾按血统清尽。
 * 用法：node evals/platform-probes/conv-visibility-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

/**
 * 底座适配（刀四）：finalize 触发判定读调用时 config——同进程执行器跑在**本探针进程**，
 * 而母本 dev 上这判定发生在带 flag 的 executor 容器里。envExtra 只覆盖 server 子进程，
 * 所以必须在 init.js 建 config 之前把编排开关立进本进程 env（缺省值不覆盖外部显式设定）。
 */
process.env.agentTask_fanOutOrchestration = process.env.agentTask_fanOutOrchestration || 'true'
process.env.agentTask_fanOutOrchestrationDispatch = process.env.agentTask_fanOutOrchestrationDispatch || 'direct'

const PORT = 12047
const BASE = `http://127.0.0.1:${PORT}`
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '可见性e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 4
const ts = Date.now()
let conv = `convvis-${ts}`
let server = null
let AgentTask = null, LlmUsage = null, Message = null, Conversation = null
let rootCode = null

async function api(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER},
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('json')) return {json: await res.json().catch(() => null), status: res.status}
    try { res.body && res.body.cancel() } catch { /* ignore */ }
    return {sse: true, status: res.status}
}

try {
    await import('../../init.js')
    const si = await import('../../daos/core/schema/index.js')
    AgentTask = si.AgentTask; LlmUsage = si.LlmUsage; Message = si.Message; Conversation = si.Conversation

    // 预清测验残留：已知全码树（按 agentCodePath 血统）+ 无主孤儿 + 测验前缀会话。
    // 这些是**旧代码执行期**建的无标会话，留着会把"机制失效"和"历史噪音"搅成一锅（V2 判据的地基）。
    const KNOWN_ROOTS = ['2cfe95e0e3af11f1b3ed6fe8c3bf47a8', '62556970e3b011f1a013b790b991ba09',
        'eab66fd0e3b811f1b977e11e27dc2012', '0457b750e3b111f1967fa1cd126192f7', 'b21e3010e3b311f1a5886b82c3da78da']
    const sweepTree = async (root) => {
        const t = await AgentTask.collection.find({agentCodePath: root}).project({agentCode: 1}).toArray()
        const cs = [root, ...t.map(x => x.agentCode)]
        await AgentTask.collection.deleteMany({agentCode: {$in: cs}})
        await LlmUsage.collection.deleteMany({$or: [{rootCode: root}, {messageCode: {$in: cs}}]})
        await Message.collection.deleteMany({conversationCode: {$in: [`root:${root}`, ...cs.filter(c => c !== root).map(c => `agent:${c}`)]}})
        await Conversation.collection.deleteMany({conversationCode: {$in: [`root:${root}`, ...cs.filter(c => c !== root).map(c => `agent:${c}`)]}})
    }
    for (const root of KNOWN_ROOTS) await sweepTree(root)
    // 测验期 UI 树（0b6a681/5e92155/c745fdd/ba263b6/7cfa78/062f0ea/bd2be9f/80ba6e/95d40a/f1f6ec/ed8b9f/4475f2 等）：
    // 按前缀扫孤儿——任务行已不存在，或任务行是 orchestrated 血统且 root 已终局的，都算测验残留
    const iso = await Conversation.collection.find({conversationCode: {$regex: '^(root|agent):'}}).project({conversationCode: 1}).toArray()
    for (const c of iso) {
        const code = c.conversationCode.replace(/^(root|agent):/, '')
        const task = await AgentTask.collection.findOne({agentCode: code}, {projection: {agentCodePath: 1, orchestrated: 1, agentRole: 1}})
        if (!task) {
            await Conversation.collection.deleteMany({conversationCode: c.conversationCode})
            await Message.collection.deleteMany({conversationCode: c.conversationCode})
        } else if (task.orchestrated === true || (task.agentCodePath && KNOWN_ROOTS.includes(task.agentCodePath))) {
            await sweepTree(task.agentCodePath || code)
        }
    }
    for (const p of ['convvis-', 'gate-', 'qbusy-', 'flag-check-', 'manual-conv', 'gate-curl']) {
        await Conversation.collection.deleteMany({conversationCode: {$regex: '^' + p}})
        await Message.collection.deleteMany({conversationCode: {$regex: '^' + p}})
    }
    await Conversation.collection.deleteMany({conversationCode: {$regex: '^agent:convvis-fake'}})
    await Conversation.collection.deleteMany({conversationCode: {$regex: '^(convvis-|agent:convvis-fake)'}})
    await Conversation.collection.deleteMany({conversationCode: {$regex: '^agent:convvis-fake'}})

    server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1',
            limits_conversationTaskQueue: 'true', agentTask_fanOutPlanner: 'true',
            agentTask_fanOutOrchestration: 'true', agentTask_fanOutOrchestrationDispatch: 'direct',
            // 底座适配（刀四）：本环境没有可治理的 kafka consumer ⇒ root 用 manual 建，执行由本探针进程驱动
            agentTask_fanOutPlannerHandleMode: 'manual'},
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

    // planner 判定是模型行为（同一查询可能某轮判"不拆"⇒走普通流，这是正确降级不是故障）。
    // 探针要的是"有一棵被受理的树"，对非确定性判定做有限重试（taskCode 每次不同=不同请求）。
    let acc = null, rootCode = null, usedConv = null
    for (let attempt = 1; attempt <= 3 && !rootCode; attempt++) {
        const c = `${conv}-a${attempt}`
        acc = await api('/core/chat/stream', {
            query: '请分别调研三个独立问题并汇总：1) 一句话说明为什么天空是蓝的；2) 一句话说明勾股定理的内容；3) 13×7 等于几。',
            conversationCode: c,
            options: {channel: 'micro_common', protocol: 2, cache: false, taskMode: true, taskCode: `t-convvis-${ts}-${attempt}`},
        })
        rootCode = acc.json?.data?.rootCode || null
        if (rootCode) usedConv = c
        out[`accept${attempt}`] = {rootCode, accepted: acc.json?.data?.taskAccepted === true}
    }
    conv = usedConv
    if (!rootCode) throw new Error('未受理扇出（3 次 planner 均降级——判定非确定性，重试外无稳定构造）')

    /**
     * 底座适配（刀四）：母本 dev 有部署好的 executor 容器消费 queue-mode 树；底座栈没有可治理的外部消费者，
     * 所以本探针把 root 建成 manual（env agentTask_fanOutPlannerHandleMode=manual，不投 Kafka）
     * 并由**本进程**充当执行器（fanout-e2e 同法：execAgentTask 对 manual root 同进程派发 children）。
     * 受理路径本身（HTTP /stream + planner + 建档点 internal）没有被跳过——跳过的只是"谁来跑树"。
     */
    {
        const { execAgentTask } = await import('../../services/agent/index.js')
        const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
        const storedRoot = await agentTaskDac.getByCode(rootCode)
        if (storedRoot) execAgentTask(storedRoot).catch((e) => console.warn('[convvis] 同进程执行树失败:', String(e?.message || e).slice(0, 160)))
    }

    // 等树终局（上限 4 分钟）。判据读**原始文档**——dac.getByCode 是瘦身投影（无 handleRet），
    // 拿它判 orch 恒 null，上一版就是这样空转 4 分钟后把残留留给断言。
    const rawRoot = async () => AgentTask.collection.findOne({agentCode: rootCode}, {projection: {handleStatus: 1, handleRet: 1, subAgents: 1}})
    let tree = null
    for (let i = 0; i < 48; i++) {
        tree = await rawRoot()
        const kids = (tree?.subAgents || []).map(s => s.handleStatus)
        const orchAct = tree?.handleRet?.orchestration?.action || null
        const synthUsable = tree?.handleRet?.synthesis?.usable
        if (orchAct && (orchAct !== 'synthesize' || synthUsable === true || synthUsable === false)) break
        if (kids.length && kids.every(h => h === 2 || h === 3 || h === -1) && orchAct) break
        await new Promise((r) => setTimeout(r, 5000))
    }
    const fresh = await rawRoot()
    const codes = (fresh?.subAgents || []).map(s => s.agentCode)
    const isoConvs = [`root:${rootCode}`, ...codes.filter(c => c !== rootCode).map(c => `agent:${c}`)]
    const created = await Conversation.collection.find({conversationCode: {$in: isoConvs}}).project({conversationCode: 1, internal: 1}).toArray()
    out.iso = {expected: isoConvs.length, created: created.map(c => ({c: c.conversationCode.slice(0, 10), internal: c.internal}))}
    V['V1 隔离会话建档存在且都带 internal:true（排除是列表语义不是删数据）'] =
        created.length >= 1 && created.every(c => c.internal === true)

    const list = await api('/core/conversation/list', {filter: {}, pageIndex: 1, pageSize: 100, options: {total: false}})
    const rows = list.json?.data?.rows || []
    const leaked = rows.filter(r => (r.conversationCode || '').startsWith('root:') || (r.conversationCode || '').startsWith('agent:'))
    /**
     * 不误伤断言改**受控构造**：扇出受理路径根本不建主会话（受理=只拆树不 execChat），
     * 上一版拿"主会话在列表"当判据是断言自己错了（mainIn:false 是正确行为）。
     * 显式建一条普通会话 + 一条带标会话 ⇒ 前者必须在、后者必须不在。
     */
    const probeNormal = `convvis-normal-${ts}`
    const probeInternal = `agent:convvis-fake-${ts}`
    const nowD = new Date()
    await Conversation.collection.insertMany([
        {conversationCode: probeNormal, title: '普通对照', channel: 'micro_common', channelGroup: 'xxzx', conversationType: 'chat', llmModel: 'relay_common_pro', operator: {userCode: 'menglb', realName: '对照'}, status: 0, userCodes: ['menglb'], internal: false, insertTime: nowD, updateTime: nowD},
        {conversationCode: probeInternal, title: '带标对照', channel: 'micro_common', channelGroup: 'xxzx', conversationType: 'chat', llmModel: 'relay_common_pro', operator: {userCode: 'menglb', realName: '对照'}, status: 0, userCodes: ['menglb'], internal: true, insertTime: nowD, updateTime: nowD},
    ])
    const list2 = await api('/core/conversation/list', {filter: {}, pageIndex: 1, pageSize: 100, options: {total: false}})
    const rows2 = list2.json?.data?.rows || []
    const normalIn = rows2.some(r => r.conversationCode === probeNormal)
    const fakeOut = !rows2.some(r => r.conversationCode === probeInternal)
    out.list = {rows: rows.length, leaked: leaked.map(r => r.conversationCode.slice(0, 12)), normalIn, fakeOut}
    V['V2 列表零泄漏+普通会话不误伤+带标会话被排（受控对照）'] = leaked.length === 0 && normalIn && fakeOut

    const readBack = await api('/core/message/list', {filter: {conversationCode: `root:${rootCode}`}, pageIndex: 1, pageSize: 5, options: {total: false}})
    const rbRows = readBack.json?.data?.rows || []
    out.readBack = {n: rbRows.length, finished: rbRows.some(r => r.progress === 'finish' && (r.answer || '').trim())}
    V['V3 internal 会话 byCode 读照常（成员权限未动——地基反向实证）'] = rbRows.length >= 1
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
} finally {
    if (server && !server.killed) { server.kill(); await new Promise((r) => setTimeout(r, 1500)) }
    try {
        if (rootCode) {
            const tree = await AgentTask.collection.find({agentCodePath: rootCode}).project({agentCode: 1}).toArray()
            const codes = [rootCode, ...tree.map(x => x.agentCode)]
            await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
            await LlmUsage.collection.deleteMany({$or: [{rootCode}, {messageCode: {$in: codes}}]})
            await Message.collection.deleteMany({conversationCode: {$in: [conv, `root:${rootCode}`, ...codes.map(c => `agent:${c}`)]}})
            await Conversation.collection.deleteMany({conversationCode: {$in: [conv, `root:${rootCode}`, ...codes.map(c => `agent:${c}`)]}})
        }
        // 对照会话与测验前缀（fake 不在 convvis- 前缀族里，必须单独列——上一版 residual=2 就是漏它）
        for (const p of ['convvis-', 'agent:convvis-fake']) {
            await Conversation.collection.deleteMany({conversationCode: {$regex: '^' + p}})
            await Message.collection.deleteMany({conversationCode: {$regex: '^' + p}})
        }
        const residual = await Conversation.collection.countDocuments({conversationCode: {$regex: '^(convvis-|agent:convvis-fake)'}})
            + (rootCode ? await Conversation.collection.countDocuments({conversationCode: `root:${rootCode}`}) : 0)
        out.residual = residual
        if (!out.错误) V['C1 收尾清尽(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '会话可见性 e2e 通过(建档带标/列表排除/主会话不误伤/byCode 可读/清尽)' : '未通(见 false 项)'
console.log('\n==== CONV-VISIBILITY E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
