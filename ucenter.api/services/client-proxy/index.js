/**
 * @fileOverview 授权的应用端代理
 * @author menglb
 * @module
 */

import redisClient from '../../daos/cache/redisClient.js'
import {getToken} from "../oauth/code.js"

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientProxyConfig = config.clientProxy

/**
 * @description 生成并记录OAuth的state
 * @returns {*}
 */
export async function generateStateCode() {
    let stateCode = tools.getUUID()
    let cacheKey = "state:" + stateCode
    await redisClient.setValue(cacheKey, stateCode, clientProxyConfig.stateExpiresTime * 60)
    return stateCode
}

/**
 * @description 获取OAuth的state
 * @param {String} code
 * @returns {*}
 */
export async function getStateCode(code) {
    let cacheKey = "state:" + code
    return await redisClient.getValue(cacheKey)
}

/**
 * @description 删除OAuth的state
 * @param {String} code
 * @returns {*}
 */
export async function delStateCode(code) {
    let cacheKey = "state:" + code
    return await redisClient.delValue(cacheKey)
}

/**
 * @description 获取token
 * @param {String} authCode
 * @param {String} redirectUrl
 * @param {Object} clientConfig
 * @returns {*}
 */
export async function fetchToken(authCode, redirectUrl, clientConfig) {
    let param = {
        clientCode: clientConfig.clientCode,
        clientSecret: clientConfig.clientSecret,
        authCode: authCode,
        retUrl: redirectUrl,
        reuseToken: true
    }
    return getToken(param)
}
