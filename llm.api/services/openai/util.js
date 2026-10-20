/**
 * @fileOverview openai相关的工具方法
 * @author xianyang 2025/6/19
 * @module
 */
import {get_encoding} from 'tiktoken'

const getLogger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

/** 计数语义版本，写入 message 文档供后续成本核对使用 */
export const TOKENIZER_VERSION = 'v2'
/** 默认编码，模型未显式配置 tokenizer 时使用 */
export const DEFAULT_TOKENIZER = 'cl100k_base'
/** 每条消息的协议开销（chatml 的 role/分隔符等），估算值 */
export const PER_MESSAGE_OVERHEAD = 4
/** 单个 tool_call 的协议开销估算值 */
export const PER_TOOL_CALL_OVERHEAD = 8
/** 图片输入的默认 token 估算值，模型可用 imageTokens 覆盖 */
export const DEFAULT_IMAGE_TOKENS = 765

const encCache = new Map()

function getEncoder(name) {
    const key = name || DEFAULT_TOKENIZER
    if (encCache.has(key)) {
        return encCache.get(key)
    }
    try {
        const enc = get_encoding(key)
        encCache.set(key, enc)
        return enc
    } catch (e) {
        getLogger().warn(`未知的tokenizer(${key})，回退到${DEFAULT_TOKENIZER}: ${e.message}`)
        const enc = get_encoding(DEFAULT_TOKENIZER)
        encCache.set(key, enc)
        return enc
    }
}

function encode(text, tokenizer) {
    const enc = getEncoder(tokenizer)
    try {
        return enc.encode(text)
    } catch (e) {
        getLogger().error(`token编码失败(${tokenizer}): ${e.message}`)
        return new Uint32Array(0)
    }
}

/*计算文本的Token数量*/
export function calcTextTokenCount(text, tokenizer) {
    if (text === null || text === undefined) {
        return 0
    }
    return encode(String(text), tokenizer).length
}

/*计算多模态content片段的Token数量，image_url按估算值计*/
export function calcContentTokenCount(content, options = {}) {
    const {tokenizer, imageTokens = DEFAULT_IMAGE_TOKENS} = options
    if (content === null || content === undefined) {
        return 0
    }
    if (typeof content === 'string') {
        return calcTextTokenCount(content, tokenizer)
    }
    if (Array.isArray(content)) {
        return content.reduce((sum, part) => sum + calcContentPartTokenCount(part, options), 0)
    }
    if (typeof content === 'object') {
        return calcTextTokenCount(JSON.stringify(content), tokenizer)
    }
    return calcTextTokenCount(String(content), tokenizer)
}

function calcContentPartTokenCount(part, options) {
    const {tokenizer, imageTokens = DEFAULT_IMAGE_TOKENS} = options
    if (!part || typeof part !== 'object') {
        return calcContentTokenCount(part, options)
    }
    if (part.type === 'image_url' || part.image_url) {
        return imageTokens
    }
    if (part.type === 'audio' || part.input_audio) {
        return imageTokens
    }
    if (part.type === 'text' || typeof part.text === 'string') {
        return calcTextTokenCount(part.text, tokenizer)
    }
    return calcContentTokenCount(part[Object.keys(part)[0]], options)
}

/**
 * @description 计算一条消息列表的Token数量，计入协议开销与tool_calls
 * @param {Object[]|Object} messages 消息或消息列表
 * @param {Object} [options] 计数选项
 * @param {String} [options.tokenizer] tiktoken编码名
 * @param {Number} [options.imageTokens] 单张图片的估算token数
 * @returns {Number} token数量
 */
export function calcMessagesTokenCount(messages, options = {}) {
    const list = Array.isArray(messages) ? messages : [messages]
    return list.reduce((sum, message) => sum + calcMessageTokenCount(message, options), 0)
}

/**
 * @description 按模型配置推导可用的输入上下文预算
 * @param {Object} llmConfig 模型配置节点（含 contextWindow/maxTokens）
 * @param {Object} [options] 覆盖项
 * @param {Number} [options.slackTokens] 额外余量
 * @param {Number} [options.reserveOutput] 为回答预留的输出token，缺省取 maxTokens
 * @returns {Number} 输入预算，最小为0
 */
export function calcContextBudget(llmConfig = {}, options = {}) {
    const contextWindow = Number(llmConfig.contextWindow) || 0
    const reserveOutput = Number.isFinite(options.reserveOutput) ? options.reserveOutput : (Number(llmConfig.maxTokens) || 0)
    const slackTokens = Number.isFinite(options.slackTokens) ? options.slackTokens : 0
    return Math.max(0, contextWindow - reserveOutput - slackTokens)
}

/**
 * @description 取消息计数选项，统一从模型配置读取 tokenizer/imageTokens
 * @param {Object} [llmConfig] 模型配置节点
 * @returns {Object} 计数选项
 */
export function getTokenizerOptions(llmConfig = {}) {
    return {
        tokenizer: llmConfig.tokenizer || DEFAULT_TOKENIZER,
        imageTokens: Number(llmConfig.imageTokens) || DEFAULT_IMAGE_TOKENS,
    }
}

/*计算单条消息的Token数量*/
export function calcMessageTokenCount(message, options = {}) {
    const {tokenizer} = options
    if (!message || typeof message !== 'object') {
        return calcContentTokenCount(message, options)
    }
    let count = PER_MESSAGE_OVERHEAD
    count += calcContentTokenCount(message.content, options)
    if (message.name) {
        count += calcTextTokenCount(message.name, tokenizer)
    }
    if (Array.isArray(message.tool_calls)) {
        count += message.tool_calls.reduce((sum, call) => {
            const fn = call?.function || {}
            return sum + PER_TOOL_CALL_OVERHEAD
                + calcTextTokenCount(fn.name, tokenizer)
                + calcTextTokenCount(fn.arguments, tokenizer)
        }, 0)
    }
    if (message.role === 'tool' && message.tool_call_id) {
        count += calcTextTokenCount(message.tool_call_id, tokenizer)
    }
    return count
}
