/**
 * @fileOverview 资源管理相关的接口
 * @author xianyang
 * @module
 */

import * as resInfoService from '../../../services/core/resInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/res-info/ipmi'

const resInfoSchema = {$ref: 'fullParamModels#/properties/ResInfo'}

export function registerCommonRoutes(fastify, opts, tags = ['res-ipmi']) {
    fastify.get('/detail', {
        schema: {
            description: '获取资源全部信息结构',
            summary: '获取资源的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    resCode: {type: 'string'}
                },
                required: ['resCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(resInfoSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await resInfoService.getResInfo(request.reqParams.resCode)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个资源',
            summary: '修改单个资源',
            body: resInfoSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.updateResInfo(request.userInfo, request.reqParams.resCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除资源',
            summary: '删除资源',
            body: {
                type: 'object',
                properties: {
                    resCode: {
                        type: 'string'
                    },
                },
                required: ['resCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.deleteResInfo(request.userInfo, request.reqParams.resCode)
    })
}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取资源列表',
            summary: '资源列表',
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
            tags: ['res-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(resInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.getResInfos(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts)
}