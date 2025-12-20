/**
 * @fileOverview 邮件发送的基础功能
 * @author xianyang
 * @module
 */

import nodemailer from 'nodemailer'
import {saveStatistic} from "../statistic/index.js"

const tools = ucenter.tools
const logger = ucenter.logger
const mailConfig = ucenter.config.email

/**
 * @description 执行发送邮件
 * @author xianyang
 * @param {Object} params 邮件参数
 * @param {Object} params.from 发件人，例如："Fred Foo 👻" <foo@example.com>
 * @param {Object} params.to 收件人，例如：bar@example.com, baz@example.com
 * @param {Object} params.subject 邮件标题，例如：Hello ✔
 * @param {Object} [params.text] 纯文本邮件内容，例如：Hello world?
 * @param {Object} [params.html] 富文本邮件内容，例如：<b>Hello world?</b>
 * @param {Object} auth 授权参数
 * @param {String} auth.user 用户名，例如邮箱的全名称
 * @param {String} auth.pass 密码
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Object} 发送是否成功
 */
export async function execSendEmail(params, auth, curUserInfo = null) {
    let transporter = nodemailer.createTransport({
        host: mailConfig.host,
        port: mailConfig.port,
        secure: mailConfig.ssl,
        auth: {
            user: auth.user,
            pass: auth.pass,
        },
    })
    let info = await transporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
    })
    /*logger.debug(info)*/
    saveStatistic({
        operateType: 'ucenter-email-send-exec',
        content: {
            from: params.from,
            to: params.to,
            subject: params.subject,
            user: auth.user,
            msg: 'from：' + params.from + '，to：' + params.to + '，subject：' + params.subject + '，text：' + params.text + '，html：' + params.html + '，user：' + auth.user + '，邮件服务器返回：' + JSON.stringify(info),
        }
    })

    return {code: 0, data: info}
}