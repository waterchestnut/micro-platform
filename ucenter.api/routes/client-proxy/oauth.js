import {getDefaultResponseSchema} from '../../plugins/format-reply.js'
import {fetchToken, generateStateCode, getStateCode} from '../../services/client-proxy/index.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientProxyConfig = config.clientProxy

export const autoPrefix = '/client-proxy/oauth'

export default async function (fastify, opts) {
    fastify.get('/callback', {
        schema: {
            description: 'OAuth登录回调接口',
            summary: 'OAuth登录回调接口',
            querystring: {
                type: 'object',
                properties: {
                    retUrl: {type: 'string'},
                    state: {type: 'string'},
                    authCode: {type: 'string'},
                    error: {type: 'number'},
                    msg: {type: 'string'}
                },
                required: []
            },
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema(),
                }
            }
        }
    }, async function (request, reply) {
        let stateCode = await getStateCode(request.query.state)
        if (!tools.isExist(stateCode) || stateCode !== request.query.state) {
            /*state过期，重新跳转*/
            let retUrl = request.query.retUrl || '/'
            reply.redirect(retUrl)
            reply.end()
            return {}
        }

        let tokenRetUrl = (request.headers.protocol || request.protocol) + '://' + request.headers.host.replace(/:(80|443)$/, '') + clientProxyConfig.authBackUrl + '?retUrl=' + encodeURIComponent(request.query.retUrl)
        let token = await fetchToken(request.query.authCode, tokenRetUrl, request.clientConfig)

        reply.cookie('param-accessToken', token.accessToken)
        reply.cookie('param-refreshToken', token.refreshToken)

        let retUrl = request.query.retUrl || '/'
        reply.redirect(retUrl)

        return {}
    })

    fastify.get('/sign-in', {
        schema: {
            description: '统一登录注入',
            summary: '统一登录注入',
            querystring: {
                type: 'object',
                properties: {
                    accessToken: {type: 'string'},
                    refreshToken: {type: 'string'}
                },
                required: ['accessToken']
            },
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema(),
                }
            }
        }
    }, async function (request, reply) {
        reply.cookie('param-accessToken', request.reqParams.accessToken)
        reply.cookie('param-refreshToken', request.reqParams.refreshToken)
    })

    fastify.get('/sign-out', {
        schema: {
            description: '统一登录注销',
            summary: '统一登录注销',
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema(),
                }
            }
        }
    }, async function (request, reply) {
        reply.clearCookie('param-accessToken')
        reply.clearCookie('param-refreshToken')
    })

    fastify.get('/authorize', {
        schema: {
            description: '跳转到用户中心登录',
            summary: '跳转到用户中心登录',
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema(),
                }
            }
        }
    }, async function (request, reply) {
        let state = await generateStateCode()
        let retUrl = (request.headers.protocol || request.protocol) + '://' + request.headers.host.replace(/:(80|443)$/, '') + clientProxyConfig.authBackUrl + '?retUrl=' + encodeURIComponent(request.headers['request-uri'] || request.originalUrl)

        let loginUrl = request.clientConfig.baseUrl + clientProxyConfig.authUrl
            + '?clientCode=' + request.clientConfig.clientCode
            + '&state=' + state
            + '&schemaCode=' + (request.schemaCode || '')
            + '&version=' + request.clientConfig.version
            + '&retUrl=' + encodeURIComponent(retUrl)
        reply.redirect(loginUrl)
    })

    fastify.get('/logout', {
        schema: {
            description: '跳转到用户中心注销',
            summary: '跳转到用户中心注销',
            querystring: {
                type: 'object',
                properties: {
                    loginType: {type: 'string'}
                }
            },
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema(),
                }
            }
        }
    }, async function (request, reply) {
        let state = await generateStateCode()
        let retUrl = (request.headers.protocol || request.protocol) + '://' + request.headers.host.replace(/:(80|443)$/, '') + clientProxyConfig.authBackUrl + '?retUrl=' + encodeURIComponent(request.reqParams.retUrl || '/')

        let logoutUrl = request.clientConfig.baseUrl + clientProxyConfig.authLogoutUrl + '?ltype=logout&clientCode=' + request.clientConfig.clientCode
            + '&state=' + state
            + '&schema=' + (request.schemaCode || '')
            + '&loginType=' + (request.reqParams.loginType || '')
            + '&version=' + request.clientConfig.version
            + '&retUrl=' + encodeURIComponent(retUrl)
        reply.redirect(logoutUrl)
    })
}
