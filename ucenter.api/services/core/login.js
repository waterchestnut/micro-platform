/**
 * @fileOverview 登录相关的业务操作
 * @author xianyang
 * @module
 */

import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import * as rsaLogic from './commonRsa.js'
import {checkPassword, generateToken, getMd5Pwd} from './userUtils.js'
import * as captchaLogic from './captcha.js'
import retSchema from '../../daos/retSchema.js'
import {checkCode, sendCodeByLogin} from '../sms/smsCode.js'
import {checkEmailCode, sendEmailCodeByLogin} from '../email/emailCode.js'

import {addErrorNumber, getErrorNumber, getErrorStatus} from './loginNum.js'
import {deleteAccessToken, deleteAccessTokenByUserCode, getAccessTokenInfo} from './accessToken.js'
import {deleteRefreshToken, deleteRefreshTokenByUserCode, getRefreshTokenInfo} from './refreshToken.js'
import {emailFastLogin} from '../email/emailLogin.js'
import {mobileFastLogin} from '../sms/smsLogin.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 用户名密码登录
 * @author xianyang
 * @param {String} username 用户名
 * @param {String} pwd 密码
 * @param {String} captchaKey 验证码KEY
 * @param {String} captcha 用户输入的验证码
 * @param {Boolean} [encrypt=true] 密码是否是密文
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 登录成功返回带token的用户详细信息
 */
export async function login(username, pwd, captchaKey, captcha, encrypt = true, needCaptcha = true, schemaCode = '') {
    if (needCaptcha) {
        /*验证码校验*/
        let captchaInfo = await captchaLogic.getCaptchaInfo(captchaKey)
        /*删除验证码*/
        try {
            captchaLogic.deleteCaptcha(captchaKey)
        } catch (err) {
            logger.debug('删除验证码错误，错误信息：' + err)
        }
        if (!tools.isExist(captchaInfo) || !tools.isExist(captchaInfo.text)
            || captchaInfo.text.toLocaleLowerCase() !== captcha.toLocaleLowerCase()) {
            return retSchema.FAIL_USER_VCODE_INVALID
        }
    }

    let errorStatus = await getErrorStatus(username)
    if (errorStatus && errorStatus === 1) {
        return retSchema.FAIL_USER_LOCK
    }

    if (encrypt) {
        pwd = rsaLogic.decrypt(pwd)
    }

    /*读取并验证用户信息*/
    let filter = {$or: [{userCode: username}, {mobile: username}, {email: username}, {loginName: username}]}
    schemaCode && (filter.schemaCodes = schemaCode)
    let userInfo = await userInfoDac.getOneByFilter(filter)
    let privatePwd = getMd5Pwd({pwd, insertTime: userInfo?.insertTime || new Date()})
    /*console.log(pwd, privatePwd, userInfo.pwd)*/
    if (!userInfo || privatePwd !== userInfo.pwd) {
        /*用户名或密码错误*/
        let errorNumber = await getErrorNumber(username)
        await addErrorNumber(username, errorNumber)
        let msg = retSchema.FAIL_USER_ERRORNAMEORPWD.msg.replace(/n/g, ((errorNumber ? errorNumber : 0) + 1))
        return {
            code: retSchema.FAIL_USER_ERRORNAMEORPWD.code,
            msg: msg,
        }
    }
    if (userInfo.status !== 0) {
        return retSchema.FAIL_USER_DISABLE
    }

    /*带token的用户详细信息*/
    return await generateToken(userInfo, true, {}, username)
}

/**
 * @description 手机号获取用户登录登录验证码
 * @author xianyang
 * @param {String} mobile 用户手机号
 * @param {String} captchaKey 验证码KEY
 * @param {String} captcha 用户输入的验证码
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 返回验证码信息
 */
export async function phoneLoginVerify(mobile, captchaKey, captcha, needCaptcha = true, schemaCode = '') {
    // 使用 await 等待异步操作完成
    let params = {
        captchaKey,
        captcha
    }
    let verification = await sendCodeByLogin(mobile, schemaCode, needCaptcha, params)
    /*验证码成功发送*/
    return verification
}

/**
 * @description 用户邮箱获取用户登录登录验证码
 * @author xianyang
 * @param {String} email 用户邮箱
 * @param {String} captchaKey 验证码KEY
 * @param {String} captcha 用户输入的验证码
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 返回验证码信息
 */
export async function emailLoginVerify(email, captchaKey, captcha, needCaptcha = true, schemaCode = '') {
    logger.debug('邮箱:', {email})
    // 使用 await 等待异步操作完成
    let params = {
        captchaKey,
        captcha
    }
    let verification = await sendEmailCodeByLogin(email, schemaCode, needCaptcha, params)
    /*验证码成功发送*/
    return verification
}

/**
 * @description 邮箱验证码登录
 * @author xianyang
 * @param {String} email 邮箱
 * @param {String} verification 邮箱验证码
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 登录成功返回带token的用户详细信息
 */
export async function emailLogin(email, verification, schemaCode = '') {
    return emailFastLogin({email, emailCode: verification}, schemaCode)
}

/**
 * @description 手机号验证码登录
 * @author xianyang
 * @param {String} mobile 手机号
 * @param {String} verification 手机号验证码
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 登录成功返回带token的用户详细信息
 */
export async function phoneLogin(mobile, verification, schemaCode = '') {
    return mobileFastLogin({mobile, smsCode: verification}, schemaCode)
}


/**
 * @description 用户修改密码
 * @author menglb
 * @param {Object} curUserInfo 当前登录的用户
 * @param {String} oldPwd 原密码
 * @param {String} newPwd 新密码
 * @param {Number} isDelToken 0保留token，1或空为删除token
 * @param {Number} [encrypt=0] 密码是否是密文：0明文，1密文
 * @returns {Promise<Boolean>} 密码修改是否成功
 */
export async function updatePwd(curUserInfo, oldPwd, newPwd, isDelToken, encrypt = 0) {
    let userInfo = await userInfoDac.getByCode(curUserInfo.userCode)
    if (!userInfo) {
        /*用户不存在*/
        throw new Error('用户不存在')
    }

    /*传输的密文解密*/
    if (encrypt) {
        oldPwd = rsaLogic.decrypt(oldPwd)
        newPwd = rsaLogic.decrypt(newPwd)
    }
    checkPassword(newPwd)

    let pwd = getMd5Pwd({pwd: oldPwd, insertTime: userInfo.insertTime})
    if (pwd !== userInfo.pwd) {
        /*密码错误*/
        throw new Error('原密码错误')
    }

    pwd = getMd5Pwd({pwd: newPwd, insertTime: userInfo.insertTime})
    if (pwd === userInfo.pwd) {
        /*修改前后密码相同*/
        throw new Error('新密码与原密码不能一样')
    }
    let ret = await userInfoDac.update({userCode: userInfo.userCode, pwd})
    return !!ret
}

/**
 * @description 用户设置自定义登录名
 * @author menglb
 * @param {Object} curUserInfo 当前登录的用户
 * @param {String} loginName 登录名
 * @returns {Promise<Boolean>} 设置自定义登录名是否成功
 */
export async function setLoginName(curUserInfo, loginName) {
    if (!loginName) {
        throw new Error('登录名不能为空')
    }
    let userInfo = await userInfoDac.getByCode(curUserInfo.userCode)
    if (!userInfo) {
        /*用户不存在*/
        throw new Error('用户不存在')
    }

    let existsUser = await userInfoDac.getOneByFilter({loginName})
    if (existsUser?.userCode) {
        throw new Error('登录名已存在')
    }

    let ret = await userInfoDac.update({userCode: userInfo.userCode, loginName})
    return !!ret
}

/**
 * @description 用户退出登录
 * @author menglb
 * @param {String} accessToken 接口访问的Token
 * @param {String} [refreshToken] 刷新的Token
 * @param {Boolean} [logoutAll=false] 是否退出用户所有的登录
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Object>} 退出是否成功
 */
export async function logout(accessToken, refreshToken, logoutAll, schemaCode = '') {
    let token = await getAccessTokenInfo(accessToken)
    if (!token || !token.userCode) {
        return retSchema.FAIL_TOKEN_INVALID
    }

    if (logoutAll) {
        await deleteRefreshTokenByUserCode(token.userCode)
        return deleteAccessTokenByUserCode(token.userCode)
    }

    let ret = await deleteAccessToken(accessToken)
    if (refreshToken) {
        ret = await deleteRefreshToken(refreshToken)
    }

    return retSchema.SUCCESS
}

/**
 * @description 执行刷新Token
 * @author xianyang
 * @param {String} refreshToken 刷新用的Token
 * @returns {Promise<Object>} 登录成功返回带token的用户详细信息
 */
export async function execRefreshToken(refreshToken) {
    let token = await getRefreshTokenInfo(refreshToken)
    if (!token?.userCode) {
        return retSchema.FAIL_TOKEN_INVALID
    }
    let userInfo = await userInfoDac.getByCode(token.userCode)
    if (!userInfo?.userCode) {
        return retSchema.FAIL_TOKEN_INVALID
    }

    let ret = await generateToken(userInfo, true)
    await deleteRefreshToken(refreshToken)
    return ret
}