/**
 * @fileOverview OAuth2.0授权码模式相关的处理
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import accessTokenDac from '../../daos/core/dac/accessTokenDac.js'
import refreshTokenDac from '../../daos/core/dac/refreshTokenDac.js'
import clientDac from '../../daos/core/dac/clientDac.js'
import authCodeDac from '../../daos/core/dac/authCodeDac.js'
import {URL} from 'url'
import {addAuthCode, getAuthCodeInfo} from '../core/authCode.js'
import OAuthTypeEnum from '../../daos/core/enum/OAuthTypeEnum.js'
import {addAccessToken, getAccessTokenInfo} from '../core/accessToken.js'
import {addRefreshToken, deleteRefreshToken, getRefreshTokenInfo} from '../core/refreshToken.js'
import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import {generateToken} from '../core/userUtils.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 验证应用合法性
 * @author menglb
 * @param {Object} params 请求授权的相关参数
 * @returns {Object} 接入应用的信息
 */
async function checkClient(params) {
    if (!params.clientCode) {
        throw retSchema.FAIL_OAUTH_CLIENTCODE_MISS
    }
    if (!params.retUrl) {
        throw retSchema.FAIL_OAUTH_RETURL_MISS
    }
    params.responseType = params.responseType || 'code'

    let client = await clientDac.getByCode(params.clientCode)
    if (!client || !client.clientCode || !client.retUrls?.length) {
        throw retSchema.FAIL_OAUTH_CLIENT_MISS
    }
    if (client.status === 1) {
        throw retSchema.FAIL_OAUTH_CLIENT_DISABLED
    }
    if (!client.retUrls.includes((new URL(params.retUrl)).host)) {
        throw retSchema.FAIL_OAUTH_RETURL_ERROR
    }

    return client
}

/**
 * @description 接入应用请求授权
 * @author menglb
 * @param {Object} params 请求授权的相关参数
 * @returns {Object} 接入应用的信息
 */
export async function authorize(params) {
    let client = await checkClient(params)

    delete client.clientSecret
    delete client.userCode
    return client
}

/**
 * @description 用户同意授权
 * @author menglb
 * @param {Object} params 请求授权的相关参数
 * @param {Object} curUserInfo 当前登录的用户
 * @returns {Object} 生成的授权码等信息
 */
export async function agreeAuthorize(params, curUserInfo) {
    let client = await checkClient(params)
    let scopes = client.scopes
    if (params.scopes) {
        let scopeArr = client.scopes
        scopes = params.scopes.split(',').filter(scope => scopeArr.includes(scope))
    }
    let authCodeInfo = {
        scopes,
        userCode: curUserInfo.userCode,
        clientCode: client.clientCode,
        retUrl: params.retUrl,
        accessToken: curUserInfo.accessToken,
        refreshToken: curUserInfo.refreshToken,
        oauthType: OAuthTypeEnum.user.value
    }
    authCodeInfo = await addAuthCode(curUserInfo.userCode, undefined, authCodeInfo)
    await authCodeDac.add(authCodeInfo)

    return authCodeInfo
}

/**
 * @description 接入应用获取token
 * @author menglb
 * @param {Object} params 请求token的相关参数
 * @returns {Object} token相关信息
 */
export async function getToken(params) {
    if (!params.clientCode || !params.clientSecret || !params.authCode || !params.retUrl) {
        throw retSchema.FAIL_OAUTH_PARAM_MISS
    }

    /*验证授权码*/
    let authCodeInfo = await getAuthCodeInfo(params.authCode)
    /*console.log(params.authCode, authCodeInfo, params.clientCode, params.retUrl)*/
    if (!authCodeInfo || authCodeInfo.clientCode !== params.clientCode) {
        throw retSchema.FAIL_OAUTH_AUTHCODE_INVALID
    }
    if (params.retUrl !== authCodeInfo.retUrl) {
        logger.debug('回调地址比较：' + params.retUrl + '\r\n' + authCodeInfo.retUrl)
        throw retSchema.FAIL_OAUTH_RETURL_ERROR
    }

    /*验证应用秘钥*/
    let client = await checkClient(params)
    if (client.clientSecret !== params.clientSecret) {
        throw retSchema.FAIL_OAUTH_CLIENTSECRET_INVALID
    }

    if (params.reuseToken) {
        // 重用用户中心登录界面的token
        let accessTokenInfo = await getAccessTokenInfo(authCodeInfo.accessToken, true)
        let refreshTokenInfo = await getRefreshTokenInfo(authCodeInfo.refreshToken, true)
        return {
            accessToken: accessTokenInfo ? accessTokenInfo.accessToken : '',
            refreshToken: refreshTokenInfo ? refreshTokenInfo.refreshToken : '',
            scopes: authCodeInfo.scopes,
            expiresTime: accessTokenInfo ? accessTokenInfo.expiresTime : 0
        }
    }

    /*生成accessToken*/
    let accessTokenInfo = await addAccessToken(authCodeInfo.userCode, undefined, authCodeInfo)
    await accessTokenDac.add(accessTokenInfo)

    /*生成refreshToken*/
    authCodeInfo.accessToken = accessTokenInfo.accessToken
    let refreshTokenInfo = await addRefreshToken(authCodeInfo.userCode, undefined, authCodeInfo)
    await refreshTokenDac.add(refreshTokenInfo)

    return {
        accessToken: accessTokenInfo.accessToken,
        refreshToken: refreshTokenInfo.refreshToken,
        scopes: authCodeInfo.scopes,
        expiresTime: accessTokenInfo.expiresTime
    }
}

/**
 * @description 刷新token
 * @author menglb
 * @param {String} refreshToken 刷新token的键值
 * @param {Boolean} [deleteOld=true] 是否删除原来的refreshToken
 * @returns {Promise<Object>} 附带新token信息的用户数据
 */
export async function refreshAccessToken(refreshToken, deleteOld = true) {
    /*验证token是否存在*/
    let tokenInfo = await getRefreshTokenInfo(refreshToken)
    if (!tokenInfo || !tokenInfo.userCode) {
        /* token失效 */
        return retSchema.FAIL_TOKEN_INVALID
    }

    /*读取并验证用户信息*/
    let userInfo = await userInfoDac.getByCode(tokenInfo.userCode)
    if (!userInfo) {
        /*用户不存在*/
        return retSchema.FAIL_USER_ERRORNAMEORPWD
    }

    /*用户详细信息*/
    let userDetail = await generateToken(userInfo, deleteOld, tokenInfo)

    /*删除原来的refreshToken*/
    if (deleteOld) {
        await deleteRefreshToken(refreshToken)
    }

    return userDetail
}