/**
 * @fileOverview 请求体未知字段审计
 * @module tools/schemaAudit
 * @description schema 收紧（R2-b）不能靠猜：现在 ajv 是 `removeAdditional: false`，
 * 未声明字段会被**静默透传**，改成拒绝之前必须先知道到底有谁在发、发了什么。
 * 这里只做一件事：把"实际出现但未声明"的字段名计数并采样上报，**不改动请求、不影响响应**。
 *
 * 只记字段名，绝不记字段值——值里可能有用户内容。
 */

/** 已出现过的组合不再重复告警，避免日志刷爆 */
const seen = new Map()

/** 每个 (path.key) 最多告警几次 */
const MAX_REPORTS = 3

/**
 * @description 从 JSON Schema 取已声明的属性名
 * @author xianyang
 * @param {Object} schema 对象型 schema
 * @returns {Set<string>} 属性名集合
 */
export function declaredKeys(schema) {
    const props = schema?.properties
    if (!props || typeof props !== 'object') {
        return new Set()
    }
    return new Set(Object.keys(props))
}

/**
 * @description 找出实际载荷里未被 schema 声明的键
 * @author xianyang
 * @param {Object} payload 请求体或子对象
 * @param {Set<string>} declared 已声明键
 * @param {String} [prefix] 路径前缀
 * @returns {String[]} 形如 `options.foo` 的键路径
 */
export function findUndeclared(payload, declared, prefix = '') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return []
    }
    const out = []
    for (const key of Object.keys(payload)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (!declared.has(key)) {
            out.push(path)
        }
    }
    return out
}

/**
 * @description 审计聊天请求体，只告警不改行为
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.body 原始请求体
 * @param {Object} params.schema 对应的 body schema
 * @param {Function} [params.warn] 告警函数，缺省用全局 logger
 * @returns {String[]} 本次检出的未声明键路径（便于测试断言）
 */
export function auditBody(params = {}) {
    const {body, schema, warn} = params
    if (!body || typeof body !== 'object') {
        return []
    }
    const log = warn || ((msg) => {
        try {
            if (typeof llm !== 'undefined' && llm.logger) {
                llm.logger.warn(msg)
            }
        } catch { /* 审计绝不影响主链路 */ }
    })
    const hits = [
        ...findUndeclared(body, declaredKeys(schema)),
        ...findUndeclared(body.options, declaredKeys(schema?.properties?.options), 'options'),
    ]
    for (const path of hits) {
        const n = (seen.get(path) || 0) + 1
        seen.set(path, n)
        if (n <= MAX_REPORTS) {
            log(`schema 未声明的请求字段: ${path}${n === MAX_REPORTS ? '（该键后续不再重复告警）' : ''}`)
        }
    }
    return hits
}

/**
 * @description 取当前已记录的未声明键统计，供运维核对能否翻转 schema
 * @author xianyang
 * @returns {Object} 键路径到出现次数的映射
 */
export function auditStats() {
    return Object.fromEntries([...seen.entries()].sort((a, b) => b[1] - a[1]))
}

/** 测试与运维手动清零 */
export function resetAudit() {
    seen.clear()
}

export default {declaredKeys, findUndeclared, auditBody, auditStats, resetAudit}
