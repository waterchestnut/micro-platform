/**
 * @fileOverview 功能权限管理相关的接口
 * @author xianyang
 * @module
 */

import * as modulePrivService from '../../services/core/modulePriv.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/auth/priv'

export default async function (fastify, opts) {
    const modulePrivSchema = {$ref: 'fullParamModels#/properties/ModulePriv'}

    fastify.post('/list', {
        schema: {
            description: '获取权限列表',
            summary: '权限列表',
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
                            withFormat: {type: 'number', description: '是否格式化所属应用、所属模块等字段的名称,1-格式化，0-不格式化'},
                        }
                    }
                }
            },
            tags: ['auth'],
            response: {
                default: {...getPageListResSwaggerSchema({$ref: 'fullParamModels#/properties/ModulePrivFormatted'})}
            }
        }
    }, async function (request, reply) {
        return await modulePrivService.getModulePrivs(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个权限',
            summary: '添加单个权限',
            body: modulePrivSchema,
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema(modulePrivSchema)}
            }
        }
    }, async function (request, reply) {
        return await modulePrivService.addModulePriv(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个权限',
            summary: '修改单个权限',
            body: modulePrivSchema,
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await modulePrivService.updateModulePriv(request.reqParams.modulePrivCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除权限',
            summary: '删除权限',
            body: {
                type: 'object',
                properties: {
                    modulePrivCode: {
                        type: 'string'
                    },
                },
                required: ['modulePrivCode']
            },
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await modulePrivService.deleteModulePriv(request.reqParams.modulePrivCode)
    })
}
