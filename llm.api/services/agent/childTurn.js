/**
 * @fileOverview 子智能体 child run 的调用契约/终局映射/结果归约（PR-任务编排 M2 承重件，纯函数）
 * @module services/agent/childTurn
 * @description
 * `agent/handler/agentChat.js`（薄 IO）要包的是 core `execChat`。这几段逻辑是 M2 里"判错就毁整棵树"的部分，
 * 故与 IO 剥出来离线穷举。契约事实来自活码（`llmChat.js:122/1126`、`root.js:425-447`、`messageView.js:150-162`），
 * 不是凭记忆：
 * - `execChat(...)` 返回**终局串**：`'aborted'` 表示被打断/超时，其余按 done 处理；正文不进返回值，靠 `saveMessage` 落档；
 * - child 的权威产出从它**自己那条 message 档案**读回（视图字段 `messageCode/answer/progress`），
 *   绝不在 streamCallback 里二次累积正文——"同一个数存两处会分叉"（D66）；
 * - **child 不得向用户出题**：`answerRouter/runMailbox/hardSteer` 一律不给，`execChat` 则连 ask 工具都不注册
 *   （root.js:444 注释实锤），从源头杜绝子任务卡在 `await_input` 拖死整棵 fan-in；需澄清冒泡到 root 由上层处理。
 */

/** child 记忆默认关（多智能体各子独立，除非显式 workspaceId 分区——本刀不开） */
const CHILD_MEMORY_OFF = { enabled: false }

/**
 * @description 组装 child 调 `execChat` 的 options（契约核心：只带该有的，绝不带会挂起的）
 * @param {Object} p
 * @param {String} p.messageCode child 自己的 messageCode（注入而非现生成——fan-in 后要按它读回档案）
 * @param {String} p.conversationCode child 派生会话标识（独立于 root，不撞 runOverlap 同会话判定）
 * @param {String} [p.channel] 频道（一般同 root：xxzx_common）
 * @param {Number} [p.protocol] 事件协议（child 无 SSE，给 2 即可）
 * @param {String} [p.llmModel] 档位
 * @param {Array} [p.attachments] 附件（透传）
 * @param {AbortSignal} [p.signal] child 的超时/中止信号（由 handler 的 AbortController 提供）
 * @param {Function} [p.streamCallback] 收集器（handler 传入；child 不连用户，通常是有界 no-op）
 * @param {String} [p.reqId] 父 reqId（日志接得上）
 * @param {String} [p.parentTraceId] 父 traceId（贯穿，见 PR-0.3）
 * @param {Object} [p.extra] 其它透传（如 inputs 供多模态 child）
 * @returns {Object} execChat options
 */
export function buildChildExecOptions({
    messageCode, conversationCode, channel, protocol, llmModel,
    attachments, signal, streamCallback, reqId, parentTraceId, extra = {},
} = {}) {
    if (!messageCode || !conversationCode) {
        throw new Error('buildChildExecOptions 需要 messageCode 与 conversationCode')
    }
    const opts = {
        ...extra,
        messageCode,
        channel,
        protocol,
        llmModel,
        memory: CHILD_MEMORY_OFF,
        // 无 answerRouter/runMailbox/hardSteer ⇒ execChat 不注册 ask_user、不接插话/硬停，child 绝不挂起等人
    }
    if (attachments && attachments.length) opts.attachments = attachments
    if (typeof signal !== 'undefined') opts.signal = signal
    if (typeof streamCallback === 'function') opts.streamCallback = streamCallback
    if (reqId) opts.reqId = reqId
    if (parentTraceId) opts.inboundTraceId = parentTraceId
    return opts
}

/**
 * @description 把 execChat 的终局返回值映射成 child 的 agentTask handleStatus 语义
 * @param {Object} p
 * @param {String} [p.ret] execChat 返回值（'aborted' 或其它）
 * @param {Boolean} [p.aborted] handler 侧信号是否已被 abort（超时/取消）
 * @returns {{handleStatus:Number, retryable:Boolean, reason:String}} handleStatus 引 AgentHandleStatusEnum（2 success / -1 error）
 * @description
 * 被打断/超时 ⇒ `-1` 且 **retryable**（fan-in 后可交 `arbitrationPolicy` 重试）；
 * 正常 done ⇒ `2`。**绝不把 aborted 记成 2**——那等于"半句话当完成"，比失败更坏。
 */
export function mapChildOutcome({ ret, aborted } = {}) {
    if (ret === 'aborted' || aborted) {
        return { handleStatus: -1, retryable: true, reason: 'child-aborted' }
    }
    return { handleStatus: 2, retryable: false, reason: 'child-done' }
}

/**
 * @description 从 child 落档的 message 视图归约出 fan-in 用的 handleRet
 * @param {Object|null} view `toMessageView(doc)` 的产物（含 messageCode/answer/progress）
 * @returns {{messageCode:String, content:String, progress:(String|null), usable:Boolean, note:(String|null)}}
 * @description
 * `usable = answer 非空`。**空正文不许当可用成果**：即便 progress='finish'，answer 空对 fan-in 综合没意义，
 * 打 usable:false + note 让裁决/汇报如实处理（承本项目"缺席不粉饰"纪律，也承 dev 实测"abort 行 answer 常空"）。
 * view 缺失（读档失败）⇒ usable:false，绝不编一段 content 顶替。
 */
export function reduceChildResult(view) {
    if (!view || typeof view !== 'object') {
        return { messageCode: null, content: '', progress: null, usable: false, note: 'archive-missing' }
    }
    const content = String(view.answer || '')
    const usable = content.trim().length > 0
    return {
        messageCode: view.messageCode || null,
        content,
        progress: view.progress || null,
        usable,
        note: usable ? null : 'empty-answer',
    }
}

export default { buildChildExecOptions, mapChildOutcome, reduceChildResult }
