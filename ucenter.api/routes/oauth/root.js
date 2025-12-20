import {getDefaultResponseSchema} from '../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../daos/swaggerSchema/responseHandler.js'
import {agreeAuthorize} from '../../services/oauth/code.js'
import {setUrlParams} from '../../tools/queryString.js'
import {saveStatisticSimple} from "../../services/statistic/index.js"

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const defaultSchema = config.schema.default

export default async function (fastify, opts) {
    fastify.get('/authorize', {
        schema: {
            description: '客户端请求授权',
            summary: '客户端请求授权',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    state: {type: 'string'},
                    retUrl: {type: 'string'},
                },
                required: ['clientCode', 'state', 'retUrl']
            },
            tags: ['oauth'],
            response: {
                default: {
                    ...getDefaultResponseSchema({
                        authCode: {type: 'string', description: '同意授权码'},
                        state: {type: 'string', description: '第三方应用传递的state'}
                    })
                }
            }
        }
    }, async function (request, reply) {
        try {
            if (!request.userInfo) {
                let retUrl = request.originalUrl
                let loginUrl = '/user/login?retUrl=' + encodeURIComponent(retUrl)
                let version = request.reqParams.version
                let retStart = retUrl.indexOf('/oauth/authorize')
                if (retStart === 0 && version) {
                    loginUrl = '/user/login?retUrl=' + encodeURIComponent(retUrl) + '&version=' + version + '&schemaCode=' + (request.schemaCode || defaultSchema)
                }

                reply.redirect(loginUrl)
                return
            }

            /*不需要用户确认，登录后直接回调*/
            let authCodeInfo = await agreeAuthorize(request.reqParams, request.userInfo)
            reply.redirect(setUrlParams(request.reqParams.retUrl, {
                authCode: authCodeInfo.authCode,
                state: request.reqParams.state
            }))
        } catch (err) {
            let toUrl = request.reqParams.retUrl || '/error'
            reply.redirect(setUrlParams(toUrl, {
                error: err.code || -1,
                msg: err.message || err.msg
            }))
        }
    })

    fastify.get('/logout', {
        schema: {
            description: '客户端请求统一退出登录',
            summary: '客户端请求统一退出登录',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    state: {type: 'string'},
                    retUrl: {type: 'string'},
                },
                required: ['clientCode', 'state', 'retUrl']
            },
            tags: ['oauth'],
            response: {
                default: {
                    ...getDefaultResponseSchema({
                        authCode: {type: 'string', description: '同意授权码'},
                        state: {type: 'string', description: '第三方应用传递的state'}
                    })
                }
            }
        }
    }, async function (request, reply) {
        try {
            saveStatisticSimple('web-logout', 'PC端退出登录', request)

            let retUrl = request.originalUrl.replace('/oauth/logout', '/oauth/authorize')
            let lflag = tools.getUUID() // 调用统一退出的标识
            let loginUrl = '/user/login?ltype=logout&version=' + request.reqParams.version + '&loginType=' + request.reqParams.loginType + '&schemaCode=' + (request.schemaCode || defaultSchema) + '&lflag=' + lflag + '&retUrl=' + encodeURIComponent(retUrl)
            reply.redirect(loginUrl)
        } catch (err) {
            let toUrl = request.reqParams.retUrl || '/error'
            reply.redirect(setUrlParams(toUrl, {
                error: err.code || -1,
                msg: err.message || err.msg
            }))
        }
    })
}
