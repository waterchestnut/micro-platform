/**
 * @fileOverview replan 换代真机 e2e（PR-任务编排 (f) 的补验项：换代路径此前只有假 deps 覆盖）
 * @module evals/platform-probes/fanout-replan-e2e-probe
 * @description
 * 全败树逼 arbitrate 走完 `retry×2 → replan → 换代`：
 *   两槽都挂 turnRunner 缺 conversationCode（确定性 -1，**零 relay**，重试也必然重演）
 *   → retryCount 用尽 && successCount===0 ⇒ action=replan（autoFollow+planner 开）
 *   → **真 planner 低档调用**重新拆解（1 次）→ 新代 planRound=1 的 agentChat 子任务真跑（2 次小 relay）
 *   → 新代全成 ⇒ synthesize → 综合真落 `root:<rootCode>`（1 次）。
 * 钉六条换代语义（读数全真才算补验完成）：
 *   R1 换代真发生：存在 planRound>=1 的 child 行，follow.replanCount===1；
 *   R2 计数看 active：库里 6 条 -1 行，但 orchestration.counts.failed===0、success>=2（旧代不遮新代成功）；
 *   R3 终态行不改写：6 条 -1（2 原 + 4 retry）原样，无一被改回 0/2；
 *   R4 新代全成收口：root=2、action=synthesize、综合真落 root:<rootCode> 且有正文；
 *   R5 花钱看全树：totalCredits==Σ 新代成功行的账本行（retry 的旧代成功行本例不存在，missing 如实 6）；
 *   R6 审计链：follow.superseded 恰为 6（2 原代 + 4 retry），spawned===6。
 * 零 Kafka（manual root + 手动派发 finalize；B1 触发关，防双 finalize 竞态——同 follow 探针口径）。
 * 用法：node evals/platform-probes/fanout-replan-e2e-probe.mjs ；花真实 relay≈4 次小调用，属授权实测。
 */
await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

const userCode = 'menglb'
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const V = {}
const out = {}
const EXPECTED = 6

const badSlot = (title) => ({
    title, handler: 'turnRunner', query: `${title}（该子任务设计为确定性失败）`,
    params: { query: `${title}（该子任务设计为确定性失败）` },
})

try {
    const orch = llm.config.agentTask.fanOutOrchestration
    orch.enabled = false        // B1 自动触发关：finalize 由本探针手动派发，防双 finalize 竞态
    orch.autoFollow = true
    llm.config.agentTask.fanOutPlanner.enabled = true   // replan 的拆解机要开着

    // ---- 建树：两槽必败（turnRunner 缺 conversationCode，-1 零 relay）
    const conversationCode = `fano-replan-${Date.now()}`
    const originalQuery = '请分别说明 TCP 三次握手的过程和 TCP 流量控制的作用，最后各给一句适用场景。'
    const plan = normalizeFanOutPlan({ subtasks: [badSlot('槽A'), badSlot('槽B')], subtaskCeiling: 4 })
    const root = buildRootTask({
        conversationCode, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: { userCode },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    const rootCode = root.agentCode
    await execAgentTask(await agentTaskDac.getByCode(rootCode))

    // ---- 手动派发 finalize：循环里该发生 retry×2 → replan 换代 → 新代真跑 → synthesize
    const finTask = {
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode, operator: { userCode },
        params: { rootCode, originalQuery, channel: 'micro_common', protocol: 2 },
    }
    const finRet = await execAgentTask(finTask)
    out.handlerError = finRet?.errorMsg || (finRet?.handleStatus === -1 ? 'finalize status=-1' : null)

    const doneRoot = await agentTaskDac.getByCode(rootCode)
    const rows = []
    for (const s of (doneRoot.subAgents || [])) {
        const c = await agentTaskDac.getByCode(s.agentCode)
        if (c) rows.push(c)
    }
    const newGen = rows.filter((c) => (c.params?.planRound || 0) >= 1)
    const failed = rows.filter((c) => c.handleStatus === -1)
    const orchBlock = doneRoot.handleRet?.orchestration || {}
    out.summary = {
        subs: rows.length, newGen: newGen.length, failedRows: failed.length,
        status: doneRoot.handleStatus, action: orchBlock.action, counts: orchBlock.counts,
        follow: { replanCount: orchBlock.follow?.replanCount, retryCount: orchBlock.follow?.retryCount, spawned: orchBlock.follow?.spawned, superseded: orchBlock.follow?.superseded?.length, degrade: orchBlock.follow?.degrade },
        credits: orchBlock.credits && { total: orchBlock.credits.totalCredits, count: orchBlock.credits.count, missing: orchBlock.credits.missing?.length },
    }
    V['R1 换代真发生:存在 planRound>=1 的子行且 follow.replanCount=1'] = newGen.length >= 2 && orchBlock.follow?.replanCount === 1
    V['R2 计数看 active:库里 6 条 -1 但 counts.failed=0、success>=2'] = failed.length === 6
        && orchBlock.counts?.failed === 0 && (orchBlock.counts?.success || 0) >= 2
    V['R3 终态行不改写:2 原代+4 retry 全在且仍 -1'] = failed.length === 6 && rows.length === 8
    V['R4 新代全成:synthesize 且综合真落 root:<rootCode> 有正文'] = doneRoot.handleStatus === 2 && orchBlock.action === 'synthesize'
    const synthCode = doneRoot.handleRet?.synthesis?.messageCode
    const synthDoc = synthCode ? await messageDac.getByCode(synthCode) : null
    if (V['R4 新代全成:synthesize 且综合真落 root:<rootCode> 有正文']) {
        V['R4 新代全成:synthesize 且综合真落 root:<rootCode> 有正文'] = !!synthDoc
            && synthDoc.conversationCode === `root:${rootCode}` && String(synthDoc.answer || '').trim().length > 0
    }

    // R5：新代成功行的账本逐条对
    let sumNewGen = 0
    let newGenWithUsage = 0
    for (const c of newGen.filter((x) => x.handleStatus === 2)) {
        const u = await llmUsageDac.getByCode(c.agentCode)
        if (u && typeof u.credits === 'number') { sumNewGen += u.credits; newGenWithUsage++ }
    }
    V['R5 花钱看全树:totalCredits==Σ新代成功行账本,missing 恰为 6 条无账失败'] = newGenWithUsage >= 2
        && Math.abs((orchBlock.credits?.totalCredits || 0) - sumNewGen) < 1e-9
        && orchBlock.credits?.missing?.length === 6
    V['R6 审计链:superseded=6、spawned=6(retry4+换代2)'] = orchBlock.follow?.superseded?.length === 6 && orchBlock.follow?.spawned === 6
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && !out.handlerError && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : out.handlerError ? `未通(handler 错:${out.handlerError})`
        : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'replan 换代真机补验通过(全败→retry尽→换代→新代成→综合落 root)' : '未通(见 false 项)'
console.log('\n==== FANOUT-REPLAN E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
