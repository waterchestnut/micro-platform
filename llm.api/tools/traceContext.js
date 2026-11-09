/**
 * @fileOverview run 级 traceId 的构造、脱敏与传播
 * @module tools/traceContext
 * @description
 * PR-0.3 的第一块：让**一轮执行**在日志、上游请求头、SSE 载荷里都能被同一个键捞出来。
 *
 * 一条必须先定的设计决定：**traceId 不新增第三个标识符，直接取 `messageCode`**。
 * 理由不是省事，而是刚踩过坑：同一个数存在两处（`extInfo.usage` 与 `llmUsage` 账本行）就会分叉，
 * 实测真发生过"extInfo 说 0 次调用、账本说 1 次"。再引入一个独立的 traceId 存储列，
 * 等于再造一处"必须一致但没人管"的副本。所以这里的原则是：
 * **traceId 只做传播，不做存储**——它由 `messageCode` 推导，永远只有一份真值。
 *
 * 另外两条纪律写在这里，因为它们决定实现细节：
 * 1. **进上游的头必须脱敏**：`traceId` 有一部分来自客户端/网关的请求头，
 *    不过滤就等于把 CRLF 或任意字节送进 relay 的请求行（头注入），也让人家的问题变成我们的故障；
 * 2. **日志字段里不许有用户内容**：trace 的字段只放标识与档位，
 *    正文、问题、工具参数一律不进（§4.5 的"工具原文不外传"是同一条线）。
 */

/** 上游与出站用的头名 */
export const TRACE_HEADER = 'x-trace-id'
/** 会话维度的头名：多轮问题要靠它把同一会话的多次调用串起来 */
export const CONVERSATION_HEADER = 'x-conversation-id'

/** 入站 traceId 允许出现的字符：字母数字与 `._:-`，其余一律剥离 */
const SAFE_PATTERN = /[^A-Za-z0-9._:-]+/g
/** 入站 traceId 的最大长度：再长就是拿头当数据塞了 */
const MAX_TRACE_LEN = 64

/**
 * @description 把外部传入的 traceId 洗成可以放进 HTTP 头的形态
 * @param {*} value 任意入站值（头、query、body 字段都可能是脏的）
 * @returns {String|null} 安全后的值；清洗后为空则返回 null，**不保留空串**
 * @description
 * CRLF 会在剥掉非法字符时一起消失（`\r\n` 不在白名单里），所以这里不需要单独防换行注入。
 * 返回 null 而不是空串，是为了让"有没有"这件事在下游只有一个判断方式。
 */
export function sanitizeTraceId(value) {
    if (typeof value !== 'string') {
        return null
    }
    const cleaned = value.replace(SAFE_PATTERN, '').slice(0, MAX_TRACE_LEN)
    return cleaned || null
}

/**
 * @description 构造一轮执行的 trace 上下文
 * @param {Object} input 现场标识（都是标识与档位，不含用户内容）
 * @param {String} input.messageCode 本轮消息标识，**它就是 traceId**
 * @param {String} [input.conversationCode] 会话标识
 * @param {String} [input.userCode] 当前用户工号
 * @param {String} [input.channel] 频道
 * @param {String} [input.llmModel] 模型档位
 * @param {String} [input.reqId] fastify 的请求 id（用于把 HTTP 层日志与 run 层日志接上）
 * @param {*} [input.inboundTraceId] 客户端/网关传来的 traceId（会脱敏，且绝不覆盖 traceId）
 * @returns {{traceId: String, conversationCode: String, userCode: String, channel: String, model: String, reqId: String, inboundTraceId: String|null}} trace 上下文
 */
export function buildTrace({
    messageCode,
    conversationCode = '',
    userCode = '',
    channel = '',
    llmModel = '',
    reqId = '',
    inboundTraceId = null,
} = {}) {
    if (!messageCode) {
        throw new Error('buildTrace 需要 messageCode')
    }
    return {
        /** 唯一真值：run 级 = messageCode 级（§3 的 Run 定义） */
        traceId: String(messageCode),
        conversationCode: String(conversationCode || ''),
        userCode: String(userCode || ''),
        channel: String(channel || ''),
        model: String(llmModel || ''),
        reqId: String(reqId || ''),
        inboundTraceId: sanitizeTraceId(inboundTraceId),
    }
}

/**
 * @description trace 的日志字段（喂给 pino child binding）
 * @param {Object} trace `buildTrace` 的结果
 * @returns {Object} 固定键名的字段对象，**不含任何用户内容**
 */
export function traceFields(trace) {
    const out = {traceId: trace.traceId}
    if (trace.conversationCode) {
        out.conversationCode = trace.conversationCode
    }
    if (trace.userCode) {
        out.userCode = trace.userCode
    }
    if (trace.channel) {
        out.channel = trace.channel
    }
    if (trace.model) {
        out.model = trace.model
    }
    if (trace.reqId) {
        out.reqId = trace.reqId
    }
    if (trace.inboundTraceId) {
        /** 单独一个键：它和 traceId 不一样，是"别人家的那个号"，两边都要留得住 */
        out.inboundTraceId = trace.inboundTraceId
    }
    return out
}

/**
 * @description 生成打给上游的 HTTP 头
 * @param {Object} trace `buildTrace` 的结果
 * @param {Object} [opts] 选项
 * @param {Boolean} [opts.includeConversation=true] 是否带会话头（跨轮关联用）
 * @returns {Object} 头对象；值为空的头**不出现**（不发空头）
 */
export function traceHeaders(trace, {includeConversation = true} = {}) {
    const headers = {}
    const safeTrace = sanitizeTraceId(trace.traceId)
    if (safeTrace) {
        headers[TRACE_HEADER] = safeTrace
    }
    if (includeConversation) {
        const safeConv = sanitizeTraceId(trace.conversationCode)
        if (safeConv) {
            headers[CONVERSATION_HEADER] = safeConv
        }
    }
    /**
     * 入站 traceId **不回显给上游**：上游拿到一个不属于我们的 id 只会污染别人的检索，
     * 而且入站值可能被构造；它只留在我们自己的日志字段里（`traceFields`）。
     */
    return headers
}

/**
 * @description 取带 trace 绑定的 logger
 * @param {Object} logger 基础 logger（pino 实例）
 * @param {Object} trace `buildTrace` 的结果
 * @returns {Object} 子 logger；基础 logger 不支持 `child` 时**原样返回**（不能因观测能力缺失而打断业务）
 */
export function withTrace(logger, trace) {
    if (!logger || typeof logger.child !== 'function') {
        return logger
    }
    try {
        return logger.child(traceFields(trace))
    } catch {
        /** 极端情况下（logger 被替换成非 pino）也要让主链路继续跑 */
        return logger
    }
}

export default {sanitizeTraceId, buildTrace, traceFields, traceHeaders, withTrace, TRACE_HEADER, CONVERSATION_HEADER}
