/**
 * @fileOverview 会话消息相关的业务操作
 * @author xianyang 2025/10/15
 * @module
 */

import messageDac from '../../daos/core/dac/messageDac.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import {resolveMessageScope} from './messageScope.js'
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

/**
 * @description 把执行过程压缩成可展示的统计，不外泄工具原文与提示词
 * @param {Object} extInfo message 文档的执行过程字段
 * @returns {Object} 前端 ProcessPanel 用的摘要
 */
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
        /** 循环怎么退出的（break/exhausted/…）与是否补过无工具收尾调用；历史回放与探针都靠它解释空答案 */
        loopExit: extInfo.loopExit || null,
        forcedFinal: !!extInfo.forcedFinal,
        /**
         * PR-B：过程分段。视图只裁不筛——段数与字段都原样给前端，
         * 让"这一轮模型做了什么"在历史回放里可见，而不是只有一句最终答案。
         */
        segments: extInfo.segments || [],
        segmentSummary: extInfo.segmentSummary || null,
    }
}

/**
 * @description 获取供调用方展示的消息分页，不含发给模型的 messages 提示词
 * @author xianyang
 * @param {Object} [filter] 筛选条件（来自请求体，不可信，必须经可见性收敛）
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序等参数
 * @param {Object} [curUserInfo] **当前登录用户**；缺失即拒绝（此前 filter 直接来自请求体，任何人可读全站问答）
 * @returns {Promise<{total: Number, rows: [Object]}>} 视图化的分页结果
 */
export async function getMessagePage(filter = {}, pageIndex = 1, pageSize = 10, options = {}, curUserInfo = {}) {
    const userCode = curUserInfo?.userCode
    /** 可见性按"会话成员制"判定，与 /core/conversation/list 同口径（conversationDac 的 $or: userCodes / operator.userCode） */
    const allowedCodes = userCode ? await conversationDac.getConversationCodes({userCode}) : []
    const scope = resolveMessageScope(filter, userCode, allowedCodes)
    if (!scope.ok) {
        /**
         * 状态码必须是 4xx 而不是 500：越权尝试要能被网关与监控按"拒绝"归类。
         * `format-reply.js` 的 setErrorHandler 取 `error.statusCode || 500`，裸 throw 会把越权伪装成服务异常。
         */
        const err = new Error(scope.reason === 'not-member' ? '无权访问该会话' : '缺少有效的用户身份（userCode）')
        err.statusCode = scope.reason === 'not-member' ? 403 : 401
        throw err
    }
    if (tools.isArray(scope.filter.conversationCode) && !scope.filter.conversationCode.length) {
        return {total: 0, rows: []}
    }
    const ret = await getMessages(scope.filter, pageIndex, pageSize, {...options, projection: {messages: 0}})
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