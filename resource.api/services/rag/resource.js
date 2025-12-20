/**
 * @fileOverview 资源增强检索相关的业务操作
 * @author xianyang 2025/11/14
 * @module
 */

import resInfoDac from '../../daos/core/dac/resInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {ragSearch, simpleResRag} from '../../grpc/clients/ragSearch.js'

const tools = resource.tools
const logger = resource.logger
const config = resource.config

/**
 * @description 执行资源的增强检索
 * @author xianyang
 * @param {String} query 问题摘要
 * @param {Object} options 检索选项
 * @returns {Promise<[{content: string, metas: Object}]>} 检索到的文本片段
 */
export async function execResRag(query, options = {}) {
    let maxTokens = options.maxTokens || 20480
    let maxLength = options.maxLength || 20
    if (options.resCode) {
        return execSimpleResRag(query, options.resCode, maxTokens)
    }

    let segList = await ragSearch(query, {maxLength})
    return segList || []
}

/*单条资源的增强检索，返回资源的文本片段*/
async function execSimpleResRag(query, resCode, maxTokens) {
    let resInfo = await resInfoDac.getByCode(resCode)
    if (!resInfo) {
        throw new Error('资源不存在')
    }
    /*console.log(resInfo)*/

    return (await simpleResRag(query, resCode, '', resInfo.originalHashCode, maxTokens))?.map(_ => ({
        content: _,
        resCode
    }))
}