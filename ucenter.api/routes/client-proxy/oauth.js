import {getDefaultResponseSchema} from '../../plugins/format-reply.js'
import {fetchToken, generateStateCode, getStateCode} from '../../services/client-proxy/index.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientProxyConfig = config.clientProxy

export const autoPrefix = '/client-proxy/oauth'

// 登录 cookie 写父域共享域(跨子系统跳转免 URL 传 token, 见 system.config cookieDomain)
// 未显式配置时按请求 host 推导末两段父域(多环境自适应: *.xxzx.paretop.net / *-online.foleac.net 等)
function deriveCookieDomain(request) {
    if (config.cookieDomain) return config.cookieDomain
    let host = String((request && request.headers && request.headers.host) || '')
    host = host.split(':')[0]
    const parts = host.split('.')
    if (parts.length < 3 || !/^[a-zA-Z]{2,}$/.test(parts[parts.length - 1])) return ''
    return '.' + parts.slice(-2).join('.')
}
const cookieOpts = (request) => {
    const domain = deriveCookieDomain(request)
    return domain ? {domain, path: '/'} : {path: '/'}
}

/**
 * sign-out 多候选清除域: 显式/末两段推导域 + 再上一级(剥首段) + host-only 全量幂等清——
 * 历史数据可能由不同规则写入(部署 env 显式域 vs 推导域), 删除 Set-Cookie 要求 Domain
 * 精确一致, 宽清兜住所有漂移(清不存在的域无害)
 */
function signOutCookieVariants(request) {
    const variants = []
    const seen = new Set()
    const push = (opts) => {
        const key = `${opts.domain || ''}|/`
        if (!seen.has(key)) {
            seen.add(key)
            variants.push(opts)
        }
    }
    push(cookieOpts(request))
    const host = String((request && request.headers && request.headers.host) || '').split(':')[0]
    const parts = host.split('.')
    if (parts.length >= 4) {
        push({domain: '.' + parts.slice(1).join('.'), path: '/'})
    }
    push({path: '/'})
    return variants
}

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
            return reply.redirect(retUrl)
        }

        let tokenRetUrl = (request.headers.protocol || request.protocol) + '://' + request.headers.host.replace(/:(80|443)$/, '') + clientProxyConfig.authBackUrl + '?retUrl=' + encodeURIComponent(request.query.retUrl)
        let token = await fetchToken(request.query.authCode, tokenRetUrl, request.clientConfig)

        reply.cookie('param-accessToken', token.accessToken, cookieOpts(request))
        reply.cookie('param-refreshToken', token.refreshToken, cookieOpts(request))

        let retUrl = request.query.retUrl || '/'
        return reply.redirect(retUrl)
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
        reply.cookie('param-accessToken', request.reqParams.accessToken, cookieOpts(request))
        if (request.reqParams.refreshToken) {
            reply.cookie('param-refreshToken', request.reqParams.refreshToken, cookieOpts(request))
        }
    })

    /**
     * 统一登录注入 POST 变体(直登链路父域刷新通道): token 走 body 不入访问日志,
     * 用户中心账密/微信直登成功后调用本端点刷新父域(替代已废弃的前端 promote 提升)
     */
    fastify.post('/grant-cookie', {
        schema: {
            description: '登录成功后刷新父域/本域登录 cookie(token 走 body)',
            summary: '统一登录 cookie 注入(POST)',
            body: {
                type: 'object',
                properties: {
                    accessToken: {type: 'string'},
                    refreshToken: {type: 'string'}
                },
                required: ['accessToken']
            },
            tags: ['client-proxy'],
            response: {}
        }
    }, async function (request, reply) {
        const {accessToken, refreshToken} = request.body || {}
        if (!accessToken) {
            return {statusCode: 400, code: -1, message: '缺少 accessToken'}
        }
        reply.cookie('param-accessToken', accessToken, cookieOpts(request))
        if (refreshToken) {
            reply.cookie('param-refreshToken', refreshToken, cookieOpts(request))
        }
        return {statusCode: 200, code: 0, message: ''}
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
        for (const opts of signOutCookieVariants(request)) {
            reply.clearCookie('param-accessToken', opts)
            reply.clearCookie('param-refreshToken', opts)
        }
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
