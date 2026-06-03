/**
 * @fileOverview 知识库操作日志相关的业务操作
 * @module
 */

import ragOperationLogDac from '../../daos/core/dac/ragOperationLogDac.js'
import LogTypeEnum from '../../daos/core/enum/LogTypeEnum.js'

const tools = rag.tools
const logger = rag.logger

/**
 * @description 添加操作日志
 * @param {Object} logInfo 日志信息
 * @param {String} logInfo.ragCode 知识库标识
 * @param {String} logInfo.logType 操作类型
 * @param {Object} logInfo.operator 操作人 {userCode, realName}
 * @param {Object} [logInfo.targetUser] 目标用户 {userCode, realName}
 * @param {String} [logInfo.targetMaterialTitle] 目标材料标题
 * @param {String} [logInfo.targetMaterialCode] 目标材料标识
 * @param {String} [logInfo.description] 操作描述
 * @param {Object} [logInfo.detail] 操作详情
 * @returns {Promise<Object>} 添加的日志记录
 */
export async function addLog(logInfo) {
    try {
        if (!logInfo.description && logInfo.logType) {
            logInfo.description = buildDescription(logInfo)
        }
        let record = {
            ragCode: logInfo.ragCode,
            logType: logInfo.logType,
            operator: logInfo.operator,
            targetUser: logInfo.targetUser,
            targetMaterialTitle: logInfo.targetMaterialTitle,
            targetMaterialCode: logInfo.targetMaterialCode,
            description: logInfo.description,
            detail: logInfo.detail,
        }
        return await ragOperationLogDac.add(record)
    } catch (e) {
        logger.error('添加操作日志失败：' + e.message)
    }
}

/**
 * @description 获取知识库操作日志列表
 * @param {String} ragCode 知识库标识
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=20] 分页大小
 * @param {Object} [options] 其他参数
 * @returns {Promise<{total: Number, rows: [Object]}>} 日志列表
 */
export async function getLogs(ragCode, pageIndex = 1, pageSize = 20, options = {}) {
    let optionsIn = {ragCode, ...options}
    if (!optionsIn.sort) {
        optionsIn.sort = {insertTime: -1}
    }
    return ragOperationLogDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 根据日志信息构建描述文本
 * @param {Object} logInfo 日志信息
 * @returns {String} 描述文本
 */
function buildDescription(logInfo) {
    let operatorName = logInfo.operator?.realName || '未知用户'
    let targetName = logInfo.targetUser?.realName || ''
    let materialTitle = logInfo.targetMaterialTitle || ''

    switch (logInfo.logType) {
        case 'member_join':
            return `${targetName || operatorName} 加入了知识库`
        case 'member_apply':
            return `${targetName || operatorName} 申请加入知识库`
        case 'application_approve':
            return `${operatorName} 同意了 ${targetName} 的加入申请`
        case 'application_reject':
            return `${operatorName} 拒绝了 ${targetName} 的加入申请`
        case 'material_add':
            return `${operatorName} 上传了文档「${materialTitle}」`
        case 'material_delete':
            return `${operatorName} 删除了文档「${materialTitle}」`
        case 'member_quit':
            return `${targetName || operatorName} 退出了知识库`
        case 'member_remove':
            return `${operatorName} 移除了成员 ${targetName}`
        case 'member_role_change':
            let fromType = logInfo.detail?.fromType || ''
            let toType = logInfo.detail?.toType || ''
            return `${operatorName} 将 ${targetName} 的角色从「${LogTypeEnum.toDescription(fromType) || fromType}」变更为「${LogTypeEnum.toDescription(toType) || toType}」`
        default:
            return `${operatorName} 执行了操作`
    }
}
