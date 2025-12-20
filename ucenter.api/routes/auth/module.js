/**
 * @fileOverview 功能模块管理相关的接口
 * @author xianyang
 * @module
 */

import * as moduleService from '../../services/core/module.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/auth/module'

export default async function (fastify, opts) {
    const moduleSchema = {$ref: 'fullParamModels#/properties/Module'}

    fastify.post('/list', {
        schema: {
            description: '获取模块列表',
            summary: '模块列表',
            body: {
                type: 'object',
                properties: {
                    filter: {type: 'object'},
                    pageIndex: {type: 'number'},
                    pageSize: {type: 'number'},
                    options: {
                        type: 'object',
                        properties: {
                            total: {type: 'number', description: '已知总数'},
                            sort: {
                                type: 'object',
                                description: '1:正序，-1：倒序',
                                additionalProperties: {type: 'number', enum: [1, -1]}
                            },
                            withFormat: {type: 'number', description: '是否格式化所属应用等字段的名称,1-格式化，0-不格式化'},
                        }
                    }
                }
            },
            tags: ['auth'],
            response: {
                default: {...getPageListResSwaggerSchema({$ref: 'fullParamModels#/properties/ModuleFormatted'})}
            }
        }
    }, async function (request, reply) {
        return await moduleService.getModules(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个模块',
            summary: '添加单个模块',
            body: moduleSchema,
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema(moduleSchema)}
            }
        }
    }, async function (request, reply) {
        return await moduleService.addModule(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个模块',
            summary: '修改单个模块',
            body: moduleSchema,
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await moduleService.updateModule(request.reqParams.moduleCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除模块',
            summary: '删除模块',
            body: {
                type: 'object',
                properties: {
                    moduleCode: {
                        type: 'string'
                    },
                },
                required: ['moduleCode']
            },
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await moduleService.deleteModule(request.reqParams.moduleCode)
    })
}
