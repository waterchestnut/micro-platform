/**
 * @fileOverview 第三方客户端刷新token相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientRefreshTokenPrefix = 'clientRefreshToken:'

/**
 * @description 创建clientRefreshToken，用于刷新accessToken等
 * @author menglb
 * @param {Object} clientCode 应用标识
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @param {Object} [extInfo={}] 存储的扩展信息
 * @returns {Promise<Object>} 保存的应用和token信息对象
 */
export async function addClientRefreshToken(clientCode, expiresTime, extInfo = {}) {
    if (!tools.isExist(clientCode)) {
        throw new Error('缺少应用标识')
    }
    if (!expiresTime) {
        expiresTime = config.clientRefreshTokenExpiresTime * 60
    }

    let tokenInfo = Object.assign({}, extInfo, {
        clientCode: clientCode,
        clientRefreshToken: clientCode + ':' + tools.getUUID(),
        insertTime: new Date()
    })
    let _key = clientRefreshTokenPrefix + tokenInfo.clientRefreshToken

    await redisClient.setValue(_key, tokenInfo, expiresTime)
    tokenInfo.expiresTime = expiresTime * 1000
    return tokenInfo
}

/**
 * @description 获取clientRefreshToken信息
 * @author menglb
 * @param {String} clientRefreshToken token标识
 * @param {Object} [prolongTime=false] token是否自动延期
 * @returns {Promise<Object>} 保存的应用和token信息对象
 */
export async function getClientRefreshTokenInfo(clientRefreshToken, prolongTime = false) {
    let _key = clientRefreshTokenPrefix + clientRefreshToken
    let tokenInfo = await redisClient.getValue(_key)

    if (tokenInfo && prolongTime) {
        let expiresTime = config.clientRefreshTokenExpiresTime * 60
        redisClient.setValue(_key, tokenInfo, expiresTime)
        tokenInfo.expiresTime = expiresTime * 1000
    }

    return tokenInfo
}

/**
 * @description 删除clientRefreshToken信息
 * @author menglb
 * @param {String} clientRefreshToken token标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteClientRefreshToken(clientRefreshToken) {
    let _key = clientRefreshTokenPrefix + clientRefreshToken
    return redisClient.delValue(_key)
}

/**
 * @description 删除应用的所有clientRefreshToken信息
 * @author menglb
 * @param {String} clientCode 应用标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteClientRefreshTokenByClientCode(clientCode) {
    let _key = clientRefreshTokenPrefix + clientCode + ':*'
    let keys = await redisClient.getKeys(_key)
    if (!keys) {
        return 0
    }
    return redisClient.delValue(keys)
}