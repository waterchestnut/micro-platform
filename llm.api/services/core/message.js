/**
 * @fileOverview 会话消息相关的业务操作
 * @author xianyang 2025/10/15
 * @module
 */

import messageDac from '../../daos/core/dac/messageDac.js'
import retSchema from '../../daos/retSchema.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/**
 * @description 获取会话消息信息
 * @author xianyang
 * @param {String} messageCode 会话消息标识
 * @returns {Promise<Object>} 会话消息元数据详细信息
 */
export async function getMessage(messageCode) {
    return messageDac.getByCode(messageCode, {extInfo: 0})
}

/**
 * @description 获取会话消息列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @param {Object} [options.projection] 覆盖默认投影（默认剔除体积最大的 extInfo）
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 消息数组}
 */
export async function getMessages(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter, projection: options.projection || {extInfo: 0}}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {insertTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return messageDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 面向调用方的消息视图，剔除发给模型的完整提示词
 * @author xianyang
 * @param {Object} doc message 文档
 * @returns {Object} 可安全外发的消息对象
 */
export function toMessageView(doc) {
    if (!doc) {
        return null
    }
    const extInfo = doc.extInfo || {}
    return {
        messageCode: doc.messageCode,
        conversationCode: doc.conversationCode,
        channel: doc.channel,
        channelGroup: doc.channelGroup,
        llmModel: doc.llmModel,
        query: doc.query,
        inputs: doc.inputs || [],
        answer: doc.answer,
        answerReasoning: doc.answerReasoning,
        answerFeedback: doc.answerFeedback,
        answerFromCache: !!doc.answerFromCache,
        answerCacheCode: doc.answerCacheCode,
        progress: doc.progress,
        error: doc.error,
        attachments: doc.attachments || [],
        answerAttachments: doc.answerAttachments || [],
        messageTokens: doc.messageTokens,
        answerTokens: doc.answerTokens,
        tokenizerVersion: doc.tokenizerVersion,
        insertTime: doc.insertTime,
        updateTime: doc.updateTime,
        process: toProcessSummary(extInfo),
    }
}

/*把执行过程压缩成可展示的统计，不外泄工具原文与提示词*/
function toProcessSummary(extInfo) {
    const skills = extInfo.skills || {}
    return {
        iterationCount: extInfo.iterationCount || 1,
        tools: (extInfo.tools || []).map(t => t?.function?.name).filter(Boolean),
        toolCalls: extInfo.toolCalls || [],
        toolChoice: extInfo.toolChoice,
        answerRounds: (extInfo.answerList || []).length,
        skills: {
            candidates: skills.candidates || [],
            loadedDetails: skills.loadedDetails || [],
            toolCount: skills.toolCount || 0,
            matchedCount: skills.matchedCount || 0,
        },
        contextUsage: extInfo.contextUsage || null,
        sources: extInfo.sources || [],
        toolCalls: extInfo.toolCalls || [],
        recallStats: extInfo.recallStats || null,
    }
}

/**
 * @description 获取供调用方展示的消息分页，不含发给模型的 messages 提示词
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序等参数
 * @returns {Promise<{total: Number, rows: [Object]}>} 视图化的分页结果
 */
export async function getMessagePage(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    const ret = await getMessages(filter, pageIndex, pageSize, {...options, projection: {messages: 0}})
    return {
        total: ret?.total || 0,
        rows: (ret?.rows || []).map(toMessageView),
    }
}

/*对大模型回答内容进行喜欢或不喜欢的反馈*/
export async function feedback(curUserInfo, messageCode, like) {
    let messageInfo = await messageDac.getByCode(messageCode)
    if (messageInfo?.operator?.userCode !== curUserInfo.userCode) {
        throw new Error(`会话消息不存在`)
    }

    if (!like) {
        like = 0
    }

    return messageDac.upsert({answerFeedback: like, messageCode})
}