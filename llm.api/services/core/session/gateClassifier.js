/**
 * @fileOverview 门分类器的调用面（第 2 层的 I/O 壳；prompt 权威在 execGate）
 * @module services/core/session/gateClassifier
 * @description
 * consolidator/extractor 同款家规：后台/门用的模型调用要有自己的超时与降级，绝不反噬主链路。
 * 本件的失败语义只有一条：**拿不到合法判定就抛**——编排（decideGate）把抛错按 unparsable
 * 走 escalate 语义；"调用器自己吞错返回 allow"是被禁止的形状（没配模型≠没风险）。
 */

import {GATE_CLASSIFIER_PROMPT} from './execGate.js'

const clientCache = new Map()

function getClient(modelKey, modelsCfg) {
    if (clientCache.has(modelKey)) {
        return clientCache.get(modelKey)
    }
    const cfg = modelsCfg?.[modelKey]
    if (!cfg) {
        throw new Error(`门分类器模型配置不存在: ${modelKey}`)
    }
    const entry = {cfg}
    clientCache.set(modelKey, entry)
    return entry
}

/**
 * @description 造分类函数（decideGate 的 classifyFn 依赖）
 * @param {Object} params 参数
 * @param {String} params.modelKey gateConfig.classifierModel 选型档
 * @param {Object} params.modelsCfg config.models
 * @param {Function} [params.fetchImpl] 注入 fetch（离线用例；缺省全局 fetch）
 * @param {Number} [params.timeoutMs] 单请求上限（默认 5000——门在工具循环里，慢档比错档更伤体验）
 * @returns {Promise<Function>} async (action) => 'allow'|'block'|'escalate'（解析不出/超时=抛）
 */
export function makeGateClassifyFn({modelKey, modelsCfg, fetchImpl, timeoutMs = 5000} = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a))
    return async (action) => {
        const {cfg} = getClient(modelKey, modelsCfg)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const r = await doFetch(`${cfg.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`},
                body: JSON.stringify({
                    model: cfg.model,
                    messages: [{role: 'system', content: GATE_CLASSIFIER_PROMPT},
                        {role: 'user', content: `${action.toolName} ${action.text || ''}`}],
                    max_tokens: 24, temperature: 0, stream: false, enable_thinking: false,
                }),
                signal: controller.signal,
            })
            if (!r.ok) {
                throw new Error(`HTTP ${r.status}`)
            }
            const j = await r.json()
            const m = /"verdict"\s*:\s*"(allow|block|escalate)"/.exec(String(j?.choices?.[0]?.message?.content || ''))
            if (!m) {
                throw new Error('unparsable-verdict')
            }
            return m[1]
        } finally {
            clearTimeout(timer)
        }
    }
}

export default {makeGateClassifyFn}
