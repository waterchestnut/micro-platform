/**
 * @fileOverview OAuth2.0用户名密码模式相关的处理
 * @author xianyang 2024/6/25
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import accessTokenDac from '../../daos/core/dac/accessTokenDac.js'
import refreshTokenDac from '../../daos/core/dac/refreshTokenDac.js'
import clientDac from '../../daos/core/dac/clientDac.js'
import {addClientAccessToken} from "../core/clientAccessToken.js"
import {
    addClientRefreshToken,
    deleteClientRefreshToken,
    getClientRefreshTokenInfo
} from "../core/clientRefreshToken.js"

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const dayjs = ucenter.module.dayjs
const clientTokenRatePrefix = 'clientTokenRate:'

/**
 * @description 获取应用当前访问频次的缓存键
 * @author menglb
 * @param {String} clientCode 应用标识
 * @returns {String} 缓存键
 */
async function getRateCacheKey(clientCode) {
    let dateStr = dayjs().format('YYYYMMDD')
    return clientTokenRatePrefix + clientCode + ':' + dateStr
}

/**
 * @description 接入应用获取clientToken
 * @author menglb
 * @param {Object} params 请求clientToken的相关参数
 * @returns {Object} clientToken相关信息
 */
export async function getClientToken(params) {
    if (!params.clientCode || !params.clientSecret) {
        throw retSchema.FAIL_OAUTH_PARAM_MISS
    }
    let visitCount = redisClient.addIncr(getRateCacheKey(params.clientCode), 24 * 60 * 60)
    if (visitCount > config.client.tokenLimit) {
        throw new Error('操作过于频繁')
    }

    let clientInfo = await clientDac.getByCode(params.clientCode)
    if (!clientInfo?.clientCode) {
        throw retSchema.FAIL_OAUTH_CLIENT_MISS
    }
    if (clientInfo.status !== 0) {
        throw retSchema.FAIL_OAUTH_CLIENT_DISABLED
    }
    if (clientInfo.clientSecret !== params.clientSecret) {
        throw retSchema.FAIL_OAUTH_CLIENTSECRET_INVALID
    }

    /*生成clientAccessToken*/
    let clientAccessTokenInfo = await addClientAccessToken(clientInfo.clientCode, undefined, clientInfo)
    await accessTokenDac.add(clientAccessTokenInfo)

    /*生成clientRefreshToken*/
    clientInfo.accessToken = clientAccessTokenInfo.accessToken
    let clientRefreshTokenInfo = await addClientRefreshToken(clientInfo.clientCode, undefined, clientInfo)
    await refreshTokenDac.add(clientRefreshTokenInfo)
    return {
        clientAccessToken: clientAccessTokenInfo.clientAccessToken,
        clientRefreshToken: clientRefreshTokenInfo.clientRefreshToken,
        expiresTime: clientAccessTokenInfo.expiresTime
    }
}

/**
 * @description 刷新clientAccessToken
 * @author menglb
 * @param {String} clientRefreshToken 刷新token的键值
 * @param {Boolean} [deleteOld=true] 是否删除原来的clientrRefreshToken
 * @returns {Object} 附带新token信息的应用数据
 */
export async function refreshClientAccessToken(clientRefreshToken, deleteOld = true) {
    /*验证token是否存在*/
    let tokenInfo = await getClientRefreshTokenInfo(clientRefreshToken)
    if (!tokenInfo || !tokenInfo.clientCode) {
        /* token失效 */
        return retSchema.FAIL_TOKEN_INVALID
    }
    let visitCount = redisClient.addIncr(getRateCacheKey(tokenInfo.clientCode), 24 * 60 * 60)
    if (visitCount > config.client.tokenLimit) {
        throw new Error('操作过于频繁')
    }

    /*读取并验证应用信息*/
    let clientInfo = await clientDac.getByCode(tokenInfo.clientCode)
    if (!clientInfo?.clientCode) {
        /*应用不存在*/
        return retSchema.FAIL_OAUTH_CLIENT_MISS
    }

    /*删除原来的clientRefreshToken*/
    if (deleteOld) {
        await deleteClientRefreshToken(clientRefreshToken)
    }

    /*生成clientAccessToken*/
    let clientAccessTokenInfo = await addClientAccessToken(clientInfo.clientCode, undefined, clientInfo)
    await accessTokenDac.add(clientAccessTokenInfo)

    /*生成clientRefreshToken*/
    clientInfo.accessToken = clientAccessTokenInfo.accessToken
    let clientRefreshTokenInfo = await addClientRefreshToken(clientInfo.clientCode, undefined, clientInfo)
    await refreshTokenDac.add(clientRefreshTokenInfo)
    return {
        clientAccessToken: clientAccessTokenInfo.clientAccessToken,
        clientRefreshToken: clientRefreshTokenInfo.clientRefreshToken,
        expiresTime: clientAccessTokenInfo.expiresTime
    }
}