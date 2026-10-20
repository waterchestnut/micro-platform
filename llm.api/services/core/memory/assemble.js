/**
 * @fileOverview 大模型会话上下文的分槽装配与预算控制
 * @module services/core/memory/assemble
 */

import {calcMessagesTokenCount} from '../../openai/util.js'

const logger = typeof llm !== 'undefined' && llm.logger ? llm.logger : console

/** 槽位顺序，靠前的内容更稳定，利于命中上游提示词缓存 */
export const SLOT_ORDER = ['system', 'fixed', 'history', 'current']

/** 单个工具结果被压缩后保留的字符数 */
export const TOOL_STUB_HEAD = 200

/** 历史槽位在总预算中的默认占比 */
export const DEFAULT_HISTORY_RATIO = 0.6

function isUserTextMessage(message, query) {
    if (!message || message.role !== 'user') {
        return false
    }
    if (typeof message.content === 'string') {
        return message.content === query
    }
    if (Array.isArray(message.content)) {
        return message.content.some(part => part && typeof part === 'object' && part.type === 'text' && part.text === query)
    }
    return false
}

/**
 * @description 从一条已落库的消息记录还原该轮真正发给模型的消息片段
 * @param {Object} messageInfo message 文档
 * @param {Object} [options] 选项
 * @returns {Object[]} 以 user 开头、assistant 结尾的消息序列；无法结构化还原时返回空数组
 */
export function rebuildTurn(messageInfo, options = {}) {
    const {query, answer, messages, answerReasoning} = messageInfo || {}
    if (!query || !answer) {
        return []
    }
    const list = Array.isArray(messages) ? messages : []
    const start = list.findIndex(m => isUserTextMessage(m, query))
    if (start < 0) {
        return []
    }
    const turn = list.slice(start)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'))
        .map(m => ({...m}))

    /*最终回答文本不会写回 messages（只有工具调用消息会），需补齐，否则下一轮看不到本轮结论*/
    const last = turn[turn.length - 1]
    if (!last || last.role !== 'assistant' || last.content !== answer) {
        turn.push({role: 'assistant', content: answer})
    }
    if (options.includeReasoning && answerReasoning) {
        turn.push({role: 'assistant', content: answerReasoning})
    }
    return turn
}

/**
 * @description 由最近若干条消息记录还原历史；优先结构化还原，缺失时降级为纯文本对
 * @param {Object[]} list 按时间倒序排列的消息记录
 * @param {Object} [options] 选项
 * @param {Number} [options.maxTurns] 最多还原的轮次
 * @param {Object} [options.tokenizerOptions] 计数选项
 * @param {Number} [options.budget] 历史槽位可用 token
 * @param {Number} [options.toolContentLimit] 单个工具结果保留字符数
 * @returns {{messages: Object[], dropped: Object[]}} 历史消息与被丢弃轮次
 */
export function buildHistoryMessages(list, options = {}) {
    const {budget = Infinity, tokenizerOptions, maxTurns, toolContentLimit = TOOL_STUB_HEAD} = options
    const history = []
    const dropped = []
    let used = 0
    let turns = 0

    for (const messageInfo of list || []) {
        if (maxTurns && turns >= maxTurns) {
            break
        }
        let turn = rebuildTurn(messageInfo, options)
        if (!turn.length) {
            /*老数据或异常数据：降级为 query/answer 文本对*/
            if (messageInfo?.query && messageInfo?.answer) {
                turn = [
                    {role: 'user', content: messageInfo.query},
                    {role: 'assistant', content: messageInfo.answer},
                ]
            } else {
                continue
            }
        }
        turn = turn.map(m => clampToolContent(m, toolContentLimit))
        const cost = calcMessagesTokenCount(turn, tokenizerOptions)
        if (used + cost > budget) {
            dropped.push({messageCode: messageInfo.messageCode, reason: 'budget', tokens: cost})
            continue
        }
        used += cost
        turns++
        history.unshift(...turn)
    }
    return {messages: history, dropped}
}

/*压缩过长的工具结果，避免历史还原把整篇文档再次灌入窗口*/
function clampToolContent(message, limit) {
    if (!message || message.role !== 'tool' || typeof message.content !== 'string') {
        return message
    }
    if (message.content.length <= limit) {
        return message
    }
    return {
        ...message,
        content: `${message.content.slice(0, limit)}…[truncated ${message.content.length - limit} chars]`,
    }
}

/**
 * @description 按槽位组装最终发给模型的消息列表，并给出各槽位开销
 * @param {Object} input 装配输入
 * @param {Object[]} [input.systemMessages] 系统提示槽位
 * @param {Object[]} [input.fixedMessages] 固定注入槽位（RAG、技能等本轮现算内容）
 * @param {Object[]} [input.historyMessages] 历史槽位
 * @param {Object} [input.currentMessage] 当前用户消息
 * @param {Number} [input.budget] 输入总预算
 * @param {Object} [input.tokenizerOptions] 计数选项
 * @returns {{messages: Object[], usage: Object}} 消息列表与用量明细
 */
export function assemble(input = {}) {
    const {
        systemMessages = [],
        fixedMessages = [],
        historyMessages = [],
        currentMessage = null,
        budget = Infinity,
        tokenizerOptions,
    } = input

    const currentMessages = currentMessage ? [currentMessage] : []
    const usage = {
        system: calcMessagesTokenCount(systemMessages, tokenizerOptions),
        fixed: calcMessagesTokenCount(fixedMessages, tokenizerOptions),
        history: calcMessagesTokenCount(historyMessages, tokenizerOptions),
        current: calcMessagesTokenCount(currentMessages, tokenizerOptions),
    }
    let total = usage.system + usage.fixed + usage.history + usage.current
    const historyBudget = Number.isFinite(budget)
        ? Math.max(0, budget - usage.system - usage.fixed - usage.current)
        : Infinity

    const dropped = []
    let dropCount = 0
    if (total > budget) {
        /*超窗时从历史头部（最旧一轮）开始丢弃，历史顺序为旧→新*/
        while (total > budget && dropCount < historyMessages.length) {
            const victim = historyMessages[dropCount]
            const cost = calcMessagesTokenCount([victim], tokenizerOptions)
            total -= cost
            usage.history -= cost
            dropped.push({role: victim.role, reason: 'overflow', tokens: cost})
            dropCount++
        }
        logger.warn(`上下文超出预算(${budget})，已从历史头部丢弃 ${dropCount} 条消息`)
    }

    const kept = historyMessages.slice(dropCount)
    return {
        messages: [...systemMessages, ...fixedMessages, ...kept, ...currentMessages],
        usage: {...usage, total, budget, historyBudget, droppedCount: dropCount},
        dropped,
    }
}

/**
 * @description 就地压缩最旧的工具结果，使消息列表回落到预算内
 * @param {Object[]} messages 会被修改的消息数组
 * @param {Number} budget 输入预算
 * @param {Object} [options] 选项
 * @returns {Number} 压缩后的 token 总量
 */
export function compactToBudget(messages, budget, options = {}) {
    const {tokenizerOptions, stubHead = TOOL_STUB_HEAD} = options
    let total = calcMessagesTokenCount(messages, tokenizerOptions)
    if (!Number.isFinite(budget) || total <= budget) {
        return total
    }
    for (let i = 0; i < messages.length && total > budget; i++) {
        const m = messages[i]
        if (m.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= stubHead) {
            continue
        }
        const before = calcMessagesTokenCount([m], tokenizerOptions)
        m.content = `${m.content.slice(0, stubHead)}…[compacted ${m.content.length - stubHead} chars]`
        total += calcMessagesTokenCount([m], tokenizerOptions) - before
    }
    return total
}
