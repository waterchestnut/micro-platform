/**
 * @fileOverview 大模型回答内容缓存相关的操作
 * @author xianyang 2025/11/19
 * @module
 */

import answerCacheDac from '../../daos/core/dac/answerCacheDac.js'
import {md5} from '../../tools/security.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/*生成用户问题的Hash值*/
export function getQueryHash(query) {
    return md5(query)
}

/*读取回答缓存*/
export async function getAnswerCache(query, channel, channelCacheKey, llmModel) {
    let queryHashCode = getQueryHash(query)
    return answerCacheDac.getOneByFilter({queryHashCode, channel, channelCacheKey, llmModel})
}

/*保存回答缓存*/
export async function saveAnswerCache(query, channel, channelCacheKey, llmModel, cacheInfo) {
    let queryHashCode = getQueryHash(query)
    return answerCacheDac.upsert({
        ...cacheInfo,
        query,
        queryHashCode,
        channel,
        channelCacheKey,
        llmModel
    }, {queryHashCode, channel, channelCacheKey, llmModel})
}