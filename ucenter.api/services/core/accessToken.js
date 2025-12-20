/**
 * @fileOverview 业务访问用户的token相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import accessTokenDac from '../../daos/core/dac/accessTokenDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const accessTokenPrefix = 'accessToken:'

/**
 * @description 创建accessToken，用于用户登录等
 * @author menglb
 * @param {Object} userCode 用户标识
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @param {Object} [extInfo={}] 存储的扩展信息
 * @returns {Promise<Object>} 保存的用户和token信息对象
 */
export async function addAccessToken(userCode, expiresTime, extInfo = {}) {
    if (!tools.isExist(userCode)) {
        throw new Error('缺少用户标识')
    }
    if (!expiresTime) {
        expiresTime = config.accessTokenExpiresTime * 60
    }

    let tokenInfo = Object.assign({}, extInfo, {
        userCode: userCode,
        accessToken: userCode + ':' + tools.getUUID(),
        insertTime: new Date()
    })

    let _key = accessTokenPrefix + tokenInfo.accessToken

    await redisClient.setValue(_key, tokenInfo, expiresTime)
    tokenInfo.expiresTime = expiresTime * 1000
    return tokenInfo
}

/**
 * @description 获取accessToken信息
 * @author menglb
 * @param {String} accessToken token标识
 * @param {Object} [prolongTime=false] token是否自动延期
 * @returns {Promise<Object>} 保存的用户和token信息对象
 */
export async function getAccessTokenInfo(accessToken, prolongTime = false) {
    let _key = accessTokenPrefix + accessToken
    let tokenInfo = await redisClient.getValue(_key)

    if (tokenInfo && prolongTime) {
        let expiresTime = config.accessTokenExpiresTime * 60
        redisClient.setValue(_key, tokenInfo, expiresTime)
        tokenInfo.expiresTime = expiresTime * 1000
    }

    return tokenInfo
}

/**
 * @description 删除accessToken信息
 * @author menglb
 * @param {String} accessToken token标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteAccessToken(accessToken) {
    let _key = accessTokenPrefix + accessToken
    return redisClient.delValue(_key)
}

/**
 * @description 删除用户的所有accessToken信息
 * @author menglb
 * @param {String} userCode 用户标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteAccessTokenByUserCode(userCode) {
    let _key = accessTokenPrefix + userCode + ':*'
    let keys = await redisClient.getKeys(_key)
    if (!keys) {
        return 0
    }
    return redisClient.delValue(keys)
}