/**
 * @fileOverview execChat 主循环的纯决策逻辑
 * @module services/core/llmLoop
 * @description
 * `execChat` 是 700 行、零单测的函数（`docs/session-run-plan.md` §2.10），而 PR-A/B/C/D/E 全都要改它。
 * 本模块把其中**不需要 OpenAI / 数据库 / MCP 就能判定**的部分抽出来，先装上测试，
 * 再让 `llmChat.js` 反过来消费它——这样后续重构有一张真正的网，而不是靠改完手点。
 *
 * 三条纪律：
 * 1. **零副作用、零外部依赖**：判定所需的谓词（哪些是记忆/溢出/代码工具）由调用方注入，
 *    否则本模块会被 `mcp/`、`memory/`、`sandbox/` 的模块级连接拖住，又变成离线不可测。
 * 2. **行为必须与抽出前逐字一致**：包括"没有 index 的 tool_call 增量被丢弃"这类看起来像 bug
 *    的现状——**先钉住现状，再在 PR-A 里决定是否改**，不要在抽取的同一刀里夹带修复。
 * 3. 新增的判定表（如断开阶段策略）**只定义不接线**，等 PR-C 用到时再接，避免提前改行为。
 */

/* ---------- 协议协商（对应 llmChat.js 的 clientProtocol / emitToolResults） ---------- */

/**
 * @description 协商事件协议版本
 * @param {Object} options 请求 options
 * @returns {{protocol: Number, emitToolResults: Boolean}}
 */
export function resolveProtocol(options = {}) {
    const protocol = Number(options.protocol) >= 2 ? 2 : 1
    return {
        protocol,
        /** 协议 2 的客户端按事件名分派，因此默认下发工具结果；协议 1 需显式开启 */
        emitToolResults: protocol === 2 || !!options.streamToolResults,
    }
}

/* ---------- tool_calls 增量聚合（对应 llmChat.js:470-496） ---------- */

/**
 * @description 把一个流式 chunk 里的 tool_calls 增量并入累积数组
 * @param {Object[]} toolCalls 累积数组（原地改，与抽取前一致）
 * @param {Object[]} deltas chunk 里的 delta.tool_calls
 * @returns {{toolCalls: Object[], touched: Boolean}} touched 表示本 chunk 是否出现 tool_calls
 */
export function accumulateToolCalls(toolCalls = [], deltas) {
    if (!deltas) {
        return {toolCalls, touched: false}
    }
    for (const d of deltas) {
        /** 现状：没有 index 的增量直接丢弃（OpenAI 兼容层都带 index，缺 index 说明上游不合规） */
        if (d.index === undefined) {
            continue
        }
        while (toolCalls.length <= d.index) {
            toolCalls.push({id: '', function: {name: '', arguments: ''}, type: 'function'})
        }
        const cur = toolCalls[d.index]
        if (d.id) {
            cur.id = d.id
        }
        if (d.function?.name) {
            cur.function.name = cur.function.name + d.function.name
        }
        if (d.function?.arguments) {
            cur.function.arguments = cur.function.arguments + d.function.arguments
        }
    }
    return {toolCalls, touched: true}
}

/**
 * @description 丢弃空壳工具调用（对应 llmChat.js:538 的 filter）
 * @param {Object[]} toolCalls 累积结果
 * @returns {Object[]} 只保留 id 与函数名都齐的调用
 */
export function pruneToolCalls(toolCalls = []) {
    return toolCalls.filter(tc => tc?.id && tc?.function?.name)
}

/**
 * @description 组装进 messages 的 assistant 工具调用消息（对应 llmChat.js:543-547）
 * @param {Object[]} toolCalls 已 prune 的调用
 * @returns {Object} assistant 消息
 */
export function buildAssistantToolCallMessage(toolCalls) {
    /** 工具调用时内容可能为空，必须显式 null 而不是省略，否则部分兼容层会把它当"补充上一句" */
    return {role: 'assistant', content: null, tool_calls: toolCalls}
}

/* ---------- 工具分派分类（对应 llmChat.js:551-555） ---------- */

/**
 * @description 按谓词把工具调用分派到四类执行通道
 * @param {Object[]} toolCalls 已 prune 的调用
 * @param {Object} predicates 由调用方注入，保持本模块零依赖
 * @param {Function} predicates.isMemoryTool 记忆工具判定
 * @param {Function} predicates.isOverflowTool 溢出取回工具判定
 * @param {Function} predicates.isCodeTool 沙箱代码工具判定
 * @returns {{memoryCalls: Object[], overflowCalls: Object[], codeCalls: Object[], otherCalls: Object[]}}
 */
export function classifyToolCalls(toolCalls = [], {isMemoryTool, isOverflowTool, isCodeTool} = {}) {
    const isMem = typeof isMemoryTool === 'function' ? isMemoryTool : () => false
    const isOvf = typeof isOverflowTool === 'function' ? isOverflowTool : () => false
    const isCode = typeof isCodeTool === 'function' ? isCodeTool : () => false

    const memoryCalls = toolCalls.filter(tc => isMem(tc.function?.name))
    const overflowCalls = toolCalls.filter(tc => isOvf(tc.function?.name))
    const codeCalls = toolCalls.filter(tc => isCode(tc.function?.name))
    /** 其余走 MCP/Skill 通道；漏判会被整批丢给 mcpToolManager 而找不到实现，所以这里显式取反 */
    const otherCalls = toolCalls.filter(tc => !isMem(tc.function?.name) && !isOvf(tc.function?.name) && !isCode(tc.function?.name))
    return {memoryCalls, overflowCalls, codeCalls, otherCalls}
}

/**
 * @description 按 tool_call_id 反查工具名（对应 llmChat.js:602-605，前端展示与 trace 都要用）
 * @param {Object[]} toolCalls 已 prune 的调用
 * @returns {Object} id -> name
 */
export function buildToolNameIndex(toolCalls = []) {
    const byId = {}
    for (const tc of toolCalls) {
        if (tc?.id) {
            byId[tc.id] = tc.function?.name
        }
    }
    return byId
}

/* ---------- trace 快照截断（对应 llmChat.js:42-45） ---------- */

/**
 * @description 工具结果进 trace 的截断快照
 * @param {*} content 工具返回内容
 * @param {Number} [limit] 字符上限
 * @returns {String} 截断后的字符串
 */
export function clipTraceResult(content, limit = 4000) {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '')
    return s.length > limit ? s.slice(0, limit) + '...[truncated]' : s
}

/* ---------- 断开阶段策略（D3/D4；供 PR-C 使用，本刀只定义不接线） ---------- */

export const RUN_PHASES = ['generating', 'tool_executing', 'awaiting_input', 'idle']

/**
 * @description 连接断开时，按 run 当前所处阶段决定怎么处理
 * @param {String} phase RUN_PHASES 之一
 * @returns {{stopStream: Boolean, stopAfterBoundary: Boolean, persist: String, resumeFrom: String}}
 */
export function detachAction(phase) {
    switch (phase) {
        case 'tool_executing':
            /** 副作用已发生，半途而废最糟：跑完本批、落 postTools 现场，再停在边界 */
            return {stopStream: false, stopAfterBoundary: true, persist: 'abort', resumeFrom: 'postTools'}
        case 'awaiting_input':
            /** 已经落盘退出，零成本；等回答即可 */
            return {stopStream: false, stopAfterBoundary: false, persist: 'keep', resumeFrom: 'awaitInput'}
        case 'generating':
        default:
            /** 纯文本生成无副作用，可立即打断；半句存为 cancelled 段 */
            return {stopStream: true, stopAfterBoundary: true, persist: 'abort', resumeFrom: 'preCreate'}
    }
}

/**
 * @description 插话（steer）注入点的决策
 * @param {String} mode 'soft' | 'hard'
 * @param {String} phase 当前阶段
 * @returns {{injectAt: String, abortCurrentStream: Boolean}}
 */
export function steerAction(mode, phase) {
    if (mode === 'hard') {
        /** 硬插话只在生成阶段能立即打断；工具执行阶段退化成边界注入（D4：不打断副作用） */
        return phase === 'tool_executing'
            ? {injectAt: 'postTools', abortCurrentStream: false}
            : {injectAt: 'immediate', abortCurrentStream: true}
    }
    return {injectAt: 'boundary', abortCurrentStream: false}
}

export default {
    resolveProtocol,
    accumulateToolCalls,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    classifyToolCalls,
    buildToolNameIndex,
    clipTraceResult,
    detachAction,
    steerAction,
    RUN_PHASES,
}
