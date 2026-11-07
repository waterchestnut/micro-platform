/**
 * @fileOverview 通知发送内部接口（供产品线服务端调用：邮件/短信通道复用底座既有能力）
 *               邮件默认使用 ucenter 业务通知邮箱配置，调用方可覆盖 auth/from；
 *               短信沿用阿里云模板机制（templateCode 由阿里云侧审核模板决定）
 * @author menglb 2026/11/07
 * @module
 */

import {execSendEmail} from '../../../services/email/index.js'
import {sendAliMsg} from '../../../services/sms/index.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

const emailConfig = ucenter.config.email
const smsConfig = ucenter.config.sms
const logger = ucenter.logger

export const autoPrefix = '/core/notice/ipmi'

export default async function (fastify, opts) {

    fastify.post('/email/send', {
        schema: {
            description: '发送邮件（默认发件账号为 ucenter 业务通知邮箱；execSendEmail 自带发送审计统计）',
            summary: '发送邮件',
            body: {
                type: 'object',
                properties: {
                    from: {type: 'string', description: '发件人，缺省用通知邮箱'},
                    to: {type: 'string', description: '收件人，多个逗号分隔'},
                    subject: {type: 'string', description: '邮件标题'},
                    text: {type: 'string', description: '纯文本内容'},
                    html: {type: 'string', description: '富文本内容'},
                    auth: {
                        type: 'object',
                        properties: {
                            user: {type: 'string'},
                            pass: {type: 'string'},
                        },
                        description: 'SMTP授权，缺省用 ucenter 通知邮箱配置',
                    },
                },
                required: ['to', 'subject'],
            },
            response: {default: getResSwaggerSchema()},
        },
    }, async function (request, reply) {
        const {from, to, subject, text, html, auth} = request.reqParams
        const ret = await execSendEmail(
            {from: from || `"毕业设计管理系统" <${emailConfig.codeNoticeUser}>`, to, subject, text, html},
            auth || {user: emailConfig.codeNoticeUser, pass: emailConfig.codeNoticePwd},
            request.userInfo,
        )
        logger.info(`notice-ipmi邮件发送 to=${to} subject=${subject}`)
        return ret
    })

    fastify.post('/sms/send', {
        schema: {
            description: '发送阿里云短信（模板须在阿里云侧预先审核；签名缺省用全局配置）',
            summary: '发送短信',
            body: {
                type: 'object',
                properties: {
                    mobile: {type: 'string', description: '手机号'},
                    templateCode: {type: 'string', description: '阿里云短信模板标识'},
                    templateParams: {type: 'object', description: '模板变量'},
                    signName: {type: 'string', description: '签名，缺省用全局配置'},
                },
                required: ['mobile', 'templateCode'],
            },
            response: {default: getResSwaggerSchema()},
        },
    }, async function (request, reply) {
        const {mobile, templateCode, templateParams, signName} = request.reqParams
        const ret = await sendAliMsg(mobile, templateCode, templateParams || {}, signName || smsConfig.signName)
        logger.info(`notice-ipmi短信发送 mobile=${mobile} templateCode=${templateCode}`)
        return ret
    })
}
