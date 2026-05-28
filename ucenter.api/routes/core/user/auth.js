import * as loginService from '../../../services/core/login.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import fs from 'node:fs'
import * as smsService from '../../../services/sms/smsCode.js'
import * as smsLoginService from '../../../services/sms/smsLogin.js'
import * as emailCodeService from '../../../services/email/emailCode.js'
import * as emailLoginService from '../../../services/email/emailLogin.js'

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

    // 通用获取手机验证码
    fastify.post('/sms-code', {
        schema: {
            description: '通用获取手机验证码',
            summary: '通用获取手机验证码',
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
        return await smsService.sendCode(request.reqParams.phone, true, {
            captchaKey: request.reqParams.captchaKey,
            captcha: request.reqParams.captcha
        })
    })

    // 通用获取邮箱验证码
    fastify.post('/email-code', {
        schema: {
            description: '通用获取邮箱验证码',
            summary: '通用获取邮箱验证码',
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
        return await emailCodeService.sendCode(request.reqParams.email, true, {
            captchaKey: request.reqParams.captchaKey,
            captcha: request.reqParams.captcha
        })
    })

    // 注册时获取手机验证码
    fastify.post('/register/phone/verify', {
        schema: {
            description: '注册时获取手机验证码',
            summary: '注册获取手机验证码',
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
        return await smsService.sendCodeByRegister(request.reqParams.phone, '', true, {
            captchaKey: request.reqParams.captchaKey,
            captcha: request.reqParams.captcha
        })
    })

    // 手机号注册
    fastify.post('/register/phone', {
        schema: {
            description: '用户手机号注册',
            summary: '手机号注册',
            body: {
                type: 'object',
                properties: {
                    mobile: {type: 'string', description: '手机号'},
                    smsCode: {type: 'string', description: '短信验证码'},
                    pwd: {type: 'string', description: '密码'},
                    encrypt: {type: 'boolean', description: '密码是否加密'},
                    realName: {type: 'string', description: '真实姓名'},
                    email: {type: 'string', description: '邮箱（可选）'},
                    autoLogin: {type: 'boolean', description: '是否自动登录'}
                },
                required: ['mobile', 'smsCode', 'pwd']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        if (!config.allowRegister) {
            return {code: 7009, msg: '当前系统不允许注册新用户'}
        }
        return await smsLoginService.registerByMobile(request.reqParams)
    })

    // 注册时获取邮箱验证码
    fastify.post('/register/email/verify', {
        schema: {
            description: '注册时获取邮箱验证码',
            summary: '注册获取邮箱验证码',
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
        return await emailCodeService.sendCodeByRegister(request.reqParams.email, '', true, {
            captchaKey: request.reqParams.captchaKey,
            captcha: request.reqParams.captcha
        })
    })

    // 邮箱注册
    fastify.post('/register/email', {
        schema: {
            description: '用户邮箱注册',
            summary: '邮箱注册',
            body: {
                type: 'object',
                properties: {
                    email: {type: 'string', description: '邮箱'},
                    emailCode: {type: 'string', description: '邮箱验证码'},
                    pwd: {type: 'string', description: '密码'},
                    encrypt: {type: 'boolean', description: '密码是否加密'},
                    realName: {type: 'string', description: '真实姓名'},
                    mobile: {type: 'string', description: '手机号（可选）'},
                    autoLogin: {type: 'boolean', description: '是否自动登录'}
                },
                required: ['email', 'emailCode', 'pwd']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})}
            }
        }
    }, async function (request, reply) {
        if (!config.allowRegister) {
            return {code: 7009, msg: '当前系统不允许注册新用户'}
        }
        return await emailLoginService.registerByEmail(request.reqParams)
    })

    // 根据手机短信验证码重置密码
    fastify.post('/reset-pwd/phone', {
        schema: {
            description: '根据手机短信验证码重置密码',
            summary: '手机验证码重置密码',
            body: {
                type: 'object',
                properties: {
                    mobile: {type: 'string', description: '手机号'},
                    smsCode: {type: 'string', description: '短信验证码'},
                    pwd: {type: 'string', description: '新密码'},
                    encrypt: {type: 'boolean', description: '密码是否加密'}
                },
                required: ['mobile', 'smsCode', 'pwd']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await smsLoginService.resetPwdByMobile(request.reqParams)
    })

    // 根据邮箱验证码重置密码
    fastify.post('/reset-pwd/email', {
        schema: {
            description: '根据邮箱验证码重置密码',
            summary: '邮箱验证码重置密码',
            body: {
                type: 'object',
                properties: {
                    email: {type: 'string', description: '邮箱'},
                    emailCode: {type: 'string', description: '邮箱验证码'},
                    pwd: {type: 'string', description: '新密码'},
                    encrypt: {type: 'boolean', description: '密码是否加密'}
                },
                required: ['email', 'emailCode', 'pwd']
            },
            tags: ['user-auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await emailLoginService.resetPwdByEmail(request.reqParams)
    })
}
