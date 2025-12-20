/**
 * @fileOverview 手机注册登录相关的功能
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import * as rsaLogic from '../core/commonRsa.js'
import * as smsCodeLogic from './smsCode.js'
import {checkPassword, generateToken, getMd5Pwd} from '../core/userUtils.js'
import userInfoDac from '../../daos/core/dac/userInfoDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const security = ucenter.security
const config = ucenter.config

/**
 * @description 用户使用手机号注册
 * @author menglb
 * @param {Object} userParams 用户参数对象
 * @param {String} schemaCode 使用模式
 * @returns {Object} 注册成功的返回数据
 */
export async function registerByMobile(userParams, schemaCode = '') {
    if (!userParams.mobile) {
        throw new Error('手机号不能为空')
    }
    if (!userParams.smsCode) {
        throw new Error('手机验证码不能为空')
    }
    if (!userParams.pwd) {
        throw new Error('用户密码不能为空')
    }

    if (userParams.encrypt) {
        userParams.pwd = rsaLogic.decrypt(userParams.pwd)
    }
    checkPassword(userParams.pwd)

    const mobileData = await smsCodeLogic.getCode(userParams.mobile)
    if (mobileData?.smsCode !== userParams.smsCode) {
        throw new Error('手机验证码错误')
    }

    let filter = {mobile: userParams.mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let oldUser = await userInfoDac.getOneByFilter(filter)
    if (oldUser) {
        /*用户已存在*/
        throw new Error('手机号已存在')
    }

    userParams.userCode = 'sms_' + tools.getUUID()
    if (userParams.userCode) {
        let oldUser = await userInfoDac.getByCode(userParams.userCode)
        if (oldUser && oldUser.userCode) {
            throw new Error('注册失败，请重新尝试')
        }
    }

    if (userParams.email) {
        let filter = {email: userParams.email}
        schemaCode && (filter.schemaCodes = schemaCode)
        let oldUser = await userInfoDac.getOneByFilter(filter)
        if (oldUser) {
            /*用户已存在*/
            throw new Error('邮箱已存在')
        }
    }

    let userInfo = {
        userCode: userParams.userCode,
        realName: userParams.realName || (userParams.mobile.substr(0, 3) + '****' + userParams.mobile.substr(7, 4)),
        pwd: userParams.pwd,
        status: 0,
        orgCodes: userParams.orgCodes,
        mobile: userParams.mobile,
        email: userParams.email,
        insertTime: new Date(),
        groupCodes: [config.userGroup.general]
    }
    userInfo.pwd = getMd5Pwd(userInfo)

    let ret
    if (userParams.autoLogin) {
        let userDetail = await userInfoDac.add(userInfo)
        ret = await generateToken(userDetail)
    } else {
        ret = await userInfoDac.add(userInfo)
    }

    return ret
}

/**
 * @description 手机快捷登录
 * @author menglb
 * @param {Object} userParams 用户参数对象
 * @param {String} schemaCode 使用模式
 * @returns {Object} 登录成功的返回数据
 */
export async function mobileFastLogin(userParams, schemaCode = '') {
    if (!userParams.mobile) {
        throw new Error('手机不能为空')
    }
    if (!userParams.smsCode) {
        throw new Error('手机验证码不能为空')
    }

    const mobileData = await smsCodeLogic.getCode(userParams.mobile)
    if (mobileData?.smsCode !== userParams.smsCode) {
        throw new Error('手机验证码错误')
    }

    /* 读取并验证用户信息 */
    let filter = {mobile: userParams.mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let userInfo = await userInfoDac.getOneByFilter(filter)

    if (userInfo === null) {
        // 用户不存在
        return retSchema.FAIL_USER_NOT_EXIST
    }
    if (userInfo.status !== 0) {
        return retSchema.FAIL_USER_DISABLE
    }

    /*带token的用户详细信息*/
    return generateToken(userInfo)
}

/**
 * @description 用户更换手机
 * @author menglb
 * @param {Object} params 参数对象
 * @param {String} userCode 用户标识
 * @param {Number} isDelToken 0保留token，1或空为删除token
 * @param {Number} [withUser=0] 0错误时不返回用户信息，1错误时返回用户信息
 * @param {String} schemaCode 使用模式
 * @returns {Object|Boolean} 重置是否成功
 */
export async function updateMobile(params, userCode, isDelToken, withUser, schemaCode = '') {
    if (!userCode) {
        throw new Error('缺少用户标识')
    }
    if (!params.mobile) {
        throw new Error('手机号不能为空')
    }
    if (!params.smsCode) {
        throw new Error('手机验证码不能为空')
    }

    withUser = withUser ? parseInt(withUser) : 0

    const mobileData = await smsCodeLogic.getCode(params.mobile)
    if (mobileData?.smsCode !== params.smsCode) {
        throw new Error('手机验证码错误')
    }

    let filter = {mobile: params.mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let mobileUser = await userInfoDac.getOneByFilter(filter)
    if (mobileUser && mobileUser.userCode) {
        if (withUser === 1) {
            delete mobileUser.pwd
            return Object.assign({user: mobileUser}, retSchema.FAIL_USER_MOBILE_HAS_BIND)
        } else {
            return retSchema.FAIL_USER_MOBILE_HAS_BIND
        }
    }
    let user = await userInfoDac.getByCode(userCode)
    if (!user || !user.userCode) {
        /*用户不存在*/
        throw new Error('用户不存在')
    }

    let ret = await userInfoDac.update({userCode: user.userCode, mobile: params.mobile})
    return ret
}

/**
 * @description 用户通过手机重置密码
 * @author menglb
 * @param {Object} params 参数对象
 * @param {String} schemaCode 使用模式
 * @returns {Promise<Boolean>} 重置是否成功
 */
export async function resetPwdByMobile(params, schemaCode = '') {
    if (!params.mobile) {
        throw new Error('手机号不能为空')
    }
    if (!params.smsCode) {
        throw new Error('手机验证码不能为空')
    }
    if (!params.pwd) {
        throw new Error('新密码不能为空')
    }

    if (params.encrypt) {
        params.pwd = rsaLogic.decrypt(params.pwd)
    }
    checkPassword(params.pwd)

    const mobileData = await smsCodeLogic.getCode(params.mobile)
    if (mobileData?.smsCode !== params.smsCode) {
        throw new Error('手机验证码错误')
    }

    let filter = {mobile: params.mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let user = await userInfoDac.getOneByFilter(filter)
    if (!user || !user.userCode) {
        /*用户不存在*/
        throw new Error('用户不存在')
    }

    let pwd = getMd5Pwd({pwd: params.pwd, insertTime: user.insertTime})

    let ret = await userInfoDac.update({userCode: user.userCode, pwd})
    return !!ret
}