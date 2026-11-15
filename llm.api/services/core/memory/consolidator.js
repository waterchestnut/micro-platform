/**
 * @fileOverview sleep-time 整理的模型调用（与抽取同族、与聊天隔离）
 * @module services/core/memory/consolidator
 * @description
 * extractor.js 的家规原样搬运：后台任务要自己的超时、重试预算与"失败即降级"的策略，
 * SDK 自带重试一律关掉；`isTransient` 从 extractor 导入单源（分类器两处一份理解就是分家）。
 * prompt 组装与回复解析都在判据层 `sleepTime.js`（纯函数），这里只是 I/O 壳——
 * **解析后的动作已经过白名单/证据/重复过滤**，执行壳不许在这里之后再加"理解"。
 */

import {OpenAI} from 'openai'
import {isTransient} from './extractor.js'
import {buildConsolidationPrompt, parseConsolidationReply} from './sleepTime.js'

const config = llm.config
const logger = llm.logger

/** 已知的 Qwen3/QwQ 系列默认带思考输出，整理时显式关掉以免吃满输出预算（extractor 同款） */
const THINKING_MODEL_PATTERN = /(qwen3|qwq|deepseek-r1|reasoner)/i

const clientCache = new Map()

function getClient(modelKey) {
    if (clientCache.has(modelKey)) {
        return clientCache.get(modelKey)
    }
    const cfg = config.models?.[modelKey]
    if (!cfg) {
        throw new Error(`记忆整理模型配置不存在: ${modelKey}`)
    }
    const entry = {client: new OpenAI({apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 0}), cfg}
    clientCache.set(modelKey, entry)
    return entry
}

/**
 * @description 组装单次整理请求体（纯函数，供离线用例钉形状）
 * @param {String} modelKey 模型配置节点
 * @param {String} prompt buildConsolidationPrompt 的产物
 * @returns {Object} create 参数
 */
export function buildConsolidationBody(modelKey, prompt) {
    const cfg = config.models?.[modelKey] || {}
    const ccfg = config.memory?.consolidation || {}
    const body = {
        model: cfg.model,
        messages: [{role: 'user', content: prompt}],
        max_tokens: ccfg.maxTokens ?? 1024,
        temperature: ccfg.temperature ?? 0.1,
        stream: false,
    }
    if (ccfg.disableThinking !== false && THINKING_MODEL_PATTERN.test(String(cfg.model || modelKey))) {
        body.enable_thinking = false
    }
    return body
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @description 对一批 episode 跑一次整理模型调用
 * @param {Object} params 参数
 * @param {Object[]} params.episodes 判据视图的 episode（{atomCode, text, ...}）
 * @param {Object[]} [params.existingAtoms] 现存 decision/preference 的判据视图（查重用）
 * @returns {Promise<{actions: Object[], model: String|null, attempts: Number, unparsable?: Boolean}>}
 *          actions 已经过 parseConsolidationReply 过滤；解析不出/全被滤 ⇒ [{action:'noop'}]，不是异常
 */
export async function runConsolidation({episodes = [], existingAtoms = []} = {}) {
    const ccfg = config.memory?.consolidation || {}
    if (!episodes.length) {
        return {actions: [], model: null, attempts: 0}
    }
    const validAtomCodes = new Set(episodes.map(e => e.atomCode).filter(Boolean))
    const existingDecisionTexts = new Set(existingAtoms.map(a => String(a.text || '').trim()).filter(Boolean))
    const prompt = buildConsolidationPrompt(episodes, existingAtoms)
    const keys = [ccfg.model, ccfg.fallbackModel].filter(Boolean)
    const maxRetries = ccfg.maxRetries ?? 1
    const backoff = ccfg.retryBackoffMs ?? 1500
    let attempts = 0
    let lastError = null

    for (const modelKey of keys) {
        let client
        try {
            ({client} = getClient(modelKey))
        } catch (e) {
            lastError = e
            continue
        }
        for (let i = 0; i <= maxRetries; i++) {
            attempts++
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), ccfg.timeoutMs ?? 90000)
            try {
                const ret = await client.chat.completions.create(buildConsolidationBody(modelKey, prompt), {
                    signal: controller.signal, maxRetries: 0,
                })
                clearTimeout(timer)
                const text = ret?.choices?.[0]?.message?.content || ''
                const actions = parseConsolidationReply(text, {validAtomCodes, existingDecisionTexts})
                if (actions.length === 1 && actions[0].action === 'noop' && actions[0].reason === 'unparsed') {
                    logger.warn(`记忆整理输出无法解析(${modelKey})，视为本次无产出`)
                    return {actions, model: modelKey, attempts, unparsable: true}
                }
                return {actions, model: modelKey, attempts}
            } catch (e) {
                clearTimeout(timer)
                lastError = e
                if (!isTransient(e)) {
                    logger.error(`记忆整理模型非瞬时错误(${modelKey}): ${e.message}`)
                    break
                }
                if (i < maxRetries) {
                    await sleep(backoff * (i + 1))
                }
            }
        }
    }
    /** 全部失败 ⇒ 无产出降级（整理是尽力而为，下轮窗口还会再来） */
    logger.warn(`记忆整理模型调用失败，本轮无产出: ${lastError?.message || '无可用模型'}`)
    return {actions: [{action: 'noop', reason: 'model-failed'}], model: null, attempts}
}

export default {runConsolidation, buildConsolidationBody}
