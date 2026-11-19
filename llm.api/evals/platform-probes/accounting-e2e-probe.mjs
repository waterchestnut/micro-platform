/**
 * @fileOverview 运行时账本端到端取证（PR-任务编排 §5-4）：关联列/树累计/预算闸在真库真模型上各就各位
 * @module evals/platform-probes/accounting-e2e-probe
 * @description
 * 三条线的账都要落在 llmUsage 的关联列上，本探针一次跑齐（3 次小 relay）：
 *   ① fan-out child（1 真成功 + 1 必败×autoFollow 追活）⇒ usage 行 rootCode/agentCode/agentRole='child'；
 *   ② finalize 的 synthesis ⇒ agentRole='synthesis' 且 rootCode 指回树；
 *   ③ serialized-turn 经 pump 同款直驱 ⇒ agentRole='serialized-turn'、rootCode=自身、**跑在用户会话**上（§8.0）。
 * 再加两条累计判据：root.budgetUsedTokens == Σ 全树尝试 usage.totalTokens（含 superseded，重试烧过就算）
 * 且与 orchestration.budgetTokensUsed 同值；预算闸在链上而未误触发（follow.budgetStop 缺席）。
 * 零 Kafka；收尾按血统清尽 agentTask/llmUsage/message/conversation（residual=0 是判据）。
 * 用法：node evals/platform-probes/accounting-e2e-probe.mjs
 */
await import('../../init.js')
const si = await import('../../daos/core/schema/index.js')
const {AgentTask, LlmUsage, Message, Conversation} = si
const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const {addAgentTask} = await import('../../services/core/agentTask.js')
const {execAgentTask} = await import('../../services/agent/index.js')
const {normalizeFanOutPlan} = await import('../../services/agent/fanOutPlanner.js')
const {buildRootTask, buildSerializedTurnTask} = await import('../../services/core/session/taskQueueComposer.js')

const userCode = 'menglb'
const CHILD_EXTRA = {cache: false, llmParams: {maxTokens: 48}}
const V = {}
const out = {}
const EXPECTED = 7
const ts = Date.now()
const convTree = `acct-tree-${ts}`
const convTree2 = `acct-tree2-${ts}`
const convTurn = `acct-turn-${ts}`
let rootCode = null, rootCode2 = null, turnCode = null

try {
    llm.config.agentTask.fanOutOrchestration.enabled = false // 手动派发 finalize，防双 finalize 竞态
    llm.config.agentTask.fanOutOrchestration.autoFollow = true

    // ---- ①/② 树：1 真子 + 1 必败子；finalize(autoFollow) 会对必败槽追活后如实 report
    const plan = normalizeFanOutPlan({
        subtasks: [
            {title: '算术', query: '用一句话回答：9-4 等于几？', params: {execOptionsExtra: CHILD_EXTRA}},
            {title: '必败', query: '这句话不会被执行', handler: 'turnRunner', params: {query: '这句话不会被执行'}},
        ], subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode: convTree, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: {userCode}, extra: {handleMode: 'manual', orchestrated: true},
    })
    await addAgentTask(root)
    rootCode = root.agentCode
    await execAgentTask(await dac.getByCode(rootCode))
    await execAgentTask({
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask', handleMode: 'manual',
        handleStatus: 0, agentRole: 'finalize', conversationCode: convTree, operator: {userCode},
        params: {rootCode, originalQuery: '9-4 等于几', channel: 'micro_common', protocol: 2, execOptionsExtra: CHILD_EXTRA},
    })

    // ---- ③ serialized-turn 直驱（pump 同款调用面）
    const turn = buildSerializedTurnTask({
        conversationCode: convTurn, messageCode: `turnmsg-${ts}`, query: '用一句话回答：10/2 等于几？',
        request: {}, options: {channel: 'micro_common', protocol: 2, ...CHILD_EXTRA},
        userInfo: {userCode}, operator: {userCode}, handler: 'turnRunner',
    })
    await addAgentTask(turn)
    turnCode = turn.agentCode
    await execAgentTask(await dac.getByCode(turnCode))

    // ---- ② 独立全成树（mixed 树按语义永不 synth——"永不 synthesize 掩盖失败"，synthesis 行只能从全成树来）
    const plan2 = normalizeFanOutPlan({
        subtasks: [
            {title: '算术B', query: '用一句话回答：6×7 等于几？', params: {execOptionsExtra: CHILD_EXTRA}},
            {title: '颜色B', query: '用一句话回答：雪是什么颜色？', params: {execOptionsExtra: CHILD_EXTRA}},
        ], subtaskCeiling: 4,
    })
    const root2 = buildRootTask({
        conversationCode: convTree2, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan2.subtasks, operator: {userCode}, extra: {handleMode: 'manual', orchestrated: true},
    })
    await addAgentTask(root2)
    rootCode2 = root2.agentCode
    await execAgentTask(await dac.getByCode(rootCode2))
    await execAgentTask({
        agentCode: `fin-${rootCode2}`, agentType: 'local', handler: 'fanOutFinalizeTask', handleMode: 'manual',
        handleStatus: 0, agentRole: 'finalize', conversationCode: convTree2, operator: {userCode},
        params: {rootCode: rootCode2, originalQuery: '6×7 与雪的颜色', channel: 'micro_common', protocol: 2, execOptionsExtra: CHILD_EXTRA},
    })

    // ---- 判据取数
    const freshRoot = await dac.getByCode(rootCode)
    const freshRoot2 = await dac.getByCode(rootCode2)
    // 口径=按 rootCode 查账（排查刀统一：与 detail.usage 树账同源，含全部尝试与 synthesis）
    const treeRows1 = await LlmUsage.collection.find({rootCode}).project({totalTokens: 1}).toArray()
    const treeRows2 = await LlmUsage.collection.find({rootCode: rootCode2}).project({totalTokens: 1}).toArray()
    const kidCodes = (freshRoot.subAgents || []).map((s) => s.agentCode)
    const kidUsages = []
    for (const c of kidCodes) { const u = await LlmUsage.findOne({messageCode: c}).lean(); if (u) kidUsages.push(u) }
    const synthCode = (await dac.getByCode(rootCode2))?.handleRet?.synthesis?.messageCode
    const synthUsage = synthCode ? await LlmUsage.findOne({messageCode: synthCode}).lean() : null
    const turnUsage = await LlmUsage.findOne({messageCode: `turnmsg-${ts}`}).lean()
    const sumKids = kidUsages.reduce((a, u) => a + (Number(u.totalTokens) || 0), 0)
    const sumTree1 = treeRows1.reduce((a, u) => a + (Number(u.totalTokens) || 0), 0)
    const sumTree2 = treeRows2.reduce((a, u) => a + (Number(u.totalTokens) || 0), 0)

    out.snapshot = {
        kidRows: kidUsages.map((u) => ({m: String(u.messageCode).slice(0, 8), role: u.agentRole, root: u.rootCode === rootCode, tokens: u.totalTokens})),
        synth: synthUsage && {role: synthUsage.agentRole, root: synthUsage.rootCode === rootCode},
        turn: turnUsage && {role: turnUsage.agentRole, selfRoot: turnUsage.rootCode === turnCode, conv: turnUsage.conversationCode === convTurn},
        budget: {onRoot: freshRoot.handleStatus, tokens: freshRoot.budgetUsedTokens, orch: freshRoot.handleRet?.orchestration?.budgetTokensUsed},
        budgetTree2: {onRoot: freshRoot2.budgetUsedTokens, rootCodeSum: sumTree2, synthTokens: synthUsage?.totalTokens ?? null, orch: freshRoot2.handleRet?.orchestration?.budgetTokensUsed},
        follow: {budgetStop: freshRoot.handleRet?.orchestration?.follow?.budgetStop ?? null, spawned: freshRoot.handleRet?.orchestration?.follow?.spawned},
    }
    V['A1 child usage 行关联列齐(agentRole=child 且 rootCode 指树)'] = kidUsages.length >= 1
        && kidUsages.filter((u) => u.agentRole === 'child').length >= 1
        && kidUsages.every((u) => !u.agentRole || u.rootCode === rootCode)
    V['A2 全成树 synthesis 行 agentRole=synthesis 且 rootCode 指回自己的树'] = !!synthUsage && synthUsage.agentRole === 'synthesis' && synthUsage.rootCode === rootCode2
    V['A3 serialized-turn 行 agentRole/rootCode=自身 且跑在用户会话'] = !!turnUsage
        && turnUsage.agentRole === 'serialized-turn' && turnUsage.rootCode === turnCode && turnUsage.conversationCode === convTurn
    V['A4 root.budgetUsedTokens==按rootCode查账Σ 且与 orchestration.budgetTokensUsed 同值'] = freshRoot.budgetUsedTokens === sumTree1
        && freshRoot.handleRet?.orchestration?.budgetTokensUsed === sumTree1 && sumTree1 > 0
    V['A5 预算闸在链上未误触(budgetStop 缺席) 且追活发生过(spawned>=1)'] = out.snapshot.follow.budgetStop === null
        && (out.snapshot.follow.spawned || 0) >= 1
    V['A6 全成树 budgetUsedTokens 含 synthesis 行（口径=rootCode 查账非 Σchildren）'] = freshRoot2.budgetUsedTokens === sumTree2
        && !!synthUsage && sumTree2 >= (Number(synthUsage.totalTokens) || 0) + 1 && sumTree2 > 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    // 血统清扫：三棵任务/一行 turn + 各表按 code/conv/前缀反查兜底，residual=0 是判据不是礼貌
    try {
        let residual = 0
        const codes = new Set()
        for (const anchor of [rootCode, rootCode2, turnCode].filter(Boolean)) {
            codes.add(anchor)
            const tree = await AgentTask.collection.find({agentCodePath: anchor}).project({agentCode: 1}).toArray()
            tree.forEach((t) => codes.add(t.agentCode))
        }
        const arr = [...codes]
        if (arr.length) await AgentTask.collection.deleteMany({agentCode: {$in: arr}})
        const convsAll = [convTree, convTree2, convTurn, ...arr.map((c) => `root:${c}`), ...arr.map((c) => `agent:${c}`)]
        await LlmUsage.collection.deleteMany({$or: [{messageCode: {$in: [...arr, `turnmsg-${ts}`]}}, {conversationCode: {$in: convsAll}}, {rootCode: {$in: arr}}]})
        await Message.collection.deleteMany({$or: [{messageCode: {$in: [...arr, `turnmsg-${ts}`]}}, {conversationCode: {$in: convsAll}}]})
        await Conversation.collection.deleteMany({conversationCode: {$in: convsAll}})
        residual += await AgentTask.collection.countDocuments({agentCode: {$in: arr}})
        const strayMsg = await Message.collection.countDocuments({conversationCode: {$in: convsAll}})
        const strayUsage = await LlmUsage.collection.countDocuments({$or: [{rootCode: {$in: arr}}, {conversationCode: {$in: convsAll}}]})
        out.residual = {agentTask: residual, message: strayMsg, llmUsage: strayUsage}
        if (!out.错误) V['C1 三表按血统清尽(residual=0)'] = residual === 0 && strayMsg === 0 && strayUsage === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 120)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '运行时账本 e2e 通过(关联列三角色/树累计含重试/预算闸在位不误触/三表零残留)' : '未通(见 false 项)'
console.log('\n==== ACCOUNTING E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
