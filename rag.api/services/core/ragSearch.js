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

const tools = rag.tools
const logger = rag.logger
const config = rag.config

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
    let ragSegmentCodeList = []
    let ragMaterialCodeList = []
    let ragChunkCodeList = []
    vecRet = vecRet.rows || vecRet || []
    /*console.log('vecRet', vecRet)*/
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
        retList.push(info)
    })
    /*console.log(JSON.stringify(retList))*/
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