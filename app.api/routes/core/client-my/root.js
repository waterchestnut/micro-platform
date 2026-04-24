/**
 * @fileOverview 我的应用相关的接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'
import {registerClientCommonRoutes} from '../client/ipmi.js'

export const autoPrefix = '/core/client-my'

export default async function (fastify, opts) {
    const clientSchema = {$ref: 'fullParamModels#/properties/Client'}

    fastify.post('/list', {
        schema: {
            description: '获取我创建的应用列表',
            summary: '应用列表',
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
            tags: ['client-my'],
            response: {
                default: {...getPageListResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.getClients({
            ...request.reqParams.filter,
            operatorUserCode: request.userInfo.userCode
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.get('/list/stat-by-tag', {
        schema: {
            description: '按标签统计我创建的应用数量',
            summary: '按标签统计我的应用数量',
            tags: ['client-my'],
            response: {
                default: {
                    ...getListResSwaggerSchema({
                        type: 'object',
                        properties: {
                            key: {type: 'string'},
                            value: {type: 'string'},
                            count: {type: 'number'}
                        }
                    })
                }
            }
        }
    }, async function (request, reply) {
        return await clientService.statClientByTag(request.userInfo.userCode)
    })

    registerClientCommonRoutes(fastify, opts, ['client-my'])
}
