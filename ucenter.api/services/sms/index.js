/**
 * @fileOverview 短信发送的基础功能
 * @author xianyang
 * @module
 */

import SMSClient from '@alicloud/sms-sdk'
import {saveStatistic} from '../statistic/index.js'

const tools = ucenter.tools
const logger = ucenter.logger
const smsConfig = ucenter.config.sms

/**
 * @description 执行发送阿里云短信
 * @author xianyang
 * @param {Object} mobile 接收短信的手机号
 * @param {String} templateCode 短信模板的标识
 * @param {Object} templateParams 短信模板的参数
 * @param {String} [signName] 短信签名
 * @returns {Object} 发送是否成功
 */
export async function sendAliMsg(mobile, templateCode, templateParams, signName = '') {
    let smsClient = new SMSClient({accessKeyId: smsConfig.accessKeyId, secretAccessKey: smsConfig.accessKeySecret});

    let res = await smsClient.sendSMS({
        PhoneNumbers: mobile,
        SignName: signName || smsConfig.signName,
        TemplateCode: templateCode,
        TemplateParam: JSON.stringify(templateParams)
    });
    if (res?.Code !== 'OK') {
        logger.error('阿里云发送短信出错：' + res);
        throw new Error('短信发送失败');
    }
    /*logger.debug(info)*/
    saveStatistic({
        operateType: 'ucenter-email-send-exec',
        content: {
            mobile: mobile,
            templateCode: templateCode,
            templateParams: templateParams,
            signName: signName,
            msg: 'mobile：' + mobile + '，templateCode：' + templateCode + '，templateParams：' + JSON.stringify(templateParams) + '，signName：' + signName + '，阿里云返回：' + JSON.stringify(res),
        }
    })

    return {code: 0, data: res}
}