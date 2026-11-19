/**
 * @fileOverview fan-in 后的失败裁决判定（PR-任务编排 M1-a，纯函数）
 * @module services/agent/arbitrationPolicy
 * @description
 * 子任务并行跑（`parallelDispatch` 用 `Promise.allSettled`，天然"部分成功"），fan-in 时父状态由
 * `updateParentAgentTaskWithLock` 归约：全成 2 / 有失败 3（部分出错）。**"部分失败"绝不能默认全有全无，
 * 也不能静默当成功**——本件给主智能体的裁决一个纯决策：该重试、该换方案、该如实汇报，还是可直接综合。
 *
 * 状态口径引 `AgentHandleStatusEnum`：leaf 子任务 -1 error / 0 waiting / 1 handling / 2 success；
 * 3 是父级"完成含错"聚合态，子任务级用 -1 判失败。
 *
 * 裁决优先级（重试预算用尽才谈换方案，换方案用尽才谈汇报；永不"假装没失败"）：
 * 1. 全成 → synthesize（直接综合，无需裁决动作）。
 * 2. 有失败且 `retryCount<maxRetry` 且失败可重试 → retry（附待重跑子 agentCode；走现有 `appendAgents`）。
 * 3. 重试耗尽且**全失败**且 `replanCount<maxReplan` → replan（缩小/改路径，交回 planner）。
 * 4. 有成功也有失败 → report（**部分成果可用但必须如实带失败项**，不伪装完整综合）。
 * 5. 全失败且换方案也耗尽 → report（终局如实）。
 *
 * 判定与执行分离：这里只出决策与应重跑的 agentCode，实际 spawn/replan/emit 由编排层执行。
 */

export const DEFAULT_MAX_RETRY = 2
export const DEFAULT_MAX_REPLAN = 1

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0 }

/**
 * @description 依子任务结果 + 已用重试/换方案次数，决定 root 的下一步
 * @param {Object} p
 * @param {Array} [p.subtasks] 子任务结果，元素含 `{agentCode, handleStatus, retryable?}`
 * @param {Number} [p.retryCount] 本 root 已重试轮次
 * @param {Number} [p.replanCount] 本 root 已换方案次数
 * @param {Number} [p.maxRetry] 重试上限（默认 2）
 * @param {Number} [p.maxReplan] 换方案上限（默认 1）
 * @returns {{action:'synthesize'|'retry'|'replan'|'report', retryAgents:String[],
 *            successCount:Number, failedCount:Number, total:Number, reason:String}} 裁决
 */
export function arbitrate({
    subtasks = [], retryCount = 0, replanCount = 0,
    maxRetry = DEFAULT_MAX_RETRY, maxReplan = DEFAULT_MAX_REPLAN,
} = {}) {
    const list = Array.isArray(subtasks) ? subtasks.filter(Boolean) : []
    const total = list.length
    const successCount = list.filter((s) => s.handleStatus === 2).length
    const failed = list.filter((s) => s.handleStatus === -1)
    const failedCount = failed.length

    // 空集合没什么可裁决：如实 report（不默认 synthesize 造一个"综合完成"的假象）
    if (total === 0) {
        return { action: 'report', retryAgents: [], successCount: 0, failedCount: 0, total: 0, reason: 'no-subtasks' }
    }

    // 还有在跑/等待的（0/1）：未到终局，不做裁决（交回调度器等 fan-in 完成）
    const stillRunning = list.some((s) => s.handleStatus === 0 || s.handleStatus === 1)
    if (stillRunning) {
        return { action: 'report', retryAgents: [], successCount, failedCount, total, reason: 'not-settled' }
    }

    // 全成
    if (failedCount === 0) {
        return { action: 'synthesize', retryAgents: [], successCount, failedCount: 0, total, reason: 'all-success' }
    }

    const retryableFailed = failed.filter((s) => s.retryable !== false)
    // 有可重试失败且预算未用尽 → retry
    if (retryableFailed.length > 0 && num(retryCount) < num(maxRetry)) {
        return {
            action: 'retry',
            retryAgents: retryableFailed.map((s) => s.agentCode).filter(Boolean),
            successCount, failedCount, total, reason: 'retryable',
        }
    }

    // 不可重试 / 重试耗尽：全失败才谈换方案
    if (successCount === 0 && num(replanCount) < num(maxReplan)) {
        return { action: 'replan', retryAgents: [], successCount, failedCount, total, reason: 'all-failed-replan' }
    }

    // 其余一律 report（部分成果带着失败项如实汇报；永不 synthesize 掩盖失败）
    return {
        action: 'report',
        retryAgents: [],
        successCount, failedCount, total,
        reason: successCount > 0 ? 'partial-report' : 'exhausted-report',
    }
}

export default { arbitrate, DEFAULT_MAX_RETRY, DEFAULT_MAX_REPLAN }
