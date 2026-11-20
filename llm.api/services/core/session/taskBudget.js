/**
 * @fileOverview 会话任务树的预算/并行度降级判定（PR-任务编排 M1-a，纯函数）
 * @module services/core/session/taskBudget
 * @description
 * 多智能体是 token 的**乘法放大器**：无上限地 fan-out，成本会瞬间失控。这里给"还能不能再开子任务、
 * 超预算怎么降级"一个可离线穷举的判定，供 planner/编排器消费。属主拍板的本期默认值编码在此：
 * 单 root 子任务 ≤4、单 root 预算天花板 ≤1,000,000 token。
 *
 * 判定与计数分离：调用方喂 `rootTokensUsed`（该 root 已消耗）与 `plannedSubtasks`（本轮想开的子任务数），
 * 这里只出决策，不查库、不读 redis。
 *
 * 降级阶梯（`degrade`）不是二值通过/拒绝，而是**给出退路**，与"缺席如实标注、别一刀切"的一贯纪律同族：
 * - none          ：预算与并行度都够；
 * - cap-subtasks  ：预算够但请求的子任务数超上限 ⇒ 削到上限；
 * - single-agent  ：预算逼近/超出，并行只会更快烧穿 ⇒ 收回单智能体，别 fan-out。
 * 阈值 `degradeRatio`（默认 0.85）：已用达天花板此比例即不再 fan-out（留出收尾余量，避免开到一半爆预算）。
 */

export const DEFAULT_SUBTASK_CEILING = 4
export const DEFAULT_ROOT_TOKEN_CEILING = 1_000_000
export const DEFAULT_DEGRADE_RATIO = 0.85

/**
 * @description 判定一个 root 本轮能不能开、开几个、要不要降级
 * @param {Object} [p]
 * @param {Number} [p.rootTokensUsed] 该 root 已累计 token
 * @param {Number} [p.rootTokenCeiling] 单 root 预算天花板（默认 100 万；<=0=不限）
 * @param {Number} [p.plannedSubtasks] 本轮计划开的子任务数
 * @param {Number} [p.subtaskCeiling] 单 root 子任务上限（默认 4；<=0=不限）
 * @param {Number} [p.degradeRatio] 逼近天花板的降级比例（默认 0.85）
 * @param {Number} [p.perSubtaskTokenEstimate] 单子任务预估 token（可选；给了就按"开了会不会爆"预检）
 * @returns {{ok:Boolean, allowedSubtasks:Number, degrade:'none'|'cap-subtasks'|'single-agent', reason:String}} 判定
 */
export function checkBudget({
    rootTokensUsed = 0,
    rootTokenCeiling = DEFAULT_ROOT_TOKEN_CEILING,
    plannedSubtasks = 0,
    subtaskCeiling = DEFAULT_SUBTASK_CEILING,
    degradeRatio = DEFAULT_DEGRADE_RATIO,
    perSubtaskTokenEstimate = 0,
} = {}) {
    const used = Math.max(0, Number(rootTokensUsed) || 0)
    const want = Math.max(0, Math.floor(Number(plannedSubtasks) || 0))
    const ceil = Number(rootTokenCeiling) > 0 ? Number(rootTokenCeiling) : 0
    const subCap = Number(subtaskCeiling) > 0 ? Math.floor(Number(subtaskCeiling)) : 0
    const est = Math.max(0, Number(perSubtaskTokenEstimate) || 0)
    const ratio = Number(degradeRatio) > 0 && Number(degradeRatio) < 1 ? Number(degradeRatio) : DEFAULT_DEGRADE_RATIO

    // 预算不限（ceil<=0）：只看子任务上限
    if (ceil <= 0) {
        const allowed = subCap > 0 ? Math.min(want, subCap) : want
        if (subCap > 0 && want > subCap) {
            return { ok: true, allowedSubtasks: allowed, degrade: 'cap-subtasks', reason: 'subtask-ceiling' }
        }
        return { ok: true, allowedSubtasks: allowed, degrade: 'none', reason: 'budget-off' }
    }

    // 已破天花板：无论有没有预估都开不动了（放最前，防 est 分支把"超支"误算成 0 余量之外的其它话）
    if (used >= ceil) {
        return { ok: false, allowedSubtasks: 0, degrade: 'single-agent', reason: 'over-ceiling' }
    }

    // 给了单娃预估 ⇒ 按"开 want 个会不会爆预算"预检优先于比例短路（900k/100万配 200k/娃，
    // 实际只付得起 0 个，该判 no-headroom，而不是被"逼近比例"短路成还能单发）
    if (est > 0) {
        const headroom = ceil - used
        const affordable = Math.floor(headroom / est)
        let allowed = Math.min(want, affordable)
        if (subCap > 0) allowed = Math.min(allowed, subCap)
        if (allowed < 1) {
            return { ok: false, allowedSubtasks: 0, degrade: 'single-agent', reason: 'no-headroom' }
        }
        if (subCap > 0 && want > subCap) {
            return { ok: true, allowedSubtasks: allowed, degrade: 'cap-subtasks', reason: 'subtask-ceiling' }
        }
        if (allowed < want) {
            return { ok: true, allowedSubtasks: allowed, degrade: 'cap-subtasks', reason: 'budget-headroom' }
        }
        return { ok: true, allowedSubtasks: allowed, degrade: 'none', reason: 'ok' }
    }

    // 未给预估：已逼近天花板 ⇒ 收回单智能体（留出收尾余量，避免开到一半爆预算）
    if (used >= ceil * ratio) {
        return { ok: true, allowedSubtasks: 1, degrade: 'single-agent', reason: 'near-ceiling' }
    }

    // 未给预估且预算充裕：只按子任务上限裁剪
    const allowed = subCap > 0 ? Math.min(want, subCap) : want
    if (subCap > 0 && want > subCap) {
        return { ok: true, allowedSubtasks: allowed, degrade: 'cap-subtasks', reason: 'subtask-ceiling' }
    }
    return { ok: true, allowedSubtasks: allowed, degrade: 'none', reason: 'ok' }
}

/**
 * budget_degraded 事件的**发射判据**（§7-3；与母本同源）。白名单不是黑名单：新出的
 * reason 值默认不发——事件面宁缺毋滥。subtask-ceiling（静态并行上限）不发：每棵超限
 * 普通树都响一发=噪音；budget:* 前缀（replan 侧包装）与 budget-exhausted（追活闸侧）
 * 发——同一批 checkBudget reason 被调用方包装后的真形，分包装认源头。
 * @param {Object} [p]
 * @param {String} [p.degrade] checkBudget 降级档
 * @param {String} [p.reason] checkBudget 原话或带前缀包装话
 * @returns {Boolean} 是否应发 budget_degraded
 */
export function budgetDegradedWorthy({ degrade, reason } = {}) {
    if (degrade !== 'cap-subtasks' && degrade !== 'single-agent') return false
    const r = String(reason || '')
    if (BUDGET_DEGRADED_REASONS.has(r)) return true
    return r.startsWith('budget:') || r.startsWith('budget-exhausted')
}

/** 预算引起的降级 reason 白名单（与 checkBudget 出话一一对应，新增必来这登记） */
export const BUDGET_DEGRADED_REASONS = new Set([
    'over-ceiling', 'no-headroom', 'near-ceiling', 'budget-headroom',
])

export default { checkBudget, budgetDegradedWorthy, BUDGET_DEGRADED_REASONS, DEFAULT_SUBTASK_CEILING, DEFAULT_ROOT_TOKEN_CEILING, DEFAULT_DEGRADE_RATIO }
