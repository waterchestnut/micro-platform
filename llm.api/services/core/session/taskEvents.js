/**
 * @fileOverview 会话任务树对前端的 SSE 事件构造（PR-任务编排 M7 词表，纯函数）
 * @module services/core/session/taskEvents
 * @description
 * 队列模式下，会话 `/core/chat/stream` 不再是"一个同步 run"，而是订阅 root task 的事件日志（M1-c）。
 * 本件把任务树状态跃迁**摆成协议 3 能承载的事件载荷**，供 root 事件日志写入与前端过程区渲染（§2.7）。
 * 纯函数、零 IO、离线穷举；不决定何时发（那是接线方），只保证每个事件形状稳定、失败/空不粉饰。
 *
 * 词表（设计稿 §2.7）：task_queued / task_started / subtask_spawned / subtask_done / subtask_failed /
 * synthesizing / synthesized / budget_degraded / arbitration。与 chat-sse 既有 delta/segment/steer_ack/
 * answer_ack 同一条通道（channel.emit(eventType, payload)），不新造传输。
 *
 * 一条纪律贯穿：**done 必带 usable、failed 必带 reason/retryable、degraded 必带降到哪一档**——
 * 前端才能"说真话"（对齐本项目"缺席≠未记录、部分≠完整"的一贯口径）。
 */

const ev = (type, payload) => ({ type, ...payload })

/** root 已入队（含当前排队位次，供前端"排队中第 N 位"如实显示） */
export const taskQueued = ({ rootCode, queuePosition = null }) =>
    ev('task_queued', { rootCode, queuePosition })

/** root 开始执行 */
export const taskStarted = ({ rootCode, subtaskCount = 0 }) =>
    ev('task_started', { rootCode, subtaskCount })

/** planner 拆出的子任务清单（里程碑，不逐帧回灌 child 细流） */
export const subtasksSpawned = ({ rootCode, subtasks = [] }) =>
    ev('subtask_spawned', {
        rootCode,
        subtasks: subtasks.map((s) => ({ agentCode: s.agentCode, title: s.title || '' })),
    })

/** 子任务成功——usable 决定前端能否当"有产出"，绝不因 handleStatus=2 就默认 usable */
export const subtaskDone = ({ rootCode, agentCode, usable = false, summary = '', credits = null }) =>
    ev('subtask_done', { rootCode, agentCode, usable, summary, credits })

/** 子任务失败——retryable 让 UI 能区分"会自旋重试"与"到此为止" */
export const subtaskFailed = ({ rootCode, agentCode, reason = '', retryable = false }) =>
    ev('subtask_failed', { rootCode, agentCode, reason, retryable })

/** 主智能体开始综合（会话结束触发，§7-2） */
export const synthesizing = ({ rootCode }) => ev('synthesizing', { rootCode })

/** 综合完成——携带成功/可用/失败计数，让"部分成果"可见 */
export const synthesized = ({ rootCode, successCount = 0, usableCount = 0, failedCount = 0 }) =>
    ev('synthesized', { rootCode, successCount, usableCount, failedCount })

/** 预算/并行度降级——必须说降到哪档，不能静默 */
export const budgetDegraded = ({ rootCode, degrade = 'none', reason = '', allowedSubtasks = 0 }) =>
    ev('budget_degraded', { rootCode, degrade, reason, allowedSubtasks })

/** 失败裁决动作（retry/replan/report），与 arbitrationPolicy 决策同源 */
export const arbitrationEvent = ({ rootCode, action, retryAgents = [], reason = '' }) =>
    ev('arbitration', { rootCode, action, retryAgents, reason })

export const TASK_EVENT_TYPES = [
    'task_queued', 'task_started', 'subtask_spawned', 'subtask_done', 'subtask_failed',
    'synthesizing', 'synthesized', 'budget_degraded', 'arbitration',
]

export default {
    taskQueued, taskStarted, subtasksSpawned, subtaskDone, subtaskFailed,
    synthesizing, synthesized, budgetDegraded, arbitrationEvent, TASK_EVENT_TYPES,
}
