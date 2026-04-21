/**
 * @fileOverview 桌面小组件相关的开放接口
 * @author xianyang
 * @module
 */

import * as widgetService from '../../../services/core/widget.js'
import {
    getListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/public-bin/widget'

export default async function (fastify, opts) {
    const widgetSchema = {$ref: 'fullParamModels#/properties/Widget'}

    fastify.get('/show/pc', {
        schema: {
            description: '获取PC端展示的小组件列表',
            summary: 'PC端小组件列表',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'}
                }
            },
            tags: ['public-bin'],
            response: {
                default: {...getListResSwaggerSchema(widgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await widgetService.getPCShowWidgets(request.reqParams.clientCode)
    })

    fastify.get('/show/mini', {
        schema: {
            description: '获取小程序端展示的小组件列表',
            summary: '小程序端小组件列表',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'}
                }
            },
            tags: ['public-bin'],
            response: {
                default: {...getListResSwaggerSchema(widgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await widgetService.getMiniShowWidgets(request.reqParams.clientCode)
    })
}