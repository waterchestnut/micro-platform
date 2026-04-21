/**
 * @fileOverview 我的小组件相关的接口
 * @author xianyang
 * @module
 */

import * as widgetService from '../../../services/core/widget.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {registerWidgetCommonRoutes} from '../widget/ipmi.js'

export const autoPrefix = '/core/widget-my'

export default async function (fastify, opts) {
    const widgetSchema = {$ref: 'fullParamModels#/properties/Widget'}

    fastify.post('/list', {
        schema: {
            description: '获取我创建的小组件列表',
            summary: '小组件列表',
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
            tags: ['widget-my'],
            response: {
                default: {...getPageListResSwaggerSchema(widgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await widgetService.getWidgets({
            ...request.reqParams.filter,
            operatorUserCode: request.userInfo.userCode
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerWidgetCommonRoutes(fastify, opts, ['widget-my'])
}
