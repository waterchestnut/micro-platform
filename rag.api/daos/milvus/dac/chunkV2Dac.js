/**
 * @fileOverview 材料分句混合检索的底层 milvus 操作（dense + BM25 → RRF）
 * @module
 * @description 走 Milvus 2.5 原生 hybridSearch：dense 向量路 + BM25 词面路，RRFRanker 融合。
 *   与 chunkDac（纯 dense）并存，由 ragSearch 依 hybrid.enabled 择一调用。
 */
import schemas, {milvusClient} from '../schema/index.js'
import {RRFRanker, DataType} from '@zilliz/milvus2-sdk-node'

const schema = schemas['chunkV2Schema']
const config = rag.config
const logger = rag.logger

/**
 * @description 混合检索：dense 语义 + BM25 词面 → RRF 融合
 *   SDK 契约（@zilliz/milvus2-sdk-node 2.5）：hybridSearch===search，靠 data 传
 *   [{anns_field, data, limit, ...}] 多路数组触发融合，rerank 传 RRFRanker(k)。
 * @param {Object} params
 * @param {Number[]} params.vector 查询 dense 向量
 * @param {String} params.queryText 查询原文（BM25 词面路用）
 * @param {String} [params.filter] milvus 过滤表达式（两路共用）
 * @param {Number} [params.limit] 最终返回条数
 * @param {String[]} [params.output_fields] 需返回的标量字段
 * @returns {Promise<Array>} RRF 融合后的行（含 ragChunkCode/ragSegmentCode/ragMaterialCode + score）
 */
export async function hybridSearch(params = {}) {
    const {vector, queryText, filter, limit = 15, output_fields = ['ragChunkCode', 'ragSegmentCode', 'ragMaterialCode']} = params
    const hybrid = config.hybrid || {}
    const perPath = hybrid.perPathLimit || 30
    const expr = filter || ''
    const reqs = []
    // dense 语义路
    if (vector && vector.length) {
        reqs.push({
            anns_field: 'content',
            data: [vector],
            limit: perPath,
            expr,
            search_params: {metric_type: 'L2', params: {ef: Math.max(perPath * 4, 64)}},
        })
    }
    // BM25 词面路（text 匹配，data 传原始查询文本）
    if (queryText && String(queryText).trim()) {
        reqs.push({
            anns_field: 'sparse',
            data: [String(queryText)],
            limit: perPath,
            expr,
            search_params: {metric_type: 'BM25', params: {}},
        })
    }
    if (!reqs.length) return []
    const r = await milvusClient.search({
        collection_name: schema.collection_name,
        data: reqs,
        rerank: RRFRanker(hybrid.rrfK || 60),
        limit,
        output_fields,
    })
    // SDK 融合检索返回扁平 results 数组（非 results[0] 二维）；兼容两种形态
    const rows = Array.isArray(r?.results) ? (r.results.length && !Array.isArray(r.results[0]) ? r.results : (r.results[0] || [])) : []
    return rows
}

/**
 * @description upsert 到 chunk_v2（text 必填，sparse 由 BM25 function 服务端生成，不传）
 * @param {Array} items [{ragChunkCode, ragCode, ragMaterialCode, ragSegmentCode, language, status, text, content:[...]}]
 * @returns {Promise<Number>} 写入条数
 */
export async function upsertItems(items) {
    if (!items?.length) return 0
    await milvusClient.upsert({
        collection_name: schema.collection_name,
        fields_data: items,
    })
    return items.length
}

/**
 * @description 按表达式删除 chunk_v2 行
 * @param {Object} params {filter}
 * @returns {Promise<Number>} 删除条数
 */
export async function deleteByQuery(params) {
    let res = await milvusClient.delete({
        ...params,
        collection_name: schema.collection_name,
    })
    return res?.delete_cnt
}

/**
 * @description 查询 chunk_v2 行（按 filter）
 * @param {Object} params {filter, output_fields, limit}
 * @returns {Promise<Array>} 数据行
 */
export async function query(params) {
    let res = await milvusClient.query({
        ...params,
        collection_name: schema.collection_name,
    })
    return res?.data || []
}
