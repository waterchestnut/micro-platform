/**
 * @fileOverview 手机验证码相关的功能
 * @author xianyang
 * @module
 */

import * as captchaLogic from '../core/captcha.js'
import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import {sendAliMsg} from './index.js'
import userInfoDac from '../../daos/core/dac/userInfoDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 发送手机验证码并存储
 * @author menglb
 * @param {String} mobile 手机号
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendCode(mobile, needCaptcha = true, params = {}) {
    if (needCaptcha) {
        /*验证码校验*/
        let captchaInfo = await captchaLogic.getCaptchaInfo(params.captchaKey)
        /*删除验证码*/
        try {
            captchaLogic.deleteCaptcha(params.captchaKey)
        } catch (err) {
            logger.debug('删除验证码错误，错误信息：' + err)
        }
        if (!tools.isExist(captchaInfo) || !tools.isExist(captchaInfo.text)
            || captchaInfo.text.toLocaleLowerCase() !== params.captcha.toLocaleLowerCase()) {
            return retSchema.FAIL_USER_VCODE_INVALID
        }
    }

    /*校验发送时间（1分钟内不能重复发送）*/
    let existsInfo = await getCode(mobile)

    if (existsInfo && existsInfo.sendTime) {
        let seconds = parseInt((new Date() - new Date(existsInfo.sendTime)) / 1000)
        /*console.log(seconds)*/
        if (seconds < 60) {
            return Object.assign({data: seconds}, retSchema.FAIL_SMS_SEND_OFTEN)
        }
    }
    let mobileObj = await sendMobileCode(mobile)
    let cacheKey = getMobileCodeCacheKey(mobile)

    let codeCacheTime = (config.mobile?.codeCacheTime) || 300 // 默认 5 分钟


    mobileObj.sendTime = new Date()
    let saveRet = await redisClient.setValue(cacheKey, mobileObj, codeCacheTime * 60)
    if (!saveRet) {
        logger.error('手机验证码保存失败：' + saveRet)
        throw new Error('验证码保存失败')
    }

    return retSchema.SUCCESS
}

/**
 * @description 校验手机验证码
 * @author menglb
 * @param {String} mobile 手机号
 * @param {String} smsCode 验证码
 * @returns {Promise<Boolean>} 验证码是否正确
 */
export async function checkCode(mobile, smsCode) {
    let existsInfo = await getCode(mobile)
    if (!existsInfo || !existsInfo.smsCode) {
        throw new Error('验证码已失效111')
    }
    return existsInfo.smsCode === smsCode
}

/**
 * @description 获取存储的手机验证码
 * @author menglb
 * @param {String} mobile 手机号
 * @returns {Object} 验证码
 */
export async function getCode(mobile) {
    try {
        let cacheKey = getMobileCodeCacheKey(mobile)
        let mobileInfo = await redisClient.getValue(cacheKey)
        return mobileInfo
    } catch (error) {
        logger.error('获取验证码失败:', error)
        return null // 返回 null 或其他默认值
    }
}

/**
 * @description 生成随机数验证码F
 * @author menglb
 * @returns {String} 验证码
 */
function generateCode() {
    let str_ary = ['0', '1', '3', '4', '5', '6', '7', '8', '9']
    let str_num = 6
    let r_num = str_ary.length
    let text = ''
    for (let i = 0; i < str_num; i++) {
        let pos = Math.floor(Math.random() * r_num)
        text += str_ary[pos]
    }
    return text
}

/**
 * @description 发送手机验证码
 * @author menglb
 * @param {String} mobile 手机
 * @returns {Object} 验证码
 */
async function sendMobileCode(mobile) {
    let smsCode = generateCode()
    await sendAliMsg(mobile, config.sms.smsCodeTemplateCode, {code: smsCode})

    return {smsCode}
}

/**
 * @description 获取Redis键值
 * @author menglb
 * @returns {String} Redis键值
 */
function getMobileCodeCacheKey(mobile) {
    return 'sms_code:' + mobile
}

/**
 * @description 注册时的手机验证码发送并存储
 * @author menglb
 * @param {String} mobile 手机号
 * @param {String} schemaCode 使用模式
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendCodeByRegister(mobile, schemaCode = '', needCaptcha = true, params = {}) {
    // 判断手机号是否已经注册
    let filter = {mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let oldUser = await userInfoDac.getOneByFilter(filter)
    if (oldUser) {
        // 账户已存在
        throw new Error('该手机号已注册，请直接登录')
    }

    return sendCode(mobile, needCaptcha, params)
}

/**
 * @description 登录时的手机验证码发送并存储
 * @author menglb
 * @param {String} mobile 手机号
 * @param {String} schemaCode 使用模式
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendCodeByLogin(mobile, schemaCode = '', needCaptcha = true, params = {}) {
    // 判断手机号是否已经注册
    let filter = {mobile}
    schemaCode && (filter.schemaCodes = schemaCode)
    let oldUser = await userInfoDac.getOneByFilter(filter)
    if (!oldUser) {
        // 账户不存在
        throw new Error(mobile + '该手机号未注册，请先注册')
    }
    return sendCode(mobile, needCaptcha, params)
}



