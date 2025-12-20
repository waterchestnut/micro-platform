/**
 * @fileOverview 记住我的token相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import refreshTokenDac from '../../daos/core/dac/refreshTokenDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const refreshTokenPrefix = 'refreshToken:'

/**
 * @description 创建refreshToken，用于刷新accessToken等
 * @author menglb
 * @param {Object} userCode 用户标识
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @param {Object} [extInfo={}] 存储的扩展信息
 * @returns {Promise<Object>} 保存的用户和token信息对象
 */
export async function addRefreshToken(userCode, expiresTime, extInfo = {}) {
    if (!tools.isExist(userCode)) {
        throw new Error('缺少用户标识')
    }
    if (!expiresTime) {
        expiresTime = config.refreshTokenExpiresTime * 60
    }

    let tokenInfo = Object.assign({}, extInfo, {
        userCode: userCode,
        refreshToken: userCode + ':' + tools.getUUID(),
        insertTime: new Date()
    })
    let _key = refreshTokenPrefix + tokenInfo.refreshToken

    await redisClient.setValue(_key, tokenInfo, expiresTime)
    tokenInfo.expiresTime = expiresTime * 1000
    return tokenInfo
}

/**
 * @description 获取refreshToken信息
 * @author menglb
 * @param {String} refreshToken token标识
 * @param {Object} [prolongTime=false] token是否自动延期
 * @returns {Promise<Object>} 保存的用户和token信息对象
 */
export async function getRefreshTokenInfo(refreshToken, prolongTime = false) {
    let _key = refreshTokenPrefix + refreshToken
    let tokenInfo = await redisClient.getValue(_key)

    if (tokenInfo && prolongTime) {
        let expiresTime = config.refreshTokenExpiresTime * 60
        redisClient.setValue(_key, tokenInfo, expiresTime)
        tokenInfo.expiresTime = expiresTime * 1000
    }

    return tokenInfo
}

/**
 * @description 删除refreshToken信息
 * @author menglb
 * @param {String} refreshToken token标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteRefreshToken(refreshToken) {
    let _key = refreshTokenPrefix + refreshToken
    return redisClient.delValue(_key)
}

/**
 * @description 删除用户的所有refreshToken信息
 * @author menglb
 * @param {String} userCode 用户标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteRefreshTokenByUserCode(userCode) {
    let _key = refreshTokenPrefix + userCode + ':*'
    let keys = await redisClient.getKeys(_key)
    if (!keys) {
        return 0
    }
    return redisClient.delValue(keys)
}