/**
 * @fileOverview 桌面小组件相关的接口
 * @author xianyang
 * @module
 */

import * as widgetService from '../../../services/core/widget.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/widget'

export default async function (fastify, opts) {
    const widgetSchema = {$ref: 'fullParamModels#/properties/Widget'}

    fastify.post('/add', {
        schema: {
            description: '添加单个小组件',
            summary: '添加单个小组件',
            body: widgetSchema,
            tags: ['widget'],
            response: {
                default: {...getResSwaggerSchema(widgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await widgetService.addWidget(request.userInfo, request.reqParams)
    })
}
