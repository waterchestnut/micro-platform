/**
 * @fileOverview 用户组管理相关的接口
 * @author xianyang
 * @module
 */

import * as groupService from '../../../services/core/group.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/group/ipmi'

export default async function (fastify, opts) {
    const groupSchema = {$ref: 'fullParamModels#/properties/Group'}

    fastify.post('/list', {
        schema: {
            description: '获取用户组列表',
            summary: '用户组列表',
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
                        }
                    }
                }
            },
            tags: ['group-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(groupSchema)}
            }
        }
    }, async function (request, reply) {
        return await groupService.getGroups(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个用户组',
            summary: '添加单个用户组',
            body: groupSchema,
            tags: ['group-ipmi'],
            response: {
                default: {...getResSwaggerSchema(groupSchema)}
            }
        }
    }, async function (request, reply) {
        return await groupService.addGroup(request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个用户组',
            summary: '修改单个用户组',
            body: groupSchema,
            tags: ['group-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await groupService.updateGroup(request.reqParams.groupCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除用户组',
            summary: '删除用户组',
            body: {
                type: 'object',
                properties: {
                    groupCode: {
                        type: 'string'
                    },
                },
                required: ['groupCode']
            },
            tags: ['group-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await groupService.deleteGroup(request.reqParams.groupCode)
    })
}
