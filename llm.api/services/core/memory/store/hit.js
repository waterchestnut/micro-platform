/**
 * @fileOverview 记忆检索命中的归一化
 * @module services/core/memory/store/hit
 * @description 独立成模块，避免 store 端口与各实现之间互相 import 形成环。
 */

/**
 * @description 归一化检索命中结果。
 * 排序与限额要用的字段必须提到顶层：`diversify` 按 topic 分桶、`scoreMemory` 按 confidence
 * 与 insertTime 加权，只留在 `atom` 里会让所有命中挤进同一个"general"桶、被每主题上限砍到只剩两条。
 * @author xianyang
 * @param {Object} raw 后端返回的原始命中
 * @returns {Object} {atomCode, content, score, source, kind, topic, confidence, insertTime, atom}
 */
export function normalizeHit(raw) {
    return {
        atomCode: raw?.atomCode || null,
        content: raw?.content || '',
        score: Number(raw?.score) || 0,
        source: raw?.source || 'unknown',
        kind: raw?.kind || 'atom',
        topic: raw?.topic || 'general',
        /** 0 是合法置信度，null/undefined/非数字才回落默认值 */
        confidence: (raw?.confidence === null || raw?.confidence === undefined || !Number.isFinite(Number(raw.confidence)))
            ? 0.5 : Number(raw.confidence),
        insertTime: raw?.insertTime || null,
        atom: raw || null,
    }
}

/**
 * @description 按 atomCode 去重并保分高者
 * @author xianyang
 * @param {Object[]} hits 命中列表
 * @returns {Object[]} 去重后的命中
 */
export function dedupeHits(hits) {
    const map = new Map()
    for (const hit of hits || []) {
        const key = hit?.atomCode || `anon-${map.size}`
        const prev = map.get(key)
        if (!prev || prev.score < hit.score) {
            map.set(key, hit)
        }
    }
    return [...map.values()]
}
