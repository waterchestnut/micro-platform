/**
 * @fileOverview 我的应用相关的接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
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

    registerClientCommonRoutes(fastify, opts, ['client-my'])
}
