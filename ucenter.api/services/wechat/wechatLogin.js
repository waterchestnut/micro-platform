/**
 * @fileOverview 微信开放平台扫码登录 + 小程序登录业务逻辑
 * @author
 * @module
 */

import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import wechatUserDac from '../../daos/core/dac/wechatUserDac.js'
import redisClient from '../../daos/cache/redisClient.js'
import retSchema from '../../daos/retSchema.js'
import {generateToken} from '../core/userUtils.js'
import {login as accountLogin, phoneLogin, emailLogin} from '../core/login.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const wechatStatePrefix = 'wechatLogin:state:'
const wechatBindTokenPrefix = 'wechatLogin:bindToken:'

/**
 * @description 生成微信扫码登录的授权URL和state标识
 * @param {String} [bindUserCode] 绑定模式下传入的当前用户标识
 * @returns {Promise<Object>} {authUrl, state, bindMode}
 */
export async function getWechatAuthUrl(bindUserCode) {
    const wechatConfig = config.wechat
    const state = tools.getUUID()

    const stateInfo = {
        status: 'pending',
        insertTime: new Date().toISOString()
    }
    if (bindUserCode) {
        stateInfo.bindUserCode = bindUserCode
        stateInfo.type = 'bind'
    }

    await redisClient.setValue(wechatStatePrefix + state, stateInfo, wechatConfig.stateExpiresTime)

    const authUrl = 'https://open.weixin.qq.com/connect/qrconnect'
        + '?appid=' + encodeURIComponent(wechatConfig.appId)
        + '&redirect_uri=' + encodeURIComponent(wechatConfig.redirectUri)
        + '&response_type=code'
        + '&scope=snsapi_login'
        + '&state=' + encodeURIComponent(state)

    return {
        authUrl,
        state,
        expiresIn: wechatConfig.stateExpiresTime * 1000
    }
}

/**
 * @description 轮询微信登录/绑定状态
 * @param {String} state 扫码登录的状态标识
 * @returns {Promise<Object>} 登录状态信息
 */
export async function getWechatLoginStatus(state) {
    const stateInfo = await redisClient.getValue(wechatStatePrefix + state)
    if (!stateInfo) {
        return {code: 7004, msg: '二维码已过期，请刷新重试', data: {status: 'expired'}}
    }

    if (stateInfo.status === 'success') {
        let result = {code: 0, msg: '成功', data: {status: 'success'}}
        if (stateInfo.type === 'bind') {
            result.msg = '微信绑定成功'
        } else {
            result.data.accessToken = stateInfo.accessToken
            result.data.refreshToken = stateInfo.refreshToken
        }
        await redisClient.delValue(wechatStatePrefix + state)
        return result
    }

    if (stateInfo.status === 'unregistered') {
        return {
            code: 0, data: {
                status: 'unregistered',
                nickName: stateInfo.pendingWechatInfo?.nickname || '',
                avatarUrl: stateInfo.pendingWechatInfo?.headimgurl || ''
            }
        }
    }

    if (stateInfo.status === 'failed') {
        await redisClient.delValue(wechatStatePrefix + state)
        return {code: 7003, msg: stateInfo.msg || '微信操作失败', data: {status: 'failed', msg: stateInfo.msg}}
    }

    return {code: 0, msg: '', data: {status: 'pending'}}
}

/**
 * @description 处理微信OAuth回调
 * @param {String} code 微信返回的授权码
 * @param {String} state 状态标识
 * @returns {Promise<Object>}
 */
export async function handleWechatCallback(code, state) {
    const wechatConfig = config.wechat

    if (!code || !state) {
        return retSchema.FAIL_WECHAT_PARAM_MISS
    }

    const stateInfo = await redisClient.getValue(wechatStatePrefix + state)
    if (!stateInfo) {
        return retSchema.FAIL_WECHAT_STATE_EXPIRED
    }

    try {
        const tokenResult = await exchangeCodeForToken(code, wechatConfig)
        if (!tokenResult || tokenResult.errcode) {
            await redisClient.setValue(wechatStatePrefix + state, {
                ...stateInfo,
                status: 'failed',
                msg: tokenResult?.errmsg || '获取微信token失败'
            }, wechatConfig.stateExpiresTime)
            return retSchema.FAIL_WECHAT_TOKEN_ERROR
        }

        const userInfo = await getWechatUserInfo(tokenResult.access_token, tokenResult.openid)
        if (!userInfo || userInfo.errcode) {
            await redisClient.setValue(wechatStatePrefix + state, {
                ...stateInfo,
                status: 'failed',
                msg: userInfo?.errmsg || '获取微信用户信息失败'
            }, wechatConfig.stateExpiresTime)
            return retSchema.FAIL_WECHAT_USERINFO_ERROR
        }

        let result

        if (stateInfo.bindUserCode) {
            result = await doBindWechat(stateInfo.bindUserCode, userInfo)
        } else {
            result = await wechatLoginOrBind(userInfo)
        }

        if (result.code !== 0) {
            await redisClient.setValue(wechatStatePrefix + state, {
                ...stateInfo,
                status: 'failed',
                msg: result.msg
            }, wechatConfig.stateExpiresTime)
            return result
        }

        if (result.data?.status === 'unregistered') {
            await redisClient.setValue(wechatStatePrefix + state, {
                ...stateInfo,
                status: 'unregistered',
                pendingWechatInfo: {
                    openid: userInfo.openid,
                    unionid: userInfo.unionid || '',
                    nickname: userInfo.nickname,
                    headimgurl: userInfo.headimgurl,
                    sex: userInfo.sex
                }
            }, wechatConfig.stateExpiresTime)
            return {code: 0, msg: '', data: {status: 'unregistered'}}
        }

        const successInfo = { ...stateInfo, status: 'success' }
        if (!stateInfo.bindUserCode) {
            successInfo.accessToken = result.data.accessToken
            successInfo.refreshToken = result.data.refreshToken
        }

        await redisClient.setValue(wechatStatePrefix + state, successInfo, wechatConfig.stateExpiresTime)

        return {code: 0, msg: '操作成功', data: {success: true}}
    } catch (err) {
        logger.error('微信回调处理错误:', err)
        await redisClient.setValue(wechatStatePrefix + state, {
            ...stateInfo,
            status: 'failed',
            msg: '微信服务异常'
        }, wechatConfig.stateExpiresTime)
        return retSchema.FAIL_WECHAT_SERVER_ERROR
    }
}

/**
 * @description 微信用户登录或绑定已有用户（扫码登录）
 * @param {Object} wechatUserInfo 微信用户信息
 * @returns {Promise<Object>}
 */
async function wechatLoginOrBind(wechatUserInfo) {
    const resolved = await resolveWechatUser(wechatUserInfo.openid, wechatUserInfo.unionid)

    if (resolved) {
        const platformUser = await userInfoDac.getByCode(resolved.userCode)
        if (!platformUser) {
            return retSchema.FAIL_USER_NOT_EXIST
        }
        if (platformUser.status !== 0) {
            return retSchema.FAIL_USER_DISABLE
        }

        const directMapping = await wechatUserDac.getByOpenId(wechatUserInfo.openid)
        if (!directMapping) {
            await addWechatMapping(wechatUserInfo.openid, wechatUserInfo.unionid || '', resolved.userCode, wechatUserInfo)
        } else {
            await updateWechatMapping(directMapping, wechatUserInfo)
        }

        const userDetail = await generateToken(platformUser, true)
        return {code: 0, msg: '登录成功', data: userDetail}
    }

    return {code: 0, data: {status: 'unregistered'}}
}

/**
 * @description 绑定微信到指定用户
 * @param {String} userCode 平台用户标识
 * @param {Object} wechatUserInfo 微信用户信息
 * @returns {Promise<Object>}
 */
async function doBindWechat(userCode, wechatUserInfo) {
    const existingByOpenId = await wechatUserDac.getByOpenId(wechatUserInfo.openid)
    if (existingByOpenId) {
        if (existingByOpenId.userCode === userCode) {
            return {code: 0, msg: '该微信已绑定当前账号'}
        }
        return retSchema.FAIL_WECHAT_ALREADY_BIND
    }

    if (wechatUserInfo.unionid) {
        const existingByUnionId = await wechatUserDac.getByUnionId(wechatUserInfo.unionid)
        if (existingByUnionId) {
            if (existingByUnionId.userCode === userCode) {
                await addWechatMapping(wechatUserInfo.openid, wechatUserInfo.unionid, userCode, wechatUserInfo)
                return {code: 0, msg: '微信绑定成功', data: {}}
            }
            return retSchema.FAIL_WECHAT_ALREADY_BIND
        }
    }

    await addWechatMapping(wechatUserInfo.openid, wechatUserInfo.unionid || '', userCode, wechatUserInfo)
    return {code: 0, msg: '微信绑定成功', data: {}}
}

/**
 * @description 根据openId或unionId查找微信用户记录（统一不同应用的用户）
 * @param {String} openId 微信openId
 * @param {String} unionId 微信unionId
 * @returns {Promise<Object|null>}
 */
async function resolveWechatUser(openId, unionId) {
    let record = await wechatUserDac.getByOpenId(openId)
    if (record) {
        return record
    }
    if (unionId) {
        record = await wechatUserDac.getByUnionId(unionId)
        if (record) {
            return record
        }
    }
    return null
}

/**
 * @description 为已有平台用户添加一个新的微信openId映射
 * @param {String} openId 微信openId
 * @param {String} unionId 微信unionId
 * @param {String} userCode 平台用户标识
 * @param {Object} wechatUserInfo 微信用户信息
 */
async function addWechatMapping(openId, unionId, userCode, wechatUserInfo) {
    const time = new Date()
    await wechatUserDac.add({
        openId,
        unionId: unionId || '',
        userCode,
        nickName: wechatUserInfo.nickname || '',
        avatarUrl: wechatUserInfo.headimgurl || '',
        gender: wechatUserInfo.sex || 0,
        insertTime: time,
        updateTime: time
    })
}

/**
 * @description 更新已有的微信映射记录的profile信息
 * @param {Object} existingRecord 已有的wechatUser记录
 * @param {Object} wechatUserInfo 微信用户信息
 */
async function updateWechatMapping(existingRecord, wechatUserInfo) {
    const updateFields = {updateTime: new Date()}
    if (wechatUserInfo.nickname != null) updateFields.nickName = wechatUserInfo.nickname
    if (wechatUserInfo.headimgurl != null) updateFields.avatarUrl = wechatUserInfo.headimgurl
    if (wechatUserInfo.sex != null) updateFields.gender = wechatUserInfo.sex
    if (wechatUserInfo.unionid) updateFields.unionId = wechatUserInfo.unionid
    await wechatUserDac.update(updateFields, {openId: existingRecord.openId})
}

/**
 * @description 创建微信关联的新平台用户
 * @param {Object} wechatUserInfo 微信用户信息
 * @returns {Promise<Object>}
 */
async function createWechatUser(wechatUserInfo) {
    const userCode = tools.getUUID()
    const time = new Date()

    const mapping = {
        openId: wechatUserInfo.openid,
        unionId: wechatUserInfo.unionid || '',
        userCode,
        nickName: wechatUserInfo.nickname || '微信用户',
        avatarUrl: wechatUserInfo.headimgurl || '',
        gender: wechatUserInfo.sex || 0,
        insertTime: time,
        updateTime: time
    }

    await wechatUserDac.add(mapping)

    try {
        await userInfoDac.add({
            userCode,
            nickName: wechatUserInfo.nickname || '微信用户',
            realName: '',
            avatarUrl: wechatUserInfo.headimgurl || '',
            gender: wechatUserInfo.sex || 0,
            insertTime: time,
            updateTime: time,
            status: 0
        })
    } catch (err) {
        await wechatUserDac.destroyByFilter({openId: wechatUserInfo.openid})
        throw err
    }

    const platformUser = await userInfoDac.getByCode(userCode)
    return await generateToken(platformUser, true)
}

/**
 * @description 查询用户微信绑定状态
 * @param {String} userCode 平台用户标识
 * @returns {Promise<Object>}
 */
export async function getWechatBindStatus(userCode) {
    if (!userCode) {
        return {code: 0, data: {bound: false}}
    }
    const record = await wechatUserDac.getByUserCode(userCode)
    if (record) {
        return {
            code: 0, data: {
                bound: true,
                nickName: record.nickName || '',
                avatarUrl: record.avatarUrl || '',
            }
        }
    }
    return {code: 0, data: {bound: false}}
}

/**
 * @description 解除微信绑定
 * @param {String} userCode 平台用户标识
 * @returns {Promise<Object>}
 */
export async function unbindWechat(userCode) {
    if (!userCode) {
        return retSchema.FAIL_USER_NOT_USERCODE
    }
    const record = await wechatUserDac.getByUserCode(userCode)
    if (!record) {
        return {code: 0, msg: '未绑定微信'}
    }
    await wechatUserDac.destroyByFilter({userCode})
    return {code: 0, msg: '微信解绑成功'}
}

/**
 * @description 微信小程序登录
 * @param {String} code 小程序调用wx.login()获取的临时code
 * @returns {Promise<Object>}
 */
export async function miniProgramLogin(code) {
    const mpConfig = config.wechat.miniProgram

    if (!mpConfig.appId || !mpConfig.appSecret) {
        return {...retSchema.FAIL_WECHAT_CONFIG_MISS, msg: '小程序登录未配置'}
    }

    if (!code) {
        return retSchema.FAIL_WECHAT_PARAM_MISS
    }

    try {
        const sessionResult = await code2Session(code, mpConfig)
        if (!sessionResult || sessionResult.errcode) {
            logger.error('小程序jscode2session失败:', sessionResult)
            return {...retSchema.FAIL_WECHAT_TOKEN_ERROR, msg: sessionResult?.errmsg || '小程序登录失败'}
        }

        const openId = sessionResult.openid
        const unionId = sessionResult.unionid || ''

        const resolved = await resolveWechatUser(openId, unionId)

        if (resolved) {
            const platformUser = await userInfoDac.getByCode(resolved.userCode)
            if (!platformUser) {
                return retSchema.FAIL_USER_NOT_EXIST
            }
            if (platformUser.status !== 0) {
                return retSchema.FAIL_USER_DISABLE
            }

            const directMapping = await wechatUserDac.getByOpenId(openId)
            if (!directMapping) {
                await addWechatMapping(openId, unionId, resolved.userCode, {nickname: null, headimgurl: null, sex: null, openid: openId, unionid: unionId})
            } else {
                await updateWechatMapping(directMapping, {nickname: null, headimgurl: null, sex: null, openid: openId, unionid: unionId})
            }

            const userDetail = await generateToken(platformUser, true)
            return {code: 0, msg: '登录成功', data: userDetail}
        }

        const bindToken = tools.getUUID()
        await redisClient.setValue(wechatBindTokenPrefix + bindToken, {
            openId,
            unionId,
            insertTime: new Date().toISOString()
        }, config.wechat.stateExpiresTime)

        return {code: 0, data: {status: 'unregistered', bindToken}}
    } catch (err) {
        logger.error('小程序登录错误:', err)
        return retSchema.FAIL_WECHAT_SERVER_ERROR
    }
}

/**
 * @description 注册新的微信用户（扫码登录后注册）
 * @param {String} state 扫码state
 * @returns {Promise<Object>}
 */
export async function registerWechatUser(state) {
    if (!config.allowRegister) {
        return {code: 7009, msg: '当前系统不允许注册新用户'}
    }
    const stateInfo = await redisClient.getValue(wechatStatePrefix + state)
    if (!stateInfo || !stateInfo.pendingWechatInfo) {
        return retSchema.FAIL_WECHAT_STATE_EXPIRED
    }

    const info = stateInfo.pendingWechatInfo
    const userDetail = await createWechatUser({
        openid: info.openid,
        unionid: info.unionid,
        nickname: info.nickname,
        headimgurl: info.headimgurl,
        sex: info.sex
    })

    await redisClient.delValue(wechatStatePrefix + state)
    return {code: 0, msg: '注册成功', data: userDetail}
}

/**
 * @description 绑定微信到已有用户（扫码登录后绑定，需登录凭证）
 * @param {String} state 扫码state
 * @param {String} loginType 登录方式: account|phone|email
 * @param {Object} credentials 登录凭证
 * @returns {Promise<Object>}
 */
export async function bindWechatWithLogin(state, loginType, credentials) {
    const stateInfo = await redisClient.getValue(wechatStatePrefix + state)
    if (!stateInfo || !stateInfo.pendingWechatInfo) {
        return retSchema.FAIL_WECHAT_STATE_EXPIRED
    }

    let loginResult
    switch (loginType) {
        case 'phone':
            loginResult = await phoneLogin(credentials.phone, credentials.verification)
            break
        case 'email':
            loginResult = await emailLogin(credentials.email, credentials.verification)
            break
        default:
            loginResult = await accountLogin(credentials.username, credentials.pwd, credentials.captchaKey, credentials.captcha)
    }

    if (loginResult.code !== 0) {
        return loginResult
    }

    const userCode = loginResult.userCode
    const info = stateInfo.pendingWechatInfo

    await doBindWechat(userCode, {
        openid: info.openid,
        unionid: info.unionid,
        nickname: info.nickname,
        headimgurl: info.headimgurl,
        sex: info.sex
    })

    await redisClient.delValue(wechatStatePrefix + state)
    return {code: 0, msg: '绑定成功', data: loginResult}
}

/**
 * @description 注册新的微信用户（小程序登录后注册）
 * @param {String} bindToken 小程序绑定令牌
 * @returns {Promise<Object>}
 */
export async function registerMpUser(bindToken) {
    if (!config.allowRegister) {
        return {code: 7009, msg: '当前系统不允许注册新用户'}
    }
    const pending = await redisClient.getValue(wechatBindTokenPrefix + bindToken)
    if (!pending) {
        return retSchema.FAIL_WECHAT_STATE_EXPIRED
    }

    const userDetail = await createWechatUser({
        openid: pending.openId,
        unionid: pending.unionId || '',
        nickname: null,
        headimgurl: null,
        sex: null
    })

    await redisClient.delValue(wechatBindTokenPrefix + bindToken)
    return {code: 0, msg: '注册成功', data: userDetail}
}

/**
 * @description 绑定微信到已有用户（小程序登录后绑定，需登录凭证）
 * @param {String} bindToken 小程序绑定令牌
 * @param {String} username 用户名
 * @param {String} pwd 密码
 * @param {String} captchaKey 图形验证码key
 * @param {String} captcha 图形验证码
 * @returns {Promise<Object>}
 */
export async function bindMpWithLogin(bindToken, loginType, credentials) {
    const pending = await redisClient.getValue(wechatBindTokenPrefix + bindToken)
    if (!pending) {
        return retSchema.FAIL_WECHAT_STATE_EXPIRED
    }

    let loginResult
    switch (loginType) {
        case 'phone':
            loginResult = await phoneLogin(credentials.phone, credentials.verification)
            break
        case 'email':
            loginResult = await emailLogin(credentials.email, credentials.verification)
            break
        default:
            loginResult = await accountLogin(credentials.username, credentials.pwd, credentials.captchaKey, credentials.captcha)
    }

    if (loginResult.code !== 0) {
        return loginResult
    }

    const userCode = loginResult.userCode

    await doBindWechat(userCode, {
        openid: pending.openId,
        unionid: pending.unionId || '',
        nickname: null,
        headimgurl: null,
        sex: null
    })

    await redisClient.delValue(wechatBindTokenPrefix + bindToken)
    return {code: 0, msg: '绑定成功', data: loginResult}
}

/**
 * @description 用授权码交换微信access_token (网页OAuth)
 * @param {String} code 授权码
 * @param {Object} wechatConfig 微信配置
 * @returns {Promise<Object>}
 */
async function exchangeCodeForToken(code, wechatConfig) {
    const url = 'https://api.weixin.qq.com/sns/oauth2/access_token'
        + '?appid=' + wechatConfig.appId
        + '&secret=' + wechatConfig.appSecret
        + '&code=' + code
        + '&grant_type=authorization_code'

    const response = await fetch(url)
    return response.json()
}

/**
 * @description 小程序code换session (jscode2session)
 * @param {String} code 小程序code
 * @param {Object} mpConfig 小程序配置
 * @returns {Promise<Object>}
 */
async function code2Session(code, mpConfig) {
    const url = 'https://api.weixin.qq.com/sns/jscode2session'
        + '?appid=' + mpConfig.appId
        + '&secret=' + mpConfig.appSecret
        + '&js_code=' + code
        + '&grant_type=authorization_code'

    const response = await fetch(url)
    return response.json()
}

/**
 * @description 获取微信用户信息 (网页OAuth)
 * @param {String} accessToken 微信access_token
 * @param {String} openId 微信openId
 * @returns {Promise<Object>}
 */
async function getWechatUserInfo(accessToken, openId) {
    const url = 'https://api.weixin.qq.com/sns/userinfo'
        + '?access_token=' + encodeURIComponent(accessToken)
        + '&openid=' + encodeURIComponent(openId)

    const response = await fetch(url)
    return response.json()
}