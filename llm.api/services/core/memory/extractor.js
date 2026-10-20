/**
 * @fileOverview 记忆抽取的模型调用（与主聊天完全隔离）
 * @module services/core/memory/extractor
 * @description 刻意不复用 llmChat 的 OpenAI 实例与重试设置：
 * 抽取是后台任务，需要自己的超时、重试预算与"失败即降级/放弃"的策略，
 * 绝不能反噬聊天链路；SDK 自带重试一律关掉，避免与外层重试叠乘。
 */

import {OpenAI} from 'openai'
import {buildExtractMessages, parseExtractResult} from './extract.js'

const config = llm.config
const logger = llm.logger

/** 已知的 Qwen3/QwQ 系列，默认带思考输出，抽取时显式关掉以免吃满输出预算 */
const THINKING_MODEL_PATTERN = /(qwen3|qwq|deepseek-r1|reasoner)/i

const clientCache = new Map()

function getClient(modelKey) {
    if (clientCache.has(modelKey)) {
        return clientCache.get(modelKey)
    }
    const cfg = config.models?.[modelKey]
    if (!cfg) {
        throw new Error(`记忆抽取模型配置不存在: ${modelKey}`)
    }
    /** SDK 自带重试关掉，由本模块按瞬时/非瞬时分类自管，避免重试叠乘放大后台压力 */
    const entry = {
        client: new OpenAI({apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 0}),
        cfg,
    }
    clientCache.set(modelKey, entry)
    return entry
}

/**
 * @description 组装单次请求体
 * @author xianyang
 * @param {String} modelKey 模型配置节点
 * @param {Object[]} messages 抽取消息
 * @returns {Object} create 参数
 */
export function buildExtractBody(modelKey, messages) {
    const cfg = config.models?.[modelKey] || {}
    const ecfg = config.memory?.extract || {}
    const body = {
        model: cfg.model,
        messages,
        max_tokens: ecfg.maxTokens ?? 2048,
        temperature: ecfg.temperature ?? 0.2,
        stream: false,
    }
    if (ecfg.disableThinking && THINKING_MODEL_PATTERN.test(String(cfg.model || modelKey))) {
        body.enable_thinking = false
    }
    return body
}

function isTransient(e) {
    const status = e?.status ?? e?.response?.status
    if (status === 408 || status === 429 || status >= 500) {
        return true
    }
    const code = e?.code || e?.cause?.code || ''
    return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|AbortError|TIMEOUT/i.test(`${code} ${e?.name || ''} ${e?.message || ''}`)
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @description 对一批事件跑一次抽取，含超时、重试与降级
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object[]} params.events 事件（需含 eventCode/role/content）
 * @param {String} [params.channel] 频道
 * @returns {Promise<{candidates: Object[], rejected: Number, model: String, attempts: Number}>}
 */
export async function extractCandidates({events = [], channel = ''} = {}) {
    const ecfg = config.memory?.extract || {}
    const allowedEventCodes = events.map(e => e.eventCode).filter(Boolean)
    if (!allowedEventCodes.length) {
        return {candidates: [], rejected: 0, model: null, attempts: 0}
    }
    const messages = buildExtractMessages({events, channel})
    const keys = [ecfg.model, ecfg.fallbackModel].filter(Boolean)
    const maxRetries = ecfg.maxRetries ?? 2
    const backoff = ecfg.retryBackoffMs ?? 1000
    let attempts = 0
    let lastError = null

    for (const modelKey of keys) {
        let client, cfg
        try {
            ({client, cfg} = getClient(modelKey))
        } catch (e) {
            lastError = e
            continue
        }
        for (let i = 0; i <= maxRetries; i++) {
            attempts++
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), ecfg.timeoutMs ?? 60000)
            try {
                const ret = await client.chat.completions.create(buildExtractBody(modelKey, messages), {
                    signal: controller.signal,
                    maxRetries: 0,
                })
                const text = ret?.choices?.[0]?.message?.content || ''
                const parsed = parseExtractResult(text, {allowedEventCodes})
                if (parsed.unparsable) {
                    logger.warn(`记忆抽取输出无法解析(${modelKey})，视为本次无产出`)
                    return {candidates: [], rejected: 0, model: modelKey, attempts, unparsable: true}
                }
                return {
                    candidates: parsed.candidates.map(_ => ({..._, source: 'auto'})),
                    rejected: parsed.rejected,
                    model: modelKey,
                    attempts,
                }
            } catch (e) {
                lastError = e
                if (!isTransient(e)) {
                    logger.error(`记忆抽取失败(${modelKey})，非瞬时错误不再重试: ${e.message}`)
                    break
                }
                if (i < maxRetries) {
                    const wait = Math.min(60000, backoff * (2 ** i))
                    logger.warn(`记忆抽取瞬时失败(${modelKey})，${wait}ms 后第 ${i + 1} 次重试: ${e.message}`)
                    await sleep(wait)
                }
            } finally {
                clearTimeout(timer)
            }
        }
        logger.warn(`记忆抽取模型(${modelKey})耗尽重试，尝试降级`)
    }
    throw lastError || new Error('记忆抽取无可用模型')
}
