/**
 * @fileOverview 追活(retry)端到端取证（PR-任务编排 f）：真引擎真库里跑完整的"失败→追加→耗尽→如实报"
 * @module evals/platform-probes/fanout-follow-e2e-probe
 * @description
 * runFollowLoop 的判据路径已被假 deps 真跑（fanOutFollow.test.js）；本探针验的是**它与真引擎/真库的接合**：
 * insertSubAgentTask 挂回父、execAgentTask 真执行 retry 行、updateParent 汇聚不被追活打穿、finalize 写回两口径。
 *
 * 试验树故意做成"一个真成功 + 一个**确定性失败**"：失败槽用 turnRunner 且不给 conversationCode
 * （缺身份校验 ⇒ handleStatus -1，**零 relay**）；成功槽 agentChat 真问一句（1 次 relay/phase）。
 * 裁决必然走 retry×2 → 预算尽 → partial-report。这样"失败必然重演"，读数稳定，且不为凑失败烧钱。
 *
 * 两阶段：
 *   OFF autoFollow=false ⇒ 行为必须与已上线的 A/B1 一致：不派任何活、root 悬 1、dispatch 如实回传；
 *   ON  autoFollow=true  ⇒ 追活循环真跑：subAgents 2→4、retry 行带 retryOf/followRound、**旧 -1 行不改写**、
 *     counts.failedCount==1（active 口径：3 条失败行只数每槽最新那条）、credits=成功槽账本行、missing 如实。
 * 零 Kafka（manual root + 直接派发 finalize，同 m6 探针路数）。跑完显式 process.exit。
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
const V = {}
const out = { phases: {} }
const EXPECTED = 9

async function buildAndRunTree(suffix) {
    const conversationCode = `follprobe-${suffix}-${Date.now()}`
    const plan = normalizeFanOutPlan({
        subtasks: [
            { title: '算术(成)', query: '用一句话回答：6+7 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
            // 失败槽：turnRunner 且不给 conversationCode ⇒ 确定性 -1、零 relay（缺身份/缺会话都在调模型之前挡下）
            { title: '必败槽', handler: 'turnRunner', query: '这句话永远不会被执行', params: { query: '这句话永远不会被执行' } },
        ],
        subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: { userCode },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    await execAgentTask(await agentTaskDac.getByCode(root.agentCode))
    return { rootCode: root.agentCode, conversationCode }
}

const outHandlerErrors = []

async function dispatchFinalize(rootCode, conversationCode) {
    const finTask = {
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode, operator: { userCode },
        params: { rootCode, originalQuery: '6+7 等于几（一成一败试验树）', channel: 'xxzx_common', protocol: 2, execOptionsExtra: CHILD_EXTRA },
    }
    const finRet = await execAgentTask(finTask)
    const root = await agentTaskDac.getByCode(rootCode)
    // handler 若抛错,execAgentTaskCore 会吞成 ret——探针必须把它浮出来,别再出现"静默没写"只能猜
    const handlerError = finRet?.errorMsg || (finRet?.handleStatus === -1 ? 'finalize status=-1' : null)
    if (handlerError) outHandlerErrors.push(`${rootCode}: ${String(handlerError).slice(0, 300)}`)
    return root
}

async function readChildren(root) {
    const rows = []
    for (const s of (root.subAgents || [])) {
        const c = await agentTaskDac.getByCode(s.agentCode)
        if (c) rows.push(c)
    }
    return rows
}

try {
    const orch = llm.config.agentTask.fanOutOrchestration
    /**
     * 本探针**手动派发** finalize（B1 的自动触发已有自己的 e2e）——所以 enabled=false：
     * 否则"树跑完自动派一发 + 探针手派一发"= 同 root 双 finalize 并发，断言读的是竞态不是逻辑。
     * autoFollow 与 enabled 各管各的（前者管 finalize 内追不追活，后者管 B1 触发），这里只动后者。
     */
    orch.enabled = false
    // ================= 阶段 OFF：§7-4 升级后形态——不派活、但裁决终局收口（不悬 1） =================
    orch.autoFollow = false
    const tOff = await buildAndRunTree('off')
    const rOff = await dispatchFinalize(tOff.rootCode, tOff.conversationCode)
    const cOff = await readChildren(rOff)
    out.phases.OFF = { subs: rOff.subAgents.length, status: rOff.handleStatus, action: rOff.handleRet?.orchestration?.action, spawned: rOff.handleRet?.orchestration?.follow?.spawned, degrade: rOff.handleRet?.orchestration?.follow?.degrade }
    V['OFF1 不派活:subAgents 仍 2、follow.spawned=0'] = rOff.subAgents.length === 2 && rOff.handleRet?.orchestration?.follow?.spawned === 0
    // §7-4：finalize 只派发一次，OFF 的 retry 裁决若悬 1 = 永久死悬（dev 实测 5 棵）——降级 report(3)，
    // 原裁决留 dispatch.needRetry/reason 审计（"该追未追"看得见，但树不再装"进行中"）。
    V['OFF2 无承接方降级:report(3)+degrade 留痕+dispatch 如实回传'] = rOff.handleStatus === 3
        && rOff.handleRet?.orchestration?.action === 'report' && /原裁决:retry/.test(String(rOff.handleRet?.orchestration?.reason || ''))
        && rOff.handleRet?.orchestration?.follow?.degrade === 'auto-follow-off'
        && rOff.handleRet?.orchestration?.dispatch?.needRetry === true
    V['OFF3 失败行没被追活动过(-1 原样)'] = cOff.filter((c) => c.handleStatus === -1).length === 1

    // ================= 阶段 ON：真追活 =================
    orch.autoFollow = true
    const tOn = await buildAndRunTree('on')
    const rOn = await dispatchFinalize(tOn.rootCode, tOn.conversationCode)
    const cOn = await readChildren(rOn)
    const bySlot = {}
    for (const c of cOn) {
        const slot = c.params?.retryOf || c.agentCode
        bySlot[slot] = (bySlot[slot] || 0) + 1
    }
    const failedRows = cOn.filter((c) => c.handleStatus === -1)
    const retryRows = cOn.filter((c) => c.params?.retryOf)
    const succRows = cOn.filter((c) => c.handleStatus === 2)
    // 成功槽的账本行（credits 源）
    const succUsage = succRows.length ? await llmUsageDac.getByCode(succRows[0].agentCode) : null
    out.phases.ON = {
        subs: rOn.subAgents.length, status: rOn.handleStatus, action: rOn.handleRet?.orchestration?.action,
        reason: rOn.handleRet?.orchestration?.reason, follow: rOn.handleRet?.orchestration?.follow,
        counts: rOn.handleRet?.orchestration?.counts, credits: rOn.handleRet?.orchestration?.credits,
        failedRows: failedRows.length, retryRounds: retryRows.map((c) => c.params?.followRound),
    }
    V['ON1 retry 真追加:subAgents 2→4,retry 行 followRound=1,2'] = rOn.subAgents.length === 4
        && retryRows.length === 2 && [1, 2].every((n) => retryRows.some((c) => c.params?.followRound === n))
    V['ON2 终态行不改写:3 条 -1 都在(2 retry+1 原),没有行被改回 0/2'] = failedRows.length === 3 && cOn.length === 4
    V['ON3 预算耗尽如实收口:report/partial,root=3(不悬 1、不假 synthesize)'] = rOn.handleStatus === 3
        && rOn.handleRet?.orchestration?.action === 'report' && rOn.handleRet?.orchestration?.reason === 'partial-report'
    V['ON4 计数看 active:failed=1(不是 3!)、usable=1'] = rOn.handleRet?.orchestration?.counts?.failed === 1
        && rOn.handleRet?.orchestration?.counts?.usable === 1
    V['ON5 花钱看 all:credits==成功槽账本行,missing 如实含无账失败行'] = !!succUsage && typeof succUsage.credits === 'number' && succUsage.credits > 0
        && Math.abs((rOn.handleRet?.orchestration?.credits?.totalCredits || 0) - succUsage.credits) < 1e-9
        && (rOn.handleRet?.orchestration?.credits?.missing?.length || 0) === 3
    V['ON6 follow 审计:retryCount=2,superseded=2'] = rOn.handleRet?.orchestration?.follow?.retryCount === 2
        && (rOn.handleRet?.orchestration?.follow?.superseded?.length || 0) === 2
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && !outHandlerErrors.length && ran === EXPECTED && Object.values(V).every(Boolean)
out.handlerErrors = outHandlerErrors
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : outHandlerErrors.length ? `未通(handler 吞错:${outHandlerErrors[0]})`
        : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '追活 e2e 通过(关=现网不变 / 开=真追加+active计数+all花钱账)' : '未通(见 false 项)'
console.log('\n==== FANOUT-FOLLOW E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
