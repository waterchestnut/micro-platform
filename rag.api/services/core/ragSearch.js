/**
 * @fileOverview 知识库的增强检索
 * @author xianyang 2025/6/30
 * @module
 */

import {getContentVector} from '../openai/embedding.js'
import {search} from '../../daos/milvus/dac/chunkDac.js'
import ragSegmentDac from '../../daos/core/dac/ragSegmentDac.js'
import ragMaterialDac from '../../daos/core/dac/ragMaterialDac.js'
import ragChunkDac from '../../daos/core/dac/ragChunkDac.js'
import {l2ToSimilarity} from './memoryIndex.js'
import {rerankDocuments} from '../openai/rerank.js'

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/** 知识库全库检索的默认相关性下限（用户定值 2026-11-25；bge-m3 归一向量 L2→cos 口径） */
const DEFAULT_RAG_MIN_SIMILARITY = 0.56

/**
 * @description 给 milvus 检索行按 L2 距离折算余弦相似度、按下限过滤并按相关度降序。
 *   milvus metric=L2 时把原始距离放在 score/distance（越小越近），与 memoryIndex 同一口径。
 *   知识库检索规范化：minSimilarity 未显式给时**默认下限 0.56**（用户定值 2026-11-25），
 *   避免无下限的全库 top-N 把最相近但不相关的种子语料当"资料"返回；显式传 0/负数=禁用下限（旧行为），
 *   传正数=用该下限。
 * @param {Array} rows milvus search 结果行
 * @param {Number} [minSimilarity] 相似度下限（0~1）；未给=默认 0.56
 * @returns {Array} 过滤+排序后的行（每行附 _sim）
 */
export function applySimilarityFloor(rows, minSimilarity) {
    const list = rows || []
    const minSim = (minSimilarity === undefined || minSimilarity === null)
        ? DEFAULT_RAG_MIN_SIMILARITY
        : Number(minSimilarity)
    if (!(minSim > 0)) return list
    return list
        .map(_ => {
            const s = l2ToSimilarity(Number(_.score ?? _.distance))
            return {..._, _sim: Number.isFinite(s) ? s : null}
        })
        // 无 score/distance（无法判相关度）→ 保留不误杀；有值才按下限过滤。未知相似度排最后
        .filter(_ => _._sim === null || _._sim >= minSim)
        .sort((a, b) => (b._sim ?? -1) - (a._sim ?? -1))
}

/**
 * @description 对 milvus 召回行做 chunk 粒度精排重排（按 chunk 去重后送 rerank；
 *   失败/未启用原样返回）。重排后 segment 组装沿用首见命中序，即最相关 chunk 的段落靠前。
 * @param {String} subject 查询文本
 * @param {Array} vecRet 已过滤排序的 milvus 行
 * @returns {Promise<Array>} 精排序（或原序）
 */
async function rerankChunks(subject, vecRet) {
    const cfg = config.rerank
    if (!cfg?.enabled || !vecRet.length) return vecRet
    const seen = new Set()
    const uniq = []
    for (const row of vecRet) {
        const code = row.ragChunkCode
        if (!code || seen.has(code)) continue
        seen.add(code)
        uniq.push(row)
    }
    if (uniq.length < 2) return vecRet
    const candidates = uniq.slice(0, cfg.maxCandidates || uniq.length)
    const chunkRows = await ragChunkDac.getTop(candidates.map(_ => _.ragChunkCode).length, {ragChunkCode: candidates.map(_ => _.ragChunkCode)})
    const contentMap = new Map(chunkRows.map(_ => [_.ragChunkCode, _.content || '']))
    const docs = candidates.map(_ => contentMap.get(_.ragChunkCode) || '')
    if (!docs.some(d => d)) return vecRet
    const ranked = await rerankDocuments(subject, docs)
    if (!ranked) return vecRet
    const scoreByPos = new Array(candidates.length).fill(null)
    ranked.forEach(r => {
        if (Number.isInteger(r.index) && r.index >= 0 && r.index < scoreByPos.length) scoreByPos[r.index] = r.relevance_score
    })
    const paired = candidates.map((row, i) => ({row, score: scoreByPos[i]}))
    const reordered = paired
        .sort((a, b) => (b.score ?? a.row._sim ?? -1) - (a.score ?? a.row._sim ?? -1))
        .map(x => ({...x.row, _rerank: x.score}))
    return [...reordered, ...uniq.slice(candidates.length)]
}

/**
 * @description 执行材料的增强检索
 * @author xianyang
 * @param {String} subject 检索主题文本
 * @param {Object} [options] 过滤等参数对象
 * @returns {Promise<Object[]>} 材料分段信息列表
 */
export async function ragSearch(subject, options = {}) {
    let vector = (await getContentVector(subject))[0]
    let andFilters = []
    if (tools.isArray(options.ragCode)) {
        andFilters.push(`ragCode in ${JSON.stringify(options.ragCode)}`)
    } else if (options.ragCode) {
        andFilters.push(`ragCode == "${options.ragCode}"`)
    }
    let vecRet = await search({
        vector,
        limit: options.maxLength || 15,
        output_fields: ['ragChunkCode', 'ragSegmentCode', 'ragMaterialCode'],
        filter: andFilters.length ? andFilters.join(' AND ') : undefined
    })
    vecRet = vecRet.rows || vecRet || []
    // 相关性下限过滤（默认 minSimilarity<=0＝不过滤、保持原顺序，向后兼容；传正数才生效）
    vecRet = applySimilarityFloor(vecRet, options.minSimilarity)
    // 精排（cross-encoder；未启用或失败保持向量序，chunk 命中序即最终序）
    vecRet = await rerankChunks(subject, vecRet)
    let ragSegmentCodeList = []
    let ragMaterialCodeList = []
    let ragChunkCodeList = []
    vecRet.forEach(_ => {
        ragSegmentCodeList.push(_.ragSegmentCode)
        ragMaterialCodeList.push(_.ragMaterialCode)
        ragChunkCodeList.push(_.ragChunkCode)
    })
    if (!ragSegmentCodeList.length) {
        return []
    }
    ragSegmentCodeList = [...new Set(ragSegmentCodeList)]
    ragMaterialCodeList = [...new Set(ragMaterialCodeList)]
    let segInfoList = await ragSegmentDac.getTop(ragSegmentCodeList.length, {ragSegmentCode: ragSegmentCodeList})
    let materialInfoList = await ragMaterialDac.getTop(ragMaterialCodeList.length, {ragMaterialCode: ragMaterialCodeList})
    let chunkInfoList = []
    if (options.withChunks) {
        chunkInfoList = await ragChunkDac.getTop(ragChunkCodeList.length, {ragChunkCode: ragChunkCodeList})
    }

    let retList = []
    segInfoList.forEach(segInfo => {
        let materialInfo = materialInfoList.find(_ => _.ragMaterialCode === segInfo.ragMaterialCode)
        let info = {
            ragCode: segInfo.ragCode,
            ragMaterialCode: segInfo.ragMaterialCode,
            ragSegmentCode: segInfo.ragSegmentCode,
            content: segInfo.content,
            wordCount: segInfo.wordCount,
            tokens: segInfo.tokens,
            language: segInfo.language,
            position: segInfo.position,
            resCode: materialInfo?.resCode,
            resTitle: materialInfo?.resTitle,
            resOriginalUrl: materialInfo?.resOriginalUrl,
        }
        if (options.withChunks) {
            info.chunks = vecRet.filter(_ => _.ragSegmentCode === segInfo.ragSegmentCode).map(_ => ({
                ..._,
                ...chunkInfoList.find(chunkRecord => chunkRecord.ragChunkCode === _.ragChunkCode)
            }))
        }
        // 透传向量侧信号：该 segment 命中 chunks 的最高相似度/精排分（evals 与引用置信度用）
        const hitRows = vecRet.filter(_ => _.ragSegmentCode === segInfo.ragSegmentCode)
        if (hitRows.length) {
            info.similarity = Number(Math.max(...hitRows.map(_ => _._sim ?? 0)).toFixed(4))
            const rs = hitRows.map(_ => _._rerank).filter(v => typeof v === 'number')
            if (rs.length) info.rerankScore = Number(Math.max(...rs).toFixed(4))
        }
        retList.push(info)
    })
    return retList
}

/**
 * @description 执行单条资源的增强检索
 * @author xianyang
 * @param {String} subject 检索主题文本
 * @param {String} resCode 资源标识
 * @param {String} ragMaterialCode 材料标识
 * @param {String} fileHashCode 文件hash值
 * @param {Number} maxTokens 最多返回的token数目
 * @param {Object} [options] 过滤等参数对象
 * @returns {Promise<Object[]>} 材料分段信息列表
 */
export async function simpleResRagSearch(subject, resCode, ragMaterialCode, fileHashCode, maxTokens, options) {
    let segList = []
    let materialInfo = null
    if (ragMaterialCode) {
        materialInfo = await ragMaterialDac.getByCode(ragMaterialCode)
    } else if (fileHashCode) {
        materialInfo = await ragMaterialDac.getOneByFilter({'fileList.fileHashCode': fileHashCode})
    } else if (resCode) {
        materialInfo = await ragMaterialDac.getOneByFilter({resCode})
    }
    if (!materialInfo) {
        return segList
    }
    let detail = materialInfo.details?.find(_ => _.isOriginal)
    if (maxTokens && detail?.tokens && detail.tokens <= maxTokens) {
        segList.push(detail.text)
        return segList
    }

    let vector = (await getContentVector(subject))[0]
    let andFilters = [`ragMaterialCode == "${materialInfo.ragMaterialCode}"`]
    let vecRet = await search({
        vector,
        limit: 150,
        output_fields: ['ragChunkCode', 'ragSegmentCode', 'ragMaterialCode'],
        filter: andFilters.length ? andFilters.join(' AND ') : undefined
    })
    let ragSegmentCodeList = []
    vecRet = vecRet.rows || vecRet || []
    /*console.log('vecRet', vecRet)*/
    vecRet.forEach(_ => {
        ragSegmentCodeList.push(_.ragSegmentCode)
    })
    if (!ragSegmentCodeList.length) {
        return segList
    }
    ragSegmentCodeList = [...new Set(ragSegmentCodeList)]
    let segInfoList = await ragSegmentDac.getTop(ragSegmentCodeList.length, {ragSegmentCode: ragSegmentCodeList})
    segInfoList.forEach(segInfo => {
        segList.push(segInfo.content)
    })
    return segList
}