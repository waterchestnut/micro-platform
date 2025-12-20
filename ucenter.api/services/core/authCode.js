/**
 * @fileOverview 授权码模式的授权码相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import authCodeDac from '../../daos/core/dac/authCodeDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const authCodePrefix = 'authCode:'

/**
 * @description 创建authCode缓存
 * @author menglb
 * @param {Object} userCode 用户标识
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @param {Object} [extInfo={}] 存储的扩展信息
 * @returns {Object} 保存的用户和token信息对象
 */
export async function addAuthCode(userCode, expiresTime, extInfo = {}) {
    if (!tools.isExist(userCode)) {
        throw new Error('缺少用户标识')
    }
    if (!expiresTime) {
        expiresTime = 5 * 60
    }

    let tokenInfo = Object.assign({}, extInfo, {
        userCode: userCode,
        authCode: userCode + ':' + tools.getUUID(),
        insertTime: new Date()
    })

    let _key = authCodePrefix + tokenInfo.authCode

    await redisClient.setValue(_key, tokenInfo, expiresTime)
    tokenInfo.expiresTime = expiresTime * 1000
    return tokenInfo
}

/**
 * @description 获取authCode信息
 * @author menglb
 * @param {String} authCode token标识
 * @returns {Object} 保存的用户和token信息对象
 */
export async function getAuthCodeInfo(authCode) {
    let _key = authCodePrefix + authCode
    return redisClient.getValue(_key)
}

/**
 * @description 删除authCode信息
 * @author menglb
 * @param {String} authCode token标识
 * @returns {Number} 删除的行数
 */
export async function deleteAuthCode(authCode) {
    let _key = authCodePrefix + authCode
    return redisClient.delValue(_key)
}

/**
 * @description 删除用户的所有authCode信息
 * @author menglb
 * @param {String} userCode 用户标识
 * @returns {Number} 删除的行数
 */
export async function deleteAuthCodeByUserCode(userCode) {
    let _key = authCodePrefix + userCode + ':*'
    let keys = await redisClient.getKeys(_key)
    return redisClient.delValue(keys)
}