/**
 * @fileOverview M6 credits 端到端核账（PR-任务编排：账本列 → child handleRet → root rollup 全链真值）
 * @module evals/platform-probes/m6-credits-e2e-probe
 * @description
 * M6 的验收口径（属主拍板、设计 §验收④）："credits rollup 与逐子 llmUsage 对账一致"。
 * 本探针跑一棵真树（2×agentChat 真 relay），然后**从三条独立来源核同一件事**：
 *   ① 每个 child 的 llmUsage 行：credits 列真落了（>0），creditsPriced:false（本期无权重，诚实未计价）；
 *   ② child 的 agentTask.handleRet.credits == 它自己的 llmUsage 行（读取侧搬运不失真，不重算）；
 *   ③ finalize 后 root.handleRet.orchestration.credits.totalCredits == Σ①，且 priced:false、count==2。
 * 任何一环对不上都算 M6 未过——"全绿但没核过账"正是这条验收要防的。
 * manual root + direct finalize（同 fanout-finalize 探针路数）：零 Kafka。跑完显式 process.exit。
 * 用法：node evals/platform-probes/m6-credits-e2e-probe.mjs
 */
await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

const userCode = 'menglb'
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const conversationCode = `m6probe-${Date.now()}`
const out = { 起点: { conversationCode } }
const V = {}
const EXPECTED = 6

try {
    const plan = normalizeFanOutPlan({
        subtasks: [
            { title: '算术', query: '用一句话回答：7+8 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
            { title: '颜色', query: '用一句话回答：叶子为什么是绿的？', params: { execOptionsExtra: CHILD_EXTRA } },
        ],
        subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: { userCode },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    const rootCode = root.agentCode
    await execAgentTask(await agentTaskDac.getByCode(rootCode))

    // ① 逐 child：llmUsage 行（账本源头）
    const afterTree = await agentTaskDac.getByCode(rootCode)
    const children = []
    for (const s of (afterTree.subAgents || [])) {
        const child = await agentTaskDac.getByCode(s.agentCode)
        if (!child) continue
        const usage = await llmUsageDac.getByCode(child.agentCode) // agentChat 的 childMessageCode 默认=agentCode
        children.push({
            agentCode: child.agentCode, status: child.handleStatus,
            handleRetCredits: child.handleRet?.credits, handleRetPriced: child.handleRet?.creditsPriced,
            rowCredits: usage?.credits, rowPriced: usage?.creditsPriced,
            rowTokens: usage ? { p: usage.promptTokens, c: usage.completionTokens } : null,
        })
    }
    out.children = children
    V['① 每 child 的 llmUsage 行 credits 真落了(>0)'] = children.length === 2
        && children.every((x) => typeof x.rowCredits === 'number' && x.rowCredits > 0)
    V['①b 本期无权重 ⇒ creditsPriced:false（不假装是钱）'] = children.every((x) => x.rowPriced === false)
    V['② handleRet 搬运 == 账本行（读取侧没重算出口径）'] = children.every(
        (x) => x.handleRetCredits === x.rowCredits && x.handleRetPriced === false)

    // ③ finalize → root rollup 对账
    const finTask = {
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode, operator: { userCode },
        params: { rootCode, channel: 'micro_common', protocol: 2, execOptionsExtra: CHILD_EXTRA },
    }
    await execAgentTask(finTask)
    const doneRoot = await agentTaskDac.getByCode(rootCode)
    const roll = doneRoot.handleRet?.orchestration?.credits
    const sum = children.reduce((a, x) => a + (x.rowCredits || 0), 0)
    out.rollup = { roll, sum, action: doneRoot.handleRet?.orchestration?.action }
    V['③ root rollup == Σ child 账本行（验收④口径）'] = !!roll && Math.abs(roll.totalCredits - sum) < 1e-9
    V['③b rollup count==2 且 priced:false（混合来源不谎报已计价）'] = roll?.count === 2 && roll?.priced === false
    // ④ 交叉：未配权重时 credits 必须等于 token 计数（退化口径本身可核）
    V['④ credits==prompt+completion（退化口径可核，不是黑箱数）'] = children.every(
        (x) => x.rowTokens && Math.abs(x.rowCredits - (x.rowTokens.p + x.rowTokens.c)) < 1e-9)
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'M6 credits 核账通过(账本→handleRet→rollup 三源一致)' : '未通(见 false 项)'
console.log('\n==== M6 CREDITS E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
