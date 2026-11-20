/**
 * @fileOverview 任务详情视图装配（PR-任务编排 §5-3，纯函数）
 * @module services/core/session/taskDetail
 * @description
 * 给前端的"任务详情/进度"视图——**只装配既有事实，不重算任何判定**：
 * - 子任务状态取 agentTask 行原样；`active/superseded` 判定**转调** fanOutFollow 的槽位函数（同一口径，
 *   两处各算必分叉——D66）；`orchestration/synthesis` 从 root.handleRet **透传**（finalize 写的原样，
 *   端点不补写"看起来更完整"的字段）。
 * - 正文只给**摘要**（截断如实标 truncated）：详情面=状态+摘要，读全文走既有 `/core/message/list`
 *   （root 会话/child 档案），与 PR-H"dropped 要诚实标注"同族——不拿摘要冒充全文。
 * - `phase` 是给 UI 的一句话总态，映射表见 taskPhase（cancelled 最优先：用户意志不被旧裁决掩盖）。
 * 归属/scope 判定在端点层（fail-closed），本件是"数据到手后怎么如实摆出来"。
 */
import { activeAttempts } from '../../agent/fanOutFollow.js'

const PREVIEW_CHARS = 120

const CHILD_PHASE = { 0: 'queued', 1: 'running', 2: 'done', [-1]: 'failed', 3: 'done-with-error' }

/**
 * @description 树总相位（映射表穷举在测试里）。顺序即优先级。
 * @param {Object} root root 行
 * @returns {String} queued|running|synthesizing|synthesized|partial|failed|cancelled
 */
export function taskPhase(root) {
    const orch = root?.handleRet?.orchestration || {}
    if (orch.cancelled === true) return 'cancelled'
    if (root?.handleStatus === 0) return 'queued'
    // §7-1 澄清挂起：finalize 截胡把 action 写成 await-input——"在等人"不是"在跑"，必须抢在 running 前
    if (orch.action === 'await-input') return 'awaiting_input'
    const kids = (root?.subAgents || [])
    const anyOpen = kids.some((s) => s.handleStatus === 0 || s.handleStatus === 1)
    if (root?.handleStatus === 1 || anyOpen) return 'running'
    if (!orch.action) return 'synthesizing' // children 全终、finalize 未落——"收尾中"，不混 running 也不装 synthesized
    if (orch.action === 'synthesize') {
        const s = root?.handleRet?.synthesis
        if (s?.usable === true) return 'synthesized'
        return 'synthesizing' // 裁决要综合、回执未落/空——绝不提前报 synthesized
    }
    // report（或在 root 已终态上读到 retry/replan 的边角）：按可用产出如实二值，不造第三种猜测
    return (orch.counts?.usable || 0) > 0 ? 'partial' : 'failed'
}

/**
 * @description 装配详情视图
 * @param {Object} p
 * @param {Object} p.root 编排 root 行（含 handleRet.orchestration/synthesis）
 * @param {Array} p.rows 全树行（含 root 自己，agentCodePath 查得）
 * @returns {{agentCode:String, phase:String, title:String, insertTime:*, updateTime:*,
 *            subtasks:Array, orchestration:Object|null, synthesis:Object|null}}
 */
export function buildTaskDetailView({ root, rows = [] } = {}) {
    const activeSet = new Set(activeAttempts(rows.filter((r) => r && r.agentCode !== root.agentCode)).map((r) => r.agentCode))
    const subtasks = rows
        .filter((r) => r && r.agentCode !== root.agentCode)
        .map((r) => {
            const hr = r.handleRet || {}
            const content = String(hr.content || '')
            const preview = content ? content.slice(0, PREVIEW_CHARS) : null
            return {
                agentCode: r.agentCode,
                title: r.title || '',
                handleStatus: r.handleStatus,
                phase: CHILD_PHASE[r.handleStatus] || 'unknown',
                slot: r.params?.retryOf || r.agentCode,
                planRound: Number(r.params?.planRound) || 0,
                followRound: Number(r.params?.followRound) || 0,
                layerIndex: Number(r.params?.layerIndex) || 0, // §8 行所属层（0=首批/非分层）
                active: activeSet.has(r.agentCode), // false=被更新的尝试取代（历史，仍如实陈列）
                preview,
                previewTruncated: content ? content.length > PREVIEW_CHARS : false,
                note: hr.note || hr.reason || null,
                credits: typeof hr.credits === 'number' ? hr.credits : null,
            }
        })
    const orch = root.handleRet?.orchestration || null
    return {
        agentCode: root.agentCode,
        phase: taskPhase(root),
        title: root.title || '',
        conversationCode: root.conversationCode || null,
        insertTime: root.insertTime || null,
        updateTime: root.updateTime || null,
        subtasks,
        // 透传不重算：counts/credits/follow/dispatch 都是 finalize/cancel 写下的原事实
        orchestration: orch ? {
            action: orch.action || null, reason: orch.reason || null, cancelled: orch.cancelled === true,
            counts: orch.counts || null, credits: orch.credits || null,
            dispatch: orch.dispatch || null, follow: orch.follow || null,
        } : null,
        synthesis: root.handleRet?.synthesis || null,
        // §8 分层计划可见性（透传不重算）：pendingLayers=库里未消费层数（写侧逐层收敛，
        // 非空=finalize 没写完——与恢复判据同一事实源），spawnedLayers 取 follow 原账。
        // 平铺树= null：不造 {0,0} 的空计划冒充"分层过"。
        plan: (() => {
            const pending = Array.isArray(root.params?.orchPlan) ? root.params.orchPlan.length : 0
            const spawned = Number(orch?.follow?.spawnedLayers) || 0
            return pending || spawned ? {pendingLayers: pending, spawnedLayers: spawned} : null
        })(),
        // §7-1：澄清挂起清单透传（hold 是 finalize 写的原样；无挂起=null，不造空数组冒充"已答完"）
        clarify: root.params?.clarifyHold?.requests?.length || root.params?.clarifyHold?.capped?.length
            ? {requests: root.params.clarifyHold.requests || [], capped: root.params.clarifyHold.capped || [], sealedAt: root.params.clarifyHold.sealedAt || null}
            : null,
    }
}

export default { buildTaskDetailView, taskPhase }
