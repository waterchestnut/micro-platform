/**
 * @fileOverview
 * @author xianyang 2024/5/27
 * @module
 */

import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import fastifyApiReference from '@scalar/fastify-api-reference'
import {getAllParamModels} from '../daos/swaggerSchema/mongooseHandler.js'

const config = ucenter.config

export default fp(async (fastify) => {
    if (!config.debug) {
        return
    }

    const tags = [
        {name: 'default', description: '默认分组的API'},
        {name: 'user', description: '用户基础API'},
        {name: 'user-auth', description: '用户登录授权相关的API'},
        {name: 'user-ipmi', description: '用户管理相关的API'},
        {name: 'code', description: '验证码相关的API'},
        {name: 'public-bin', description: '公开调用的api'},
        {name: 'local-bin', description: '局域网调用的api'},
        {name: 'cgi-bin', description: '第三方应用调用的api'},
        {name: 'auth', description: '权限验证、管理相关的api'},
        {name: 'oauth', description: 'oauth相关的api'},
        {name: 'client-proxy', description: 'oauth授权客户端代理'},
        {name: 'client-ipmi', description: '第三方应用管理相关的API'},
        {name: 'group-ipmi', description: '用户组管理相关的API'},
        {name: 'org-ipmi', description: '机构管理相关的API'},
        {name: 'department-ipmi', description: '部门管理相关的API'},
        {name: 'job-ipmi', description: '职位管理相关的API'},
        {name: 'region-ipmi', description: '地区管理相关的API'},
    ]

    fastify.register(swagger, {
        swagger: {
            info: {
                title: '用户&授权API',
                description: '微平台用户&授权API端',
                version: '1.1.0'
            },
            externalDocs: {
                url: 'https://swagger.io',
                description: 'swagger官网'
            },
            host: 'localhost:12001',
            schemes: ['http', 'https'],
            consumes: ['application/json'],
            produces: ['application/json'],
            tags,
            definitions: getAllParamModels(),
            securityDefinitions: {
                accessToken: {
                    type: 'apiKey',
                    name: 'accessToken',
                    in: 'header'
                }
            }
        },
        openapi: {
            openapi: '3.0.1',
            info: {
                title: '用户&授权API',
                description: '微平台用户&授权API端',
                version: '1.1.0'
            },
            servers: [
                {
                    url: 'http://localhost:12001',
                    description: '开发环境'
                },
                {
                    url: 'https://apisix.local/ucenter',
                    description: '测试环境'
                }
            ],
            tags,
            components: {
                securitySchemes: {
                    accessToken: {
                        type: 'apiKey',
                        name: 'accessToken',
                        in: 'header'
                    }
                },
                schemas: getAllParamModels()
            },
            externalDocs: {
                url: 'https://swagger.io',
                description: 'swagger官网'
            },
        },
        refResolver: {
            buildLocalReference(json, baseUri, fragment, i) {
                return json.$id || `def-${i}`
            }
        }
    })

    fastify.register(swaggerUI, {
        routePrefix: '/documentation',
        uiConfig: {
            docExpansion: 'full',
            deepLinking: false
        },
        uiHooks: {
            onRequest: function (request, reply, next) {
                next()
            },
            preHandler: function (request, reply, next) {
                next()
            }
        },
        staticCSP: true,
        transformStaticCSP: (header) => header,
        transformSpecification: (swaggerObject, request, reply) => {
            return swaggerObject
        },
        transformSpecificationClone: true
    })

    fastify.register(fastifyApiReference, {
        routePrefix: '/reference',
        configuration: {
            spec: {
                content: () => {
                    let json = {...fastify.swagger()}
                    delete json.tags
                    return json
                },
            },
        },
    })
})