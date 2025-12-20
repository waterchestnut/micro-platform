/**
 * @fileOverview 用户操作日志相关的功能
 * @author xianyang
 * @module logic/statistic/index
 */

import {sendMessage} from '../../daos/kafka/client.js'
import retSchema from '../../daos/retSchema.js'
import ipHelper from '../../tools/ipHelper.js'
import * as tools from '../../tools/index.js'
import {getCookieValue} from '../../tools/cookieHelper.js'

/**
 * @description 保存统计信息
 * @param {Object} info 统计信息对象
 * @param {Request} [req] web request
 * @returns {Object} 保存是否成功
 */
export async function saveStatistic(info, req = null) {
    const {logger, config} = rag
    info = info || {}
    if (typeof info === 'string') {
        try {
            info = JSON.parse(info)
        } catch (e) {
            logger.error('saveStatistic:' + e)
        }
    }

    if (!info.operateType) {
        logger.error('日志信息不完整，无法记录')
        return retSchema.FAIL_UNEXPECTED
    }

    info.sysCode = info.sysCode || 'rag.api'
    info.sysName = info.sysName || '知识库服务api主程序'
    info.clientCode = info.clientCode || 'rag'
    info.clientName = info.clientName || '知识库服务'
    info.msgCode = info.msgCode || tools.getUUID()
    info.browseTime = info.browseTime || Date.now()
    info.content = info.content || {}
    if (req) {
        info.ip = info.ip || ipHelper.getClientIps(req)
        info.url = info.url || ((req.headers.protocol || req.protocol) + '://' + req.headers.host.replace(/:(80|443)$/, '') + req.originalUrl)
        info.lang = info.lang || req.headers['accept-language']
        info.referrer = info.referrer || req.headers['referrer']
        info.userAgent = info.userAgent || req.headers['user-agent']
        info.cookieId = info.cookieId || getCookieValue(req, 'param-cookieId')
        if (req.userInfo) {
            info.userCode = info.userCode || req.userInfo.userCode
            info.realName = info.realName || req.userInfo.realName
            info.orgCode = info.orgCode || req.userInfo.orgCode
        }
        info.content.accept = info.content.accept || req.headers['accept']
        info.content.method = info.content.method || req.method
    }

    return sendMessage([{topic: config.kafka.topics.statistic.topic, key: info.msgCode, value: JSON.stringify(info)}])
}

/**
 * @description 记录统计日志（简化版）
 * @author xianyang
 * @param {String} operateType 日志操作类型
 * @param {String} msgContent 操作的详细描述
 * @param {Object} [req] web request
 * @returns {Object} 日志记录是否成功
 */
export async function saveStatisticSimple(operateType, msgContent, req = null) {
    return saveStatistic({operateType, content: {msg: msgContent}}, req)
}

/**
 * @description 记录统计日志（带扩展对象）
 * @author xianyang
 * @param {String} operateType 日志操作类型
 * @param {String} msg 操作的详细描述
 * @param {Object} contentObj 扩展对象
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Object} 日志记录是否成功
 */
export async function saveStatisticContent(operateType, msg, contentObj = {}, curUserInfo = {}) {
    return saveStatistic({
        operateType,
        userCode: curUserInfo.userCode,
        realName: curUserInfo.realName,
        orgCode: curUserInfo.orgCode,
        content: {...contentObj, msg}
    }, null)
}
