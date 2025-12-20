/**
 * @fileOverview 应用下的模块管理相关的接口
 * @author xianyang
 * @module
 */

import * as clientModuleService from '../../../services/core/clientModule.js'
import {
    getListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/client/ipmi-module'

export function registerClientModuleRoutes(fastify, opts, tags = ['client-ipmi']) {
    const moduleSchema = {
        type: 'object',
        properties: {
            moduleCode: {
                type: 'string'
            },
            moduleName: {
                type: 'string'
            },
        },
        required: ['moduleCode', 'moduleName'],
    }

    fastify.get('/list', {
        schema: {
            description: '获取应用的模块列表',
            summary: '模块列表',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            tags,
            response: {
                default: {...getListResSwaggerSchema(moduleSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientModuleService.getClientModules(request.reqParams.clientCode)
    })

    fastify.post('/add', {
        schema: {
            description: '添加应用模块',
            summary: '添加应用模块',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: moduleSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema(moduleSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientModuleService.addClientModule(request.userInfo, request.reqParams.clientCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除应用模块',
            summary: '删除应用模块',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: {
                type: 'object',
                properties: {
                    moduleCode: {
                        type: 'string'
                    },
                },
                required: ['moduleCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientModuleService.deleteClientModule(request.userInfo, request.reqParams.clientCode, request.reqParams.moduleCode)
    })
}

export default async function (fastify, opts) {
    registerClientModuleRoutes(fastify, opts)
}
