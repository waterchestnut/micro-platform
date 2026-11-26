/**
 * @fileOverview 精排模型（cross-encoder）相关的操作
 * @module
 */

const logger = rag.logger
const config = rag.config

/**
 * @description 文档精排。任何失败（网络/超时/结构异常）返回 null，由调用方回落向量序——
 *   精排是增益件不是依赖件，不许把检索打挂。
 * @param {String} query 查询文本
 * @param {String[]} documents 候选文本（与返回 index 对齐）
 * @param {Number} [topN] 返回条数上限，缺省全量
 * @returns {Promise<Array<{index:Number,relevance_score:Number}>|null>} 按相关度降序
 */
export async function rerankDocuments(query, documents, topN = 0) {
    const cfg = config.rerank
    if (!cfg?.enabled || !query || !documents?.length) return null
    try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), cfg.timeoutMs || 8000)
        const resp = await fetch(`${String(cfg.baseURL || '').replace(/\/+$/, '')}/rerank`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.apiKey || 'empty'}`,
            },
            body: JSON.stringify({
                model: cfg.model,
                query,
                documents,
                top_n: topN || documents.length,
                return_documents: false,
            }),
            signal: ac.signal,
        })
        clearTimeout(timer)
        if (!resp.ok) {
            logger.warn(`rerank 非 200(${resp.status})，回落向量序`)
            return null
        }
        const data = await resp.json()
        if (!Array.isArray(data?.results) || !data.results.length) return null
        return data.results
    } catch (e) {
        logger.warn(`rerank 降级(回落向量序): ${e.message}`)
        return null
    }
}
