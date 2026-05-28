/**
 * @fileOverview 微信扫码登录的公开接口
 * @author
 * @module
 */

import * as wechatService from '../../../services/wechat/wechatLogin.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

const config = ucenter.config

export const autoPrefix = '/public-bin/wechat'

export default async function (fastify, opts) {

    fastify.get('/auth-url', {
        schema: {
            description: '获取微信扫码登录的授权URL',
            summary: '获取微信登录二维码链接',
            tags: ['public-bin', 'wechat'],
            response: {
                default: {
                    ...getResSwaggerSchema({
                        type: 'object',
                        properties: {
                            authUrl: {type: 'string', description: '微信授权URL'},
                            state: {type: 'string', description: '登录状态标识'},
                            expiresIn: {type: 'number', description: '过期时间(毫秒)'}
                        }
                    })
                }
            }
        }
    }, async function (request, reply) {
        if (!config.wechat.appId) {
            return {code: 7001, msg: '微信登录未配置'}
        }
        return await wechatService.getWechatAuthUrl()
    })

    fastify.get('/login-status', {
        schema: {
            description: '轮询微信扫码登录状态',
            summary: '查询登录状态',
            querystring: {
                type: 'object',
                properties: {
                    state: {type: 'string', description: '状态标识'}
                },
                required: ['state']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {
                    ...getResSwaggerSchema({
                        type: 'object',
                        properties: {
                            status: {type: 'string', description: 'pending|success|failed|expired'},
                            accessToken: {type: 'string', description: '登录成功后返回'},
                            refreshToken: {type: 'string', description: '登录成功后返回'},
                            msg: {type: 'string', description: '失败时的消息'}
                        }
                    })
                }
            }
        }
    }, async function (request, reply) {
        return await wechatService.getWechatLoginStatus(request.reqParams.state)
    })

    fastify.get('/callback', {
        schema: {
            description: '微信OAuth回调处理（微信服务器回调）',
            summary: '微信登录回调',
            querystring: {
                type: 'object',
                properties: {
                    code: {type: 'string', description: '微信授权码'},
                    state: {type: 'string', description: '状态标识'}
                },
                required: ['code', 'state']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        const result = await wechatService.handleWechatCallback(request.reqParams.code, request.reqParams.state)
        if (result.code === 0) {
            reply.type('text/html').send('<html><body style="text-align:center;padding-top:80px;font-size:18px;"><p>操作成功，正在跳转...</p><script>setTimeout(function(){window.close()},1500)</script></body></html>')
            return
        }
        reply.type('text/html').send('<html><body style="text-align:center;padding-top:80px;font-size:18px;"><p style="color:red;">操作失败：' + (result.msg || '未知错误') + '</p></body></html>')
    })

    fastify.get('/config', {
        schema: {
            description: '获取微信登录相关配置',
            summary: '获取微信配置',
            tags: ['public-bin', 'wechat'],
            response: {
                default: {
                    ...getResSwaggerSchema({
                        type: 'object',
                        properties: {
                            enabled: {type: 'boolean', description: '微信登录是否已配置启用'},
                            appId: {type: 'string', description: '微信AppID(脱敏)'},
                            allowRegister: {type: 'boolean', description: '是否允许用户注册'}
                        }
                    })
                }
            }
        }
    }, async function (request, reply) {
        const enabled = !!(config.wechat.appId && config.wechat.appSecret)
        const maskedAppId = config.wechat.appId ? config.wechat.appId.substring(0, 6) + '****' : ''
        return {code: 0, data: {enabled, appId: maskedAppId, allowRegister: config.allowRegister}}
    })

    fastify.post('/mp/login', {
        schema: {
            description: '微信小程序登录',
            summary: '小程序登录',
            body: {
                type: 'object',
                properties: {
                    code: {type: 'string', description: '小程序wx.login()返回的code'}
                },
                required: ['code']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await wechatService.miniProgramLogin(request.reqParams.code)
    })

    fastify.post('/register', {
        schema: {
            description: '微信扫码登录后注册新用户',
            summary: '微信注册新用户',
            body: {
                type: 'object',
                properties: {
                    state: {type: 'string', description: '扫码state'}
                },
                required: ['state']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await wechatService.registerWechatUser(request.reqParams.state)
    })

    fastify.post('/bind-login', {
        schema: {
            description: '微信扫码登录后绑定已有账号',
            summary: '微信绑定已有账号',
            body: {
                type: 'object',
                properties: {
                    state: {type: 'string', description: '扫码state'},
                    loginType: {type: 'string', enum: ['account', 'phone', 'email'], description: '登录方式'},
                    username: {type: 'string', description: '用户名(account方式)'},
                    pwd: {type: 'string', description: '密码(account方式)'},
                    captchaKey: {type: 'string', description: '图形验证码key(account方式)'},
                    captcha: {type: 'string', description: '图形验证码(account方式)'},
                    phone: {type: 'string', description: '手机号(phone方式)'},
                    email: {type: 'string', description: '邮箱(email方式)'},
                    verification: {type: 'string', description: '验证码(phone/email方式)'}
                },
                required: ['state']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        const p = request.reqParams
        return await wechatService.bindWechatWithLogin(p.state, p.loginType || 'account', {
            username: p.username, pwd: p.pwd, captchaKey: p.captchaKey, captcha: p.captcha,
            phone: p.phone, email: p.email, verification: p.verification
        })
    })

    fastify.post('/mp/register', {
        schema: {
            description: '小程序登录后注册新用户',
            summary: '小程序注册新用户',
            body: {
                type: 'object',
                properties: {
                    bindToken: {type: 'string', description: '小程序绑定令牌'}
                },
                required: ['bindToken']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await wechatService.registerMpUser(request.reqParams.bindToken)
    })

    fastify.post('/mp/bind-login', {
        schema: {
            description: '小程序登录后绑定已有账号',
            summary: '小程序绑定已有账号',
            body: {
                type: 'object',
                properties: {
                    bindToken: {type: 'string', description: '小程序绑定令牌'},
                    loginType: {type: 'string', enum: ['account', 'phone', 'email'], description: '登录方式'},
                    username: {type: 'string', description: '用户名(account方式)'},
                    pwd: {type: 'string', description: '密码(account方式)'},
                    captchaKey: {type: 'string', description: '图形验证码key(account方式)'},
                    captcha: {type: 'string', description: '图形验证码(account方式)'},
                    phone: {type: 'string', description: '手机号(phone方式)'},
                    email: {type: 'string', description: '邮箱(email方式)'},
                    verification: {type: 'string', description: '验证码(phone/email方式)'}
                },
                required: ['bindToken']
            },
            tags: ['public-bin', 'wechat'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        const p = request.reqParams
        return await wechatService.bindMpWithLogin(p.bindToken, p.loginType || 'account', {
            username: p.username, pwd: p.pwd, captchaKey: p.captchaKey, captcha: p.captcha,
            phone: p.phone, email: p.email, verification: p.verification
        })
    })
}