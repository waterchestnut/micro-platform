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
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 消息数组}
 */
export async function getMessages(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter, projection: {extInfo: 0}}
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