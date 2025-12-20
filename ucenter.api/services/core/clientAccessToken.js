/**
 * @fileOverview 业务访问第三方客户端的token相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientAccessTokenPrefix = 'clientAccessToken:'

/**
 * @description 创建clientAccessToken，用于应用调用授权资源等
 * @author menglb
 * @param {Object} clientCode 应用标识
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @param {Object} [extInfo={}] 存储的扩展信息
 * @returns {Promise<Object>} 保存的应用和token信息对象
 */
export async function addClientAccessToken(clientCode, expiresTime, extInfo = {}) {
    if (!tools.isExist(clientCode)) {
        throw new Error('缺少应用标识')
    }
    if (!expiresTime) {
        expiresTime = config.clientAccessTokenExpiresTime * 60
    }

    let tokenInfo = Object.assign({}, extInfo, {
        clientCode: clientCode,
        clientAccessToken: clientCode + ':' + tools.getUUID(),
        insertTime: new Date()
    })

    let _key = clientAccessTokenPrefix + tokenInfo.clientAccessToken

    await redisClient.setValue(_key, tokenInfo, expiresTime)
    tokenInfo.expiresTime = expiresTime * 1000
    return tokenInfo
}

/**
 * @description 获取clientAccessToken信息
 * @author menglb
 * @param {String} clientAccessToken token标识
 * @param {Object} [prolongTime=false] token是否自动延期
 * @returns {Promise<Object>} 保存的应用和token信息对象
 */
export async function getClientAccessTokenInfo(clientAccessToken, prolongTime = false) {
    let _key = clientAccessTokenPrefix + clientAccessToken
    let tokenInfo = await redisClient.getValue(_key)

    if (tokenInfo && prolongTime) {
        let expiresTime = config.clientAccessTokenExpiresTime * 60
        redisClient.setValue(_key, tokenInfo, expiresTime)
        tokenInfo.expiresTime = expiresTime * 1000
    }

    return tokenInfo
}

/**
 * @description 删除clientAccessToken信息
 * @author menglb
 * @param {String} clientAccessToken token标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteClientAccessToken(clientAccessToken) {
    let _key = clientAccessTokenPrefix + clientAccessToken
    return redisClient.delValue(_key)
}

/**
 * @description 删除应用的所有clientAccessToken信息
 * @author menglb
 * @param {String} clientCode 应用标识
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteClientAccessTokenByClientCode(clientCode) {
    let _key = clientAccessTokenPrefix + clientCode + ':*'
    let keys = await redisClient.getKeys(_key)
    if (!keys) {
        return 0
    }
    return redisClient.delValue(keys)
}