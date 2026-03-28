/**
 * @fileOverview 协议相关的业务操作
 * @author menglb
 * @module
 */

import agreementDac from '../../daos/core/dac/agreementDac.js'

const logger = ucenter.logger

/**
 * @description 根据类型获取启用状态的协议（返回版本号最大的）
 * @author menglb
 * @param {Number} type 协议类型
 * @returns {Promise<Object>} 协议对象
 */
export async function getAgreementByType(type) {
    if (!type) {
        throw new Error('协议类型不能为空')
    }
    return await agreementDac.getLatestByType(type)
}

/**
 * @description 根据标识获取协议
 * @author menglb
 * @param {String} agreementCode 协议标识
 * @returns {Promise<Object>} 协议对象
 */
export async function getAgreementByCode(agreementCode) {
    if (!agreementCode) {
        throw new Error('协议标识不能为空')
    }
    return await agreementDac.getByCode(agreementCode)
}

/**
 * @description 获取用户协议
 * @author menglb
 * @returns {Promise<Object>} 协议对象
 */
export async function getUserAgreement() {
    return await getAgreementByType(1)
}

/**
 * @description 获取隐私协议
 * @author menglb
 * @returns {Promise<Object>} 协议对象
 */
export async function getPrivacyAgreement() {
    return await getAgreementByType(2)
}

/**
 * @description 获取协议列表
 * @author menglb
 * @param {Object} [filter={}] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options={}] 排序等参数
 * @returns {Promise<{total: Number, rows: [Object]}>} 协议列表
 */
export async function getAgreementList(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    return await agreementDac.getByPage(pageIndex, pageSize, filter, options)
}

/**
 * @description 添加协议
 * @author menglb
 * @param {Object} data 协议数据
 * @returns {Promise<Object>} 添加的协议对象
 */
export async function addAgreement(data) {
    if (!data) {
        throw new Error('协议数据不能为空')
    }
    if (!data.type) {
        throw new Error('协议类型不能为空')
    }
    if (!data.version) {
        throw new Error('协议版本号不能为空')
    }
    logger.info(`添加协议: ${data.type} - ${data.version}`)
    return await agreementDac.create(data)
}

/**
 * @description 修改协议
 * @author menglb
 * @param {String} agreementCode 协议标识
 * @param {Object} data 协议数据
 * @returns {Promise<Object>} 修改结果
 */
export async function updateAgreement(agreementCode, data) {
    if (!agreementCode) {
        throw new Error('协议标识不能为空')
    }
    logger.info(`修改协议: ${agreementCode}`)
    return await agreementDac.update({agreementCode, ...data})
}

/**
 * @description 删除协议
 * @author menglb
 * @param {String} agreementCode 协议标识
 * @returns {Promise<Object>} 删除结果
 */
export async function deleteAgreement(agreementCode) {
    if (!agreementCode) {
        throw new Error('协议标识不能为空')
    }
    logger.info(`删除协议: ${agreementCode}`)
    return await agreementDac.deleteByCode(agreementCode)
}
