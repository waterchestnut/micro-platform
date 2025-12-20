import * as loginService from '../../../services/core/login.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import fs from 'node:fs'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

export const autoPrefix = '/core/user/auth'

export default async function (fastify, opts) {
    fastify.get('/rsa-public-key', {
        schema: {
            description: '获取密码加密的公钥',
            summary: '获取加密的公钥',
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({type: 'string', description: '公钥'})}
            }
        }
    }, async function (request, reply) {
        return {
            code: 0,
            data: fs.readFileSync(ucenter.baseDir + 'conf/public_key.pem', {encoding: 'utf8'})
        }
    })

    fastify.post('/login', {
        schema: {
            description: '用户名、密码方式登录',
            summary: '用户登录',
            body: {
                type: 'object',
                properties: {
                    username: {type: 'string'},
                    pwd: {type: 'string'},
                    captchaKey: {type: 'string'},
                    captcha: {type: 'string'}
                },
                required: ['username', 'pwd', 'captchaKey', 'captcha']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await loginService.login(request.reqParams.username, request.reqParams.pwd, request.reqParams.captchaKey, request.reqParams.captcha)
    })

    fastify.post('/phone/verify', {
        schema: {
            description: '手机号获取登录验证码',
            summary: '获取登录验证码',
            body: {
                type: 'object',
                properties: {
                    phone: {type: 'string'},
                    captchaKey: {type: 'string'},
                    captcha: {type: 'string'}
                },
                required: ['phone', 'captchaKey', 'captcha']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await loginService.phoneLoginVerify(request.reqParams.phone, request.reqParams.captchaKey, request.reqParams.captcha)
    })

    //手机，验证码快捷登录
    fastify.post('/phone/login', {
        schema: {
            description: '手机号，验证码方式登录',
            summary: '手机快捷登录',
            body: {
                type: 'object',
                properties: {
                    phone: {type: 'string'},
                    verification: {type: 'string'}
                },
                required: ['phone', 'verification']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await loginService.phoneLogin(request.reqParams.phone, request.reqParams.verification)
    })

    fastify.post('/email/verify', {
        schema: {
            description: '邮箱获取登录验证码',
            summary: '获取登录验证码',
            body: {
                type: 'object',
                properties: {
                    email: {type: 'string'},
                    captchaKey: {type: 'string'},
                    captcha: {type: 'string'}
                },
                required: ['email', 'captchaKey', 'captcha']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await loginService.emailLoginVerify(request.reqParams.email, request.reqParams.captchaKey, request.reqParams.captcha)
    })

    //邮箱，验证码快捷登录
    fastify.post('/email/login', {
        schema: {
            description: '邮箱，验证码方式登录',
            summary: '邮箱快捷登录',
            body: {
                type: 'object',
                properties: {
                    email: {type: 'string'},
                    verification: {type: 'string'}
                },
                required: ['email', 'verification']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await loginService.emailLogin(request.reqParams.email, request.reqParams.verification)
    })

    fastify.post('/token/refresh', {
        schema: {
            description: '根据Refresh Token重新获取一套accessToken和refreshToken',
            summary: '刷新token',
            body: {
                type: 'object',
                properties: {
                    refreshToken: {type: 'string'}
                },
                required: ['refreshToken']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        return await loginService.execRefreshToken(request.reqParams.refreshToken)
    })
}
