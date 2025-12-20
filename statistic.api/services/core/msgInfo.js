/**
 * @fileOverview 统计消息相关的业务操作
 * @author xianyang
 * @module
 */

import msgInfoDac from '../../daos/core/dac/msgInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import msgSearchService from '../search/msg/index.js'

const tools = statistic.tools
const logger = statistic.logger
const config = statistic.config

/**
 * @description 获取统计消息信息
 * @author xianyang
 * @param {String} msgCode 统计消息标识
 * @returns {Promise<Object>} 统计消息元数据详细信息
 */
export async function getMsgInfo(msgCode) {
    return msgInfoDac.getByCode(msgCode)
}

/* 解析日志消息，存入MongoDB和ES */
export async function parseLogMsgInfo(msgInfo) {
    if (!msgInfo?.msgCode) {
        return 'none'
    }
    await msgInfoDac.upsert({
        ...msgInfo, operator: {
            userCode: msgInfo.userCode,
            realName: msgInfo.realName,
            orgCode: msgInfo.orgCode,
        }
    })
    await msgSearchService.updateIndex([msgInfo])
    return 'done'
}