/**
 * @fileOverview 验证码校验相关的rpc服务
 * @author xianyang
 * @module
 */

import {loadProto} from '../utils.js'
import * as captchaLogic from '../../services/core/captcha.js'
import * as smsLogic from '../../services/sms/smsCode.js'
import * as emailLogic from '../../services/email/emailCode.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/captcha.proto'
const ucenterProto = loadProto(protoPath).ucenter

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Captcha.service, {
        checkCaptcha: async (call, callback) => {
            try {
                /*验证码校验*/
                let captchaInfo = await captchaLogic.getCaptchaInfo(call.request.captchaKey)
                /*删除验证码*/
                try {
                    captchaLogic.deleteCaptcha(call.request.captchaKey)
                } catch (err) {
                    logger.debug('删除验证码错误，错误信息：' + err)
                }
                let checked = true
                if (!tools.isExist(captchaInfo) || !tools.isExist(captchaInfo.text)
                    || captchaInfo.text.toLocaleLowerCase() !== call.request.captcha.toLocaleLowerCase()) {
                    return checked = false
                }
                callback(null, {checked})
            } catch (e) {
                callback(e)
            }
        },
        checkSmsCode: async (call, callback) => {
            try {
                let checked = await smsLogic.checkCode(call.request.mobile, call.request.smsCode)
                callback(null, {checked})
            } catch (e) {
                callback(e)
            }
        },
        checkEmailCode: async (call, callback) => {
            try {
                let checked = await emailLogic.checkCode(call.request.email, call.request.emailCode)
                callback(null, {checked})
            } catch (e) {
                callback(e)
            }
        },
    })

    return server
}