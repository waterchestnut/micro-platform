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

/*读取回答缓存，按 updateTime 倒序取最新一条，避免存量重复行时返回不确定*/
export async function getAnswerCache(query, channel, channelCacheKey, llmModel) {
    let queryHashCode = getQueryHash(query)
    let list = await answerCacheDac.getTop(1, {queryHashCode, channel, channelCacheKey, llmModel}, {updateTime: -1})
    return list?.[0] || null
}

/*保存回答缓存*/
export async function saveAnswerCache(query, channel, channelCacheKey, llmModel, cacheInfo) {
    let queryHashCode = getQueryHash(query)
    /** 每次写入都刷新过期时刻：TTL 索引靠 expireAt 回收，命中复用的热点不应被中途删掉 */
    const ttlDays = Number(llm.config.limits?.answerCacheTtlDays ?? 90)
    return answerCacheDac.upsert({
        ...cacheInfo,
        query,
        queryHashCode,
        channel,
        channelCacheKey,
        llmModel,
        expireAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000)
    }, {queryHashCode, channel, channelCacheKey, llmModel})
}