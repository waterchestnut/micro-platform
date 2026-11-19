/**
 * @fileOverview 扇出任务模式的入口判定（PR-任务编排 M4b c2，纯函数）
 * @module services/core/session/fanOutEntry
 * @description
 * 属主拍板：入口**显式进**——前端"任务模式"开关，或频道白名单；不做"每条消息都过一次 LLM 判定"
 * （那等于给全站每次交互加一次模型往返的时延与成本）。本件只回答一个问题：**这次请求要不要走 planner**。
 *
 * 判定的性格与 `fanOutIntake` 同一族——**保守**：
 * - 总开关（`fanOutPlanner.enabled`）不为严格 true ⇒ 一律不进，连"用户明确要任务模式"也不进；
 *   此时调用方**继续走普通回答**（绝不因为"任务模式不可用"就把用户的话吃掉或报错——功能没开是部署事实，
 *   不是用户的错）。前端要给用户"当前不能下任务"的反馈属 M8，需要时另加响应字段，不在这里偷偷改协议。
 * - `taskMode` 走真值判定（`true`/`1`）；`entryChannels` 用精确成员判定（不做前缀/包含匹配，
 *   频道名是运维写的，模糊匹配会把不相干的频道卷进来）。
 * - 两条都不满足 ⇒ 不进。判定不看 query 长度/内容——那是 planner 的活，入口层不替它猜。
 *
 * 与 `decideQueueOnOverlap` 一样刻意**不做 IO、不读配置**：调用方把 `llm.config` 的值喂进来，
 * 好让这张判定表能离线穷举、能被 wiring 测试引用同一份实现。
 */

const truthy = (v) => v === true || v === 1

/**
 * @description 这次请求是否进入扇出 planner（任务模式）
 * @param {Object} [p]
 * @param {Boolean} [p.enabled] `agentTask.fanOutPlanner.enabled`（非严格 true ⇒ 恒不进）
 * @param {*} [p.taskMode] 请求 `options.taskMode`（前端显式开关）
 * @param {String} [p.channel] 请求频道
 * @param {Array} [p.entryChannels] 频道白名单（运维配置，默认空）
 * @returns {{attempt:Boolean, via:('taskMode'|'channel'|null), reason:String}}
 */
export function decideFanOutEntry({ enabled = false, taskMode, channel = '', entryChannels = [] } = {}) {
    if (enabled !== true) {
        // 用户明明按了任务模式但功能没开：单独标出来，日志/界面才能区分"没开"与"开了但没进"
        return { attempt: false, via: null, reason: truthy(taskMode) ? 'task-mode-disabled' : 'disabled' }
    }
    if (truthy(taskMode)) {
        return { attempt: true, via: 'taskMode', reason: 'explicit-task-mode' }
    }
    const list = Array.isArray(entryChannels) ? entryChannels : []
    if (channel && list.includes(channel)) {
        return { attempt: true, via: 'channel', reason: 'channel-whitelist' }
    }
    return { attempt: false, via: null, reason: 'not-requested' }
}

export default { decideFanOutEntry }
