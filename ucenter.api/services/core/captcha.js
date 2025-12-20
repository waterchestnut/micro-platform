/**
 * @fileOverview 图形验证码相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import clientDac from '../../daos/core/dac/clientDac.js'
import redisClient from '../../daos/cache/redisClient.js'
import svgCaptcha from 'svg-captcha'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const cacheKeyPrefix = 'captcha:'

/**
 * @description svg-captcha生成验证码信息
 * @author menglb
 * @param {Object} options 参数选项
 * @returns {Array} 验证码信息，[0]-验证码结果文本，[1]-验证码图片二进制数据
 */
function genSvgCaptcha(options = {}) {
    let captcha = svgCaptcha.createMathExpr(options)
    return [captcha.text, captcha.data]
}

/**
 * @description 生成验证码
 * @author menglb
 * @param {String} [captchaKey] 验证码的键值
 * @param {Object} options svg-captcha参数选项
 * @returns {Object} {image:base编码的图片数据,key:验证码标识}
 */
export async function generateCaptcha(captchaKey, options) {
    let captchaArr = genSvgCaptcha(options)
    let captcha_code = captchaArr[0]
    let captcha_image = captchaArr[1]

    let captchaInfo = {
        text: captcha_code
    }
    let retInfo = {
        image: captcha_image,
        key: captchaKey || tools.getUUID()
    }

    let _cacheKey = cacheKeyPrefix + retInfo.key
    await redisClient.setValue(_cacheKey, captchaInfo, 5 * 60)

    return retInfo
}

/**
 * @description 读取验证码信息
 * @author menglb
 * @param key 验证码的键值
 * @returns {Object} {text:验证码文本标识}
 */
export async function getCaptchaInfo(key) {
    let _key = cacheKeyPrefix + key
    return redisClient.getValue(_key)
}

/**
 * @description 删除验证码信息
 * @author menglb
 * @param key 验证码的键值
 * @returns {Number} 删除的行数
 */
export async function deleteCaptcha(key) {
    let _key = cacheKeyPrefix + key
    return redisClient.delValue(_key)
}