/**
 * @fileOverview 扇出规划归一：把"候选子任务清单"裁成可入队的 subAgents 骨架（PR-任务编排 M4，纯函数）
 * @module services/agent/fanOutPlanner
 * @description
 * ⚠️ 命名先说清，别和现网另一套 `plan` 混：`services/core/session/planTool.js`/`planState.js` 里的 `plan`
 * 是**单轮 run 内的 todo 清单**（PR-M，模型自己维护、进 extInfo.plan）。这里的 **fanOut 规划**是另一件事——
 * 把一个请求**拆成多个子智能体任务**（喂 `buildRootTask` 的 `subAgents`、扇出去并发跑）。两者语义无关，
 * 故意用不同模块名/术语，避免 §8.0 那类"看着能跑其实跑错东西"。
 *
 * 规划来源不限（LLM 拆解 / 规则 / 调用方显式给）——本件**不猜怎么生成子任务**，只做那件无论来源都要做的公共事：
 * 1. 丢掉不可运行的项（子智能体是 agentChat 轮，必须有 query），**如实记 dropped 原因**，不静默少两块；
 * 2. 转调 `taskBudget.checkBudget` 定"这轮能开几个 / 要不要收回单智能体"（不重造阈值，同一契约不写两遍）；
 * 3. 超上限就裁剪到 `allowedSubtasks`，被削掉的进 dropped（cap），不假装全开了；
 * 4. 每个子任务盖一个 child handler（缺省 `agentChat`，可注入）——子任务就是要"和主会话一样能干"的 run。
 *
 * 一条刻意的边界：**本件不做依赖调度（DAG 拓扑排序）**。现网扇出引擎（parallel/sequential dispatch）按
 * 平铺 subAgents 跑，没有 deps 调度器；这里若假装支持 deps 就是过度承诺。deps 字段原样透传，排序/串并是
 * 引擎与后续 M4b 的事。失败/降级都如实回（`degrade`/`mode`/`reason`/`dropped`），供上层与 `arbitrationPolicy` 消费。
 */
import { checkBudget } from '../core/session/taskBudget.js'

export const DEFAULT_CHILD_HANDLER = 'agentChat'

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/**
 * @description 归一并裁剪一个扇出子任务清单
 * @param {Object} [p]
 * @param {Array}  [p.subtasks] 候选子任务，元素 `{title?, query?, params?, handler?, agentType?, toParentOutputKey?, errorMode?, deps?}`
 * @param {Number} [p.rootTokensUsed] 该 root 已累计 token（喂预算判定）
 * @param {Number} [p.subtaskCeiling] 单 root 子任务上限（默认 4，转 taskBudget）
 * @param {Number} [p.rootTokenCeiling] 单 root 预算天花板（默认 100 万，转 taskBudget）
 * @param {Number} [p.perSubtaskTokenEstimate] 单子任务预估 token（可选，转 taskBudget）
 * @param {Number} [p.degradeRatio] 逼近天花板降级比例（可选，转 taskBudget）
 * @param {String} [p.childHandler] 子任务默认执行体（缺省 agentChat；注入以兼容测试/其它 child）
 * @returns {{mode:'fan-out'|'single-agent', ok:Boolean, subtasks:Array, requested:Number,
 *            allowedSubtasks:Number, degrade:String, dropped:Array, reason:String}}
 */
export function normalizeFanOutPlan({
    subtasks,
    rootTokensUsed = 0,
    subtaskCeiling,
    rootTokenCeiling,
    perSubtaskTokenEstimate = 0,
    degradeRatio,
    childHandler = DEFAULT_CHILD_HANDLER,
} = {}) {
    const dropped = []
    const list = Array.isArray(subtasks) ? subtasks : []

    // 1) 可行性过滤：子智能体轮必须有可跑的 query（title 只作展示，不能当输入喂 execChat）
    const runnable = []
    list.forEach((s, i) => {
        if (!s || typeof s !== 'object') { dropped.push({ index: i, title: '', reason: 'not-an-object' }); return }
        const query = String(s.query || s.params?.query || '').trim()
        if (!query) { dropped.push({ index: i, title: s.title || '', reason: 'no-query' }); return }
        runnable.push({ ...s, title: s.title || query.slice(0, 30), query })
    })

    const requested = runnable.length
    if (requested === 0) {
        // 没东西可扇出：收回单智能体（或直接不建 root），如实说 no-subtasks，不造一个空 fan-out
        return { mode: 'single-agent', ok: true, subtasks: [], requested: 0, allowedSubtasks: 0, degrade: 'single-agent', dropped, reason: 'no-subtasks' }
    }

    // 2) 预算/并行度判定（转 taskBudget，不重造阈值）
    const bud = checkBudget({
        rootTokensUsed: num(rootTokensUsed),
        plannedSubtasks: requested,
        subtaskCeiling,
        rootTokenCeiling,
        perSubtaskTokenEstimate: num(perSubtaskTokenEstimate),
        degradeRatio,
    })

    // 3) 预算判定"该收回单智能体"（degrade single-agent，含逼近天花板/破顶/无余量三态）⇒ 一个子任务都不扇，
    //    交回上层按单智能体跑原请求。taskBudget 对 'single-agent' 的定义就是"别 fan-out"，标签为准（不是只看 ok/allowed）。
    if (!bud.ok || bud.allowedSubtasks < 1 || bud.degrade === 'single-agent') {
        runnable.forEach((s, j) => dropped.push({ index: j, title: s.title, reason: `budget:${bud.reason}` }))
        return { mode: 'single-agent', ok: false, subtasks: [], requested, allowedSubtasks: 0, degrade: 'single-agent', dropped, reason: bud.reason }
    }

    // 4) 裁剪到 allowedSubtasks；被削的进 dropped（cap），如实可见
    const keep = runnable.slice(0, bud.allowedSubtasks)
    runnable.slice(bud.allowedSubtasks).forEach((s, j) =>
        dropped.push({ index: bud.allowedSubtasks + j, title: s.title, reason: `cap:${bud.allowedSubtasks}` }))

    // 5) 盖 child handler（缺省 agentChat，不覆盖调用方显式给的 handler）——共享件见 stampChildHandler
    const normalized = stampChildHandler(keep, childHandler)

    return {
        mode: 'fan-out',
        ok: true,
        subtasks: normalized,
        requested,
        allowedSubtasks: normalized.length,
        degrade: bud.degrade,                  // 'none' 或 'cap-subtasks'
        dropped,
        reason: bud.reason,
    }
}

/**
 * @description 子任务项盖 child handler/执行形状（normalize 第 5 步的**单源件**）——
 * §8 分层模式里后续层（orchPlan 存量）spawn 时必须走同一函数：同一项形状两处定义=D66 分叉。
 * id/deps 住进 params（不是顶层键）：子行入库经 format 只带 params——**层行要能在库里被
 * `params.id` 反查**，下游层拼上游产出全靠这个锚（顶层键会被 format 丢=教训"未声明静默丢"的变体）。
 * @param {Array} subtasks 已通过可行性/预算的项（含 query）
 * @param {String} [childHandler] 缺省执行体（agentChat）
 * @returns {Array} buildRootTask.subtasks / buildReplanSpecs 兼容形
 */
export function stampChildHandler(subtasks, childHandler = DEFAULT_CHILD_HANDLER) {
    return (subtasks || []).filter(Boolean).map((s) => ({
        title: s.title,
        query: s.query,
        handler: s.handler || childHandler,
        agentType: s.agentType || 'local',
        params: {
            ...(s.params || {}),
            query: s.query,
            ...(s.id ? { id: s.id } : {}),
            ...(s.deps ? { deps: s.deps } : {}),
        },
        toParentOutputKey: s.toParentOutputKey,
        errorMode: s.errorMode || 'break',
        ...(s.deps ? { deps: s.deps } : {}),   // 顶层也留一份（graph/service 内存面判据用）
    }))
}

export default { normalizeFanOutPlan, stampChildHandler, DEFAULT_CHILD_HANDLER }
