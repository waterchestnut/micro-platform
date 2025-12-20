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

const config = doc.config

export default fp(async (fastify) => {
    if (!config.debug) {
        return
    }

    fastify.register(swagger, {
        swagger: {
            info: {
                title: '文件服务API',
                description: '微平台文件服务API端',
                version: '1.1.0'
            },
            externalDocs: {
                url: 'https://swagger.io',
                description: 'swagger官网'
            },
            host: 'localhost:12004',
            schemes: ['http', 'https'],
            consumes: ['application/json'],
            produces: ['application/json'],
            tags: [
                {name: 'default', description: '默认分组的API'},
                {name: 'file', description: '文件基础API'},
            ],
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
                title: '文件服务',
                description: '微平台文件服务端',
                version: '1.1.0'
            },
            servers: [
                {
                    url: 'http://localhost:12004',
                    description: '开发环境'
                },
                {
                    url: 'https://apisix.local/doc',
                    description: '测试环境'
                }
            ],
            tags: [
                {name: 'default', description: '默认分组的API'},
                {name: 'file', description: '文件基础API'},
            ],
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