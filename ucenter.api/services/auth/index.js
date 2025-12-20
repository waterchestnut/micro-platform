/**
 * @fileOverview 授权的基础功能
 * @author xianyang 2024/6/21
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import {getAccessTokenInfo} from '../core/accessToken.js'
import {getUserDetail, getUserPrivs} from '../core/userInfo.js'
import {getClientAccessTokenInfo} from '../core/clientAccessToken.js'
import clientDac from '../../daos/core/dac/clientDac.js'
import pageConfigDac from '../../daos/core/dac/pageConfigDac.js'
import {matchPageConfig} from './page.js'
import {base64Encode} from '../../tools/security.js'
import {deleteBigField} from '../core/userUtils.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 附加用户相关信息
 * @author menglb
 * @param {Object} reqParams 请求的参数信息
 * @param {Object} data 原数据信息
 */
export async function assignUserInfo(reqParams, data) {
    let userTokenKey = reqParams.accessToken
    if (!tools.isExist(userTokenKey)) {
        return data
    }

    // 读取tokenInfo
    let tokenInfo = await getAccessTokenInfo(userTokenKey, true)
    if (!tokenInfo || !tokenInfo.userCode) {
        return data
    }

    /*读取用户信息*/
    data.userInfo = await getUserDetail(tokenInfo.userCode)
    delete data.userInfo.pwd
    delete data.userInfo.insertTime

    /*读取用户权限*/
    data.userInfo.privs = await getUserPrivs(data.userInfo.userCode)

    /*附加token*/
    data.userInfo.accessToken = reqParams.accessToken
    data.userInfo.refreshToken = reqParams.refreshToken
    data.userInfo.tokenInfo = tokenInfo

    return data
}

/**
 * @description 附加第三方客户端相关信息
 * @author menglb
 * @param {Object} reqParams 请求的参数信息
 * @param {Object} data 原数据信息
 */
export async function assignClientInfo(reqParams, data) {
    let clientTokenKey = reqParams.clientAccessToken
    if (!tools.isExist(clientTokenKey)) {
        return data
    }

    let tokenInfo = await getClientAccessTokenInfo(clientTokenKey)
    if (!tokenInfo || !tokenInfo.clientCode) {
        return data
    }

    /*读取应用信息*/
    data.clientInfo = await clientDac.getByCode(tokenInfo.clientCode)
    data.clientInfo.privs = data.clientInfo.modulePrivCodes || []
    delete data.clientInfo.clientSecret
    delete data.clientInfo.modulePrivCodes

    /*附加token*/
    data.clientInfo.clientAccessToken = reqParams.clientAccessToken
    data.clientInfo.clientRefreshToken = reqParams.clientRefreshToken

    return data
}

/**
 * @description 判断是否有权限操作
 * @author menglb
 * @param {Array} needPrivs 操作功能需要的权限
 * @param {Array} assignedPrivs 分配的权限
 * @returns {Boolean} 是否有权限操作
 */
export function hasPriv(needPrivs, assignedPrivs) {
    if (!needPrivs || !needPrivs.length) {
        /*功能没有配置权限*/
        return false
    }

    if (needPrivs.includes('all')) {
        /*授权用户均能访问*/
        return true
    }

    if (!assignedPrivs || !assignedPrivs.length) {
        /*用户没有配置权限*/
        return false
    }

    if (assignedPrivs.includes('all')) {
        /*超级权限访问*/
        return true
    }

    for (let i = 0; i < needPrivs.length; i++) {
        let confPriv = needPrivs[i]
        if (assignedPrivs.includes(confPriv)) {
            return true
        }
    }

    return false
}

/**
 * @description 校验接口权限
 * @author menglb
 * @param {Object} params 请求的参数信息
 * @return {Object} {code:0,data:{userInfo:base64String,clientInfo:base64String}}
 */
export async function checkAuth(params) {
    if (!params || !params.path || !params.method) {
        // 参数不全
        return {...retSchema.FAIL_PARAM_MISS}
    }
    params.path = params.path.split('?')[0].toLowerCase().replaceAll('//', '/')

    let pageConfig = await matchPageConfig(params.path, params.method)
    if (!pageConfig) {
        // 页面未配置时，禁止访问
        return {...retSchema.FAIL_USER_NOAUTHORITY}

        /*// 未配置页面时，默认登录用户即可访问
        pageConfig = {
            path: params.path,
            method: params.method,
            prefix: '',
            auth: true,
            clientAuth: false,
            privs: ['all'],
            clientPrivs: [],
            tags: []
        }*/
    }

    let data = {}
    await assignUserInfo(params, data)
    await assignClientInfo(params, data)

    if ((pageConfig.auth && !data.userInfo) || (pageConfig.clientAuth && !data.clientInfo)) {
        // token失效
        return {...(params['no-redirect'] ? retSchema.FAIL_TOKEN_NO_REDIRECT : retSchema.FAIL_TOKEN_INVALID)}
    }

    /*用户权限判定*/
    let pagePrivs = pageConfig.privs || []
    try {
        let privs = data.userInfo ? data.userInfo.privs : []
        if (pageConfig.auth && !hasPriv(pagePrivs, privs)) {
            // 没有权限
            return {...retSchema.FAIL_USER_NOAUTHORITY}
        }
    } catch (err) {
        logger.error('用户权限验证出错，错误信息：' + err)
        return {...retSchema.FAIL_UNEXPECTED}
    }

    /*客户端权限判定*/
    let pageClientPrivs = pageConfig.clientPrivs || []
    try {
        let clientPrivs = data.clientInfo ? data.clientInfo.privs : []
        if (pageConfig.clientAuth && !hasPriv(pageClientPrivs, clientPrivs)) {
            // 没有权限
            return {...retSchema.FAIL_USER_NOAUTHORITY}
        }
    } catch (err) {
        logger.error('应用权限验证出错，错误信息：' + err)
        return {...retSchema.FAIL_UNEXPECTED}
    }

    /*移除权限列表，内容太多*/
    if (data?.userInfo?.privs?.length) {
        data.userInfo.privs = []
    }

    return {
        code: 0,
        data: {
            userInfo: data.userInfo ? base64Encode(JSON.stringify(deleteBigField(data.userInfo))) : '',
            clientInfo: data.clientInfo ? base64Encode(JSON.stringify(data.clientInfo)) : ''
        }
    }
}