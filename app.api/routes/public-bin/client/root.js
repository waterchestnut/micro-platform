/**
 * @fileOverview 应用相关的开放接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/public-bin/client'

export default async function (fastify, opts) {
    const clientSchema = {$ref: 'fullParamModels#/properties/Client'}

    fastify.get('/show/pc', {
        schema: {
            description: '获取PC端呈现的应用列表',
            summary: 'PC端应用列表',
            tags: ['public-bin'],
            response: {
                default: {...getListResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.getPCShowClients()
    })

    fastify.get('/show/mini', {
        schema: {
            description: '获取小程序端呈现的应用列表',
            summary: '小程序端应用列表',
            tags: ['public-bin'],
            response: {
                default: {...getListResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.getMiniShowClients()
    })
}
