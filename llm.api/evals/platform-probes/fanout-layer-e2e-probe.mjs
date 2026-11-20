/**
 * @fileOverview §8 分层扇出端到端取证：真引擎真库跑一棵两层 DAG（layer0 并行 → 层推进 → 下游吃上游产出）
 * @module evals/platform-probes/fanout-layer-e2e-probe
 * @description
 * fanOutPlanGraph/follow 层推进的判据都已有穷举+假 deps 真跑；本探针验**与真引擎的接合**：
 * root.params.orchPlan 落库 → finalize 内层推进（insertSubAgentTask 挂父 + 本进程执行）→
 * 下游 query 真带上游正文 → 全层走完才 synthesize 落综合。
 *
 * 树形（manual root，零 Kafka，同 follow 探针路数）：
 *   layer0：a=「一句话回答：6+7 等于几？」 b=「一句话回答：天空通常是什么颜色？」（都真 relay）
 *   layer1：c deps[a,b]=「基于上游产出，用一句话总结这两件事」
 * 两阶段：
 *   ON  layered+autoFollow ⇒ 层行出现且时序在层0 终局之后、query 含注入段、synthesize 全树收口；
 *   OFF autoFollow=false   ⇒ 半树不装完成：degrade=layered-not-advanced、root=3、无层行（没承接方）。
 * 跑完显式清场（root+subAgents 血统+fin 行），residual=0。EXPECTED=7。
 */
await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const { normalizeFanOutPlan, stampChildHandler } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

const userCode = 'menglb'
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const V = {}
const out = { phases: {} }


const orch = llm.config.agentTask.fanOutOrchestration
orch.enabled = false // 手动派 finalize（防 B1 自动派发竞态——已知探针坑）
orch.layered = true

async function buildLayerTree(suffix, autoFollow) {
    orch.autoFollow = autoFollow
    const conversationCode = `lyrprobe-${suffix}-${Date.now()}`
    const layer0 = stampChildHandler([
        { id: 'a', title: '算术', query: '一句话回答：6+7 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
        { id: 'b', title: '颜色', query: '一句话回答：天空通常是什么颜色？', params: { execOptionsExtra: CHILD_EXTRA } },
    ])
    const plan = normalizeFanOutPlan({ subtasks: layer0, subtaskCeiling: 4 })
    const root = buildRootTask({
        conversationCode, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: { userCode },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    // 后续层：与 service 3a 同形状（orchPlan=未 spawn 层队列，id/deps 住 params）
    root.params.orchPlan = [stampChildHandler([{ id: 'c', title: '汇总', query: '用一句话总结这两件事（依赖上游）', deps: ['a', 'b'], params: { execOptionsExtra: CHILD_EXTRA } }])]
    await addAgentTask(root)
    await execAgentTask(await agentTaskDac.getByCode(root.agentCode))
    return { rootCode: root.agentCode, conversationCode }
}

async function dispatchFinalize(rootCode, conversationCode) {
    const finTask = {
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode, operator: { userCode },
        params: { rootCode, originalQuery: '算术+颜色 两问后汇总（分层试验树）', channel: 'xxzx_common', protocol: 2, execOptionsExtra: CHILD_EXTRA },
    }
    const finRet = await execAgentTask(finTask)
    const root = await agentTaskDac.getByCode(rootCode)
    const err = finRet?.errorMsg || (finRet?.handleStatus === -1 ? 'finalize status=-1' : null)
    if (err) out.handlerErrors = (out.handlerErrors || []).concat([`${rootCode}: ${String(err).slice(0, 300)}`])
    return root
}

async function kidsOf(root) {
    const rows = []
    for (const s of (root.subAgents || [])) {
        const c = await agentTaskDac.getByCode(s.agentCode)
        if (c) rows.push(c)
    }
    return rows
}

async function sweep(rootCode, conversationCode) {
    if (!rootCode) return 0
    const { AgentTask, Message, Conversation, LlmUsage } = await import('../../daos/core/schema/index.js')
    const root = await agentTaskDac.getByCode(rootCode)
    const codes = [rootCode, `fin-${rootCode}`, ...(root?.subAgents || []).map((s) => s.agentCode)].filter(Boolean)
    const convs = [conversationCode, `root:${rootCode}`, ...codes.map((c) => `agent:${c}`)]
    await AgentTask.collection.deleteMany({ agentCode: { $in: codes } })
    await LlmUsage.collection.deleteMany({ $or: [{ rootCode }, { messageCode: { $in: codes } }, { conversationCode: { $in: convs } }] })
    await Message.collection.deleteMany({ conversationCode: { $in: convs } })
    await Conversation.collection.deleteMany({ conversationCode: { $in: [conversationCode, `root:${rootCode}`] } })
    return await AgentTask.collection.countDocuments({ $or: [{ agentCode: rootCode }, { parentCode: rootCode }] })
}

let tOn = null, tOff = null, tR = null
const EXPECTED = 10
try {
    // ===== ON：真追活 + 真层推进 =====
    tOn = await buildLayerTree('on', true)
    const rOn = await dispatchFinalize(tOn.rootCode, tOn.conversationCode)
    const kOn = await kidsOf(rOn)
    const l0 = kOn.filter((c) => !c.params?.layerIndex)
    const l1 = kOn.filter((c) => c.params?.layerIndex === 1)
    out.phases.ON = {
        subs: kOn.length, st: rOn.handleStatus, action: rOn.handleRet?.orchestration?.action,
        spawnedLayers: rOn.handleRet?.orchestration?.follow?.spawnedLayers,
        counts: rOn.handleRet?.orchestration?.counts, l1query: String(l1[0]?.params?.query || '').slice(0, 160),
    }
    V['N1 层推进发生:layer1 行存在且挂在本树下'] = l1.length === 1 && rOn.handleRet?.orchestration?.follow?.spawnedLayers === 1
    // 时序：layer1 行的 insertTime 不早于 layer0 行的最晚 updateTime（层0 到终局后才 spawn——顺序事实）
    const l0End = Math.max(...l0.map((c) => new Date(c.updateTime || c.insertTime || 0).getTime()))
    const l1Start = new Date(l1[0]?.insertTime || l1[0]?.updateTime || 0).getTime()
    V['N2 时序事实:layer1 建在 layer0 全部终局之后'] = l1.length === 1 && l1Start >= l0End
    V['N3 产出注入:layer1 query 含上游注入段与两上游正文'] = /【上游子任务产出/.test(String(l1[0]?.params?.query || ''))
    V['N4 全层走完才收口:root=2 synthesize、counts.total=3'] = rOn.handleStatus === 2
        && rOn.handleRet?.orchestration?.action === 'synthesize' && (rOn.handleRet?.orchestration?.counts?.total || 0) === 3
    V['N5 综合真落 root（回执 usable+messageCode 建档，正文在 root 会话档案）'] = rOn.handleRet?.synthesis?.usable === true && !!rOn.handleRet?.synthesis?.messageCode

    // ===== OFF：半树不装完成 =====
    tOff = await buildLayerTree('off', false)
    const rOff = await dispatchFinalize(tOff.rootCode, tOff.conversationCode)
    const kOff = await kidsOf(rOff)
    out.phases.OFF = { st: rOff.handleStatus, action: rOff.handleRet?.orchestration?.action, follow: rOff.handleRet?.orchestration?.follow, layerRows: kOff.filter((c) => c.params?.layerIndex).length }
    V['N6 OFF 半树降级:report(3)+degrade=layered-not-advanced+skippedLayers=1+无层行'] = rOff.handleStatus === 3
        && rOff.handleRet?.orchestration?.follow?.degrade === 'layered-not-advanced'
        && rOff.handleRet?.orchestration?.follow?.skippedLayers === 1
        && kOff.filter((c) => c.params?.layerIndex).length === 0

    // ===== R：§8/B1 恢复补派——"层间死"病形（层0 终局、finalize 从没跑、orchPlan 剩一层） =====
    // 建树期间 enabled=false（防 B1 自动派发与手工/补派竞态——已知双 finalize OOM 坑）；
    // 病形成真后开 enabled+**direct**（kafka 会被 dev consumer 异步捡走，读数时机失控）。
    tR = await buildLayerTree('rescue', true)
    const { rescueOrchPending } = await import('../../tasks/agentTaskRecover.js')
    orch.enabled = true
    orch.dispatch = 'direct'
    await new Promise((r) => setTimeout(r, 80))
    const rr = await rescueOrchPending({stuckMs: 1, windowMs: 60000, max: 2})
    out.phases.RESCUE = rr
    // direct=fire-and-forget：轮询等 finalize 真跑完（层推进 relay+综合 ≈ 分钟级）
    let rR = null
    for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        rR = await agentTaskDac.getByCode(tR.rootCode)
        if (rR.handleRet?.orchestration) break
    }
    V['R1 补派命中派发:scanned>=1 rescued>=1'] = rr.scanned >= 1 && rr.rescued >= 1
    V['R2 恢复闭环:orchestration 补写+层推进续跑(spawnedLayers>=1)+orchPlan 清账+帽记账 1'] =
        !!rR.handleRet?.orchestration && (rR.handleRet?.orchestration?.follow?.spawnedLayers || 0) >= 1
        && (rR.params?.orchPlan || []).length === 0 && (rR.params?.orchRescue?.count || 0) === 1
    // R3 病形再现且已到帽（max=1：count 已 1 ⇒ 1<1 false）⇒ 只吵不补。
    // updateTime 回拨不可行（schema auto 语义在 update 时也会重设为当下——ut 读数实锤），
    // 改用真实等待穿过 stuckMs：注入后睡过阈值再扫，判据一字不放松。
    // 病形注入必须走 collection 层 $set：dac.update 的 schema cast 会把 'handleRet.orchestration':null
    // **静默滤掉**（铁证：R3diag 行里 orchestration 键原样在——上一轮把乱码"在"读成"缺席"绕了三圈）。
    // 教训入家族：模拟库内病形用原生 driver，别借业务写面（业务面本来就不该能写出这种形状）。
    const { AgentTask: ATc } = await import('../../daos/core/schema/index.js')
    await ATc.collection.updateOne({ agentCode: tR.rootCode }, { $set: { 'handleRet.orchestration': null, 'params.orchPlan': [[{ title: '再注入', query: '不该再跑', handler: 'agentChat' }]] } })
    await new Promise((r) => setTimeout(r, 1400))
    const rr3 = await rescueOrchPending({stuckMs: 1000, windowMs: 60000, max: 1})
    const rR3 = await agentTaskDac.getByCode(tR.rootCode)
    V['R3 到帽停补:capped>=1 且未再派发（orchestration 仍缺席、count 不加）'] =
        rr3.capped >= 1 && (rr3.rescued || 0) === 0 && !rR3.handleRet?.orchestration && (rR3.params?.orchRescue?.count || 0) === 1
    orch.enabled = false
} catch (e) {
    out.error = String(e?.stack || e?.message || e).slice(0, 500)
}
// ===== 清场 =====
const resOn = await sweep(tOn ? tOn.rootCode : '', tOn && tOn.conversationCode)
const resOff = tOff ? await sweep(tOff.rootCode, tOff.conversationCode) : -1
const resR = tR ? await sweep(tR.rootCode, tR.conversationCode) : -1
V['N7 自造行清尽（三树血统 residual=0）'] = resOn === 0 && resOff === 0 && resR === 0
out.residual = { on: resOn, off: resOff, rescue: resR }
out.verdict = V
const pass = Object.values(V).filter(Boolean).length
out.结论 = pass === EXPECTED ? `分层扇出 e2e 通过(${EXPECTED}/${EXPECTED}：层推进/时序/产出注入/全层收口/OFF 不装完成/恢复补派+帽/零残留)` : `未全真 ${pass}/${EXPECTED}——读数见上`
console.log(JSON.stringify(out, null, 1))
process.exit(pass === EXPECTED ? 0 : 1)
