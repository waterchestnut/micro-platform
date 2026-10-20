/**
 * @fileOverview 增强检索（RAG）引用来源的归并
 * @module services/core/memory/sources
 */

const getLogger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

/**
 * @description 从检索片段的 metas 中归并引用来源，按资源去重
 * @param {Object[]} segList 增强检索返回的片段（content + metas 的 JSON 字符串）
 * @returns {Object[]} 去重后的来源列表，元素为 {resCode, title, url, ragCode}
 */
export function collectRagSources(segList) {
    const map = new Map()
    for (const seg of segList || []) {
        let meta = {}
        try {
            meta = seg?.metas ? JSON.parse(seg.metas) : {}
        } catch (e) {
            getLogger().warn(`RAG metas 解析失败: ${e.message}`)
        }
        const resCode = meta.resCode || seg?.resCode
        const key = resCode || meta.ragSegmentCode || meta.ragMaterialCode || `seg-${map.size}`
        if (map.has(key)) {
            continue
        }
        map.set(key, {
            resCode: resCode || null,
            title: meta.resTitle || meta.title || resCode || '未知来源',
            url: meta.resOriginalUrl || meta.url || null,
            ragCode: meta.ragCode || null,
        })
    }
    return [...map.values()]
}
