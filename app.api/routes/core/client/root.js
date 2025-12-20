/**
 * @fileOverview 应用相关的接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/client'

export default async function (fastify, opts) {
    const clientSchema = {$ref: 'fullParamModels#/properties/Client'}

    fastify.post('/add', {
        schema: {
            description: '添加单个应用',
            summary: '添加单个应用',
            body: clientSchema,
            tags: ['app'],
            response: {
                default: {...getResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.addClient(request.userInfo, request.reqParams)
    })
}
