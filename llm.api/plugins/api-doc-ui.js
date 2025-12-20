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

const config = llm.config

export default fp(async (fastify) => {
    if (!config.debug) {
        return
    }

    const tags = [
        {name: 'default', description: '默认分组的API'},
        {name: 'llm', description: 'LLM基础API'},
        {name: 'trans', description: '翻译相关的API'},
    ]

    fastify.register(swagger, {
        swagger: {
            info: {
                title: '大模型服务API',
                description: '微平台大模型服务API端',
                version: '1.1.0'
            },
            externalDocs: {
                url: 'https://swagger.io',
                description: 'swagger官网'
            },
            host: 'localhost:12008',
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
                title: '大模型服务',
                description: '微平台大模型服务端',
                version: '1.1.0'
            },
            servers: [
                {
                    url: 'http://localhost:12008',
                    description: '开发环境'
                },
                {
                    url: 'https://apisix.local/llm',
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