/**
 * @fileOverview 邮箱验证码相关的功能
 * @author xianyang
 * @module
 */

import * as captchaLogic from '../core/captcha.js'
import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'
import {execSendEmail} from './index.js'
import userInfoDac from '../../daos/core/dac/userInfoDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 发送邮箱验证码并存储
 * @author menglb
 * @param {String} email 邮箱
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendCode(email, needCaptcha = true, params = {}) {
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
    let existsInfo = await getCode(email)
    /*console.log(sms)*/
    if (existsInfo && existsInfo.sendTime) {
        let seconds = parseInt((new Date() - new Date(existsInfo.sendTime)) / 1000)
        /*console.log(seconds)*/
        if (seconds < 60) {
            return Object.assign({data: seconds}, retSchema.FAIL_SMS_SEND_OFTEN)
        }
    }
    let emailObj = await sendEmailCode(email)
    let cacheKey = getEmailCodeCacheKey(email)
    let codeCacheTime = config.email.codeCacheTime
    emailObj.sendTime = new Date()
    let saveRet = await redisClient.setValue(cacheKey, emailObj, codeCacheTime * 60)
    if (!saveRet) {
        logger.error('邮箱验证码保存失败：' + saveRet)
        throw new Error('验证码保存失败')
    }

    return emailObj
}

/**
 * @description 校验邮箱验证码
 * @author menglb
 * @param {String} email 邮箱
 * @param {String} emailCode 验证码
 * @returns {Promise<Boolean>} 验证码是否正确
 */
export async function checkCode(email, emailCode) {
    let existsInfo = await getCode(email)
    if (!existsInfo || !existsInfo.emailCode) {
        throw new Error('验证码已失效')
    }

    return existsInfo.emailCode === emailCode
}

/**
 * @description 获取存储的邮箱验证码
 * @author menglb
 * @param {String} email 邮箱
 * @returns {Object} 验证码
 */
export async function getCode(email) {
    let cacheKey = getEmailCodeCacheKey(email)
    let emailInfo = await redisClient.getValue(cacheKey)

    return emailInfo
}

/**
 * @description 生成随机数验证码
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
 * @description 发送邮箱验证码
 * @author menglb
 * @param {String} email 邮箱
 * @returns {Object} 验证码
 */
async function sendEmailCode(email) {
    let emailConfig = config.email
    let emailCode = generateCode()
    let content = emailConfig.codeNoticeDataFormat.replace(/\$code\$/ig, emailCode)
    await execSendEmail({
        from: emailConfig.codeNoticeUser, to: email, subject: '微平台登录注册验证码', text: content
    }, {
        user: emailConfig.codeNoticeUser, pass: emailConfig.codeNoticePwd
    })

    return {emailCode}
}




/**
 * @description 获取Redis键值
 * @author menglb
 * @returns {String} Redis键值
 */
function getEmailCodeCacheKey(email) {
    return 'email_code:' + email
}

/**
 * @description 注册时的邮箱验证码发送并存储
 * @author menglb
 * @param {String} email 邮箱
 * @param {String} schemaCode 使用模式
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendCodeByRegister(email, schemaCode = '', needCaptcha = true, params = {}) {
    // 判断邮箱是否已经注册
    let filter = {email}
    schemaCode && (filter.schemaCodes = schemaCode)
    let oldUser = await userInfoDac.getOneByFilter(filter)
    if (oldUser) {
        // 账户已存在
        throw new Error('该邮箱已注册，请直接登录')
    }

    return sendCode(email, needCaptcha, params)
}



/**
 * @description 登录时的邮箱验证码发送并存储
 * @author menglb
 * @param {String} email 邮箱号
 * @param {String} schemaCode 使用模式
 * @param {Boolean} [needCaptcha=true] 是否需要图形验证码
 * @param {Object} params 其他参数
 * @returns {Object} 验证码
 */
export async function sendEmailCodeByLogin(email, schemaCode = '', needCaptcha = true, params = {}) {
    // 判断手机号是否已经注册
    let filter = { email };
    let oldUser = await userInfoDac.getOneByFilter(filter)

    console.log('搜到的用户信息:', oldUser);
    if (!oldUser) {
        // 邮箱不存在
        throw new Error(email+'该邮箱未注册，请先注册')
    }
    return sendCode(email, needCaptcha, params)
}



/**
 * @description 校验邮箱验证码
 * @author menglb
 * @param {String} email 邮箱
 * @param {String} emailCode 验证码
 * @returns {Promise<Boolean>} 验证码是否正确
 */
export async function checkEmailCode(email, emailCode) {
    let existsInfo = await getCode(email)
    if (!existsInfo || !existsInfo.emailCode) {
        throw new Error('验证码已失效')
    }

    return existsInfo.emailCode === emailCode
}
