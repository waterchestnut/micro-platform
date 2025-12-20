/**
 * @fileOverview 地区管理相关的接口
 * @author xianyang
 * @module
 */

import * as regionService from '../../../services/core/region.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/region/ipmi'

export default async function (fastify, opts) {
    const regionSchema = {$ref: 'fullParamModels#/properties/Region'}

    fastify.post('/list', {
        schema: {
            description: '获取地区列表',
            summary: '地区列表',
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
            tags: ['region-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(regionSchema)}
            }
        }
    }, async function (request, reply) {
        return await regionService.getRegions(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个地区',
            summary: '添加单个地区',
            body: regionSchema,
            tags: ['region-ipmi'],
            response: {
                default: {...getResSwaggerSchema(regionSchema)}
            }
        }
    }, async function (request, reply) {
        return await regionService.addRegion(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个地区',
            summary: '修改单个地区',
            body: regionSchema,
            tags: ['region-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await regionService.updateRegion(request.reqParams.regionCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除地区',
            summary: '删除地区',
            body: {
                type: 'object',
                properties: {
                    regionCode: {
                        type: 'string'
                    },
                },
                required: ['regionCode']
            },
            tags: ['region-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await regionService.deleteRegion(request.reqParams.regionCode)
    })
}
