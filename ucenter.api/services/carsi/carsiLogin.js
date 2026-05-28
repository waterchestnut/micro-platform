/**
 * @fileOverview CARSI 教育联邦认证 OAuth2 登录
 * @author
 * @module
 */

import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import carsiUserDac from '../../daos/core/dac/carsiUserDac.js'
import redisClient from '../../daos/cache/redisClient.js'
import retSchema from '../../daos/retSchema.js'
import {generateToken} from '../core/userUtils.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const carsiStatePrefix = 'carsiLogin:state:'

/**
 * @description 生成CARSI OAuth登录URL
 * @returns {Promise<String|null>}
 */
export async function getCarsiLoginUrl() {
    const carsiConfig = config.carsi
    if (!carsiConfig.clientId || !carsiConfig.authorizeUrl) return null

    const state = tools.getUUID()
    await redisClient.setValue(carsiStatePrefix + state, {status: 'pending'}, carsiConfig.stateExpiresTime)

    return carsiConfig.authorizeUrl
        + '?response_type=code'
        + '&client_id=' + encodeURIComponent(carsiConfig.clientId)
        + '&redirect_uri=' + encodeURIComponent(carsiConfig.redirectUri)
        + '&scope=' + encodeURIComponent(carsiConfig.scope)
        + '&state=' + encodeURIComponent(state)
}

/**
 * @description 处理CARSI OAuth回调
 */
export async function handleCarsiCallback(code, state) {
    const carsiConfig = config.carsi
    if (!code || !state) return retSchema.FAIL_CARSI_PARAM_MISS

    const stateInfo = await redisClient.getValue(carsiStatePrefix + state)
    if (!stateInfo) return {code: 8003, msg: '登录已过期'}

    try {
        const tokenResult = await exchangeCodeForToken(code, carsiConfig)
        if (!tokenResult || tokenResult.error) {
            logger.error('CARSI token交换失败:', tokenResult)
            return retSchema.FAIL_CARSI_LOGIN_FAILED
        }

        const userInfo = await getUserInfo(tokenResult.access_token, carsiConfig)
        if (!userInfo) return retSchema.FAIL_CARSI_LOGIN_FAILED

        const result = await carsiLoginOrRegister(userInfo)
        await redisClient.delValue(carsiStatePrefix + state)
        return result
    } catch (err) {
        logger.error('CARSI回调错误:', err)
        return retSchema.FAIL_CARSI_SERVER_ERROR
    }
}

async function exchangeCodeForToken(code, cfg) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
    })
    const res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body.toString()
    })
    return res.json()
}

async function getUserInfo(accessToken, cfg) {
    if (!cfg.userinfoUrl) return null
    const res = await fetch(cfg.userinfoUrl, {
        headers: {'Authorization': 'Bearer ' + accessToken}
    })
    return res.json()
}

async function carsiLoginOrRegister(userInfo) {
    const eppn = userInfo.eppn || userInfo.eduPersonPrincipalName || userInfo.sub
    const displayName = userInfo.displayName || userInfo.name || ''
    const email = userInfo.email || userInfo.mail || ''
    const affiliation = userInfo.eduPersonScopedAffiliation || userInfo.affiliation || ''
    const role = parseCarsiRole(affiliation)

    if (!eppn) {
        logger.error('CARSI缺少eppn')
        return retSchema.FAIL_CARSI_LOGIN_FAILED
    }

    const mapping = await carsiUserDac.getByEppn(eppn)
    if (mapping?.userCode) {
        const user = await userInfoDac.getByCode(mapping.userCode)
        if (!user) return retSchema.FAIL_USER_NOT_EXIST
        if (user.status !== 0) return retSchema.FAIL_USER_DISABLE

        await carsiUserDac.update({eppn, displayName, email, affiliation, role, updateTime: new Date()}, {eppn})
        const userDetail = await generateToken(user, true)
        return {code: 0, msg: '登录成功', data: {...userDetail, carsiRole: role}}
    }

    if (!config.allowRegister) {
        return {code: 0, data: {status: 'unregistered', eppn, displayName, role}}
    }

    const userDetail = await createCarsiUser(eppn, displayName, email, role, affiliation)
    return {code: 0, msg: '登录成功', data: {...userDetail, carsiRole: role}}
}

async function createCarsiUser(eppn, displayName, email, role, affiliation) {
    const userCode = tools.getUUID()
    const time = new Date()

    const groupCodes = []
    if (role === 'student') groupCodes.push('student')
    else if (role === 'teacher') groupCodes.push('teacher')

    await carsiUserDac.add({
        eppn, userCode, displayName, email, affiliation, role, insertTime: time, updateTime: time
    })

    try {
        await userInfoDac.add({
            userCode,
            realName: displayName || '',
            nickName: displayName || '',
            email: email || '',
            groupCodes,
            insertTime: time,
            updateTime: time,
            status: 0
        })
    } catch (err) {
        await carsiUserDac.destroyByFilter({eppn})
        throw err
    }

    const user = await userInfoDac.getByCode(userCode)
    return await generateToken(user, true)
}

function parseCarsiRole(affiliation) {
    if (!affiliation) return ''
    const lower = affiliation.toLowerCase()
    if (lower.includes('student')) return 'student'
    if (lower.includes('faculty') || lower.includes('staff') || lower.includes('employee')) return 'teacher'
    return ''
}

export async function getCarsiConfig() {
    return {code: 0, data: {enabled: !!(config.carsi.clientId && config.carsi.authorizeUrl)}}
}