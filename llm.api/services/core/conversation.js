/**
 * @fileOverview 会话相关的业务操作
 * @author xianyang 2025/10/15
 * @module
 */

import conversationDac from '../../daos/core/dac/conversationDac.js'
import retSchema from '../../daos/retSchema.js'
import messageDac from '../../daos/core/dac/messageDac.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/**
 * @description 获取会话信息
 * @author xianyang
 * @param {String} conversationCode 会话标识
 * @returns {Promise<Object>} 会话元数据详细信息
 */
export async function getConversation(conversationCode) {
    return conversationDac.getByCode(conversationCode)
}

/**
 * @description 获取会话列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 会话数组}
 */
export async function getConversations(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {insertTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return conversationDac.getByPage(pageIndex, pageSize, optionsIn)
}

/*按照频道分组统计会话信息*/
export async function statConversationByChannelGroup(channel, channelGroup) {
    let optionsIn = {channel, channelGroup}
    let stats = []
    let conversationStats = await conversationDac.aggregate([
        {
            $match: conversationDac.assembleParams(optionsIn)
        },
        {
            $group: {
                _id: {
                    channel: '$channel',
                    channelGroup: '$channelGroup',
                },
                count: {
                    $sum: 1,
                },
            },
        },
        {
            $project: {
                channel: '$_id.channel',
                channelGroup: '$_id.channelGroup',
                conversationCount: '$count'
            }
        },
    ])
    conversationStats?.forEach(stat => {
        stats.push({
            channel: stat.channel,
            channelGroup: stat.channelGroup,
            conversationCount: stat.conversationCount
        })
    })
    let messageStats = await messageDac.aggregate([
        {
            $match: messageDac.assembleParams(optionsIn)
        },
        {
            $group: {
                _id: {
                    channel: '$channel',
                    channelGroup: '$channelGroup',
                },
                count: {
                    $sum: 1,
                },
            },
        },
        {
            $project: {
                channel: '$_id.channel',
                channelGroup: '$_id.channelGroup',
                messageCount: '$count'
            }
        },
    ])
    messageStats?.forEach(_ => {
        let stat = stats.find(conversationStat => conversationStat.channel === _.channel && conversationStat.channelGroup === _.channelGroup)
        if (!stat) {
            stat = {
                channel: _.channel,
                channelGroup: _.channelGroup,
                messageCount: _.messageCount
            }
            stats.push(stat)
        } else {
            stat.messageCount = _.messageCount
        }
    })
    return stats
}