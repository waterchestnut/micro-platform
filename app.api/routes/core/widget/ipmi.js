/**
 * @fileOverview 桌面小组件管理相关的接口
 * @author xianyang
 * @module
 */

import * as widgetService from '../../../services/core/widget.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

const widgetSchema = {$ref: 'fullParamModels#/properties/Widget'}

export const autoPrefix = '/core/widget/ipmi'

export function registerWidgetCommonRoutes(fastify, opts, tags = ['widget-ipmi']) {
    fastify.get('/detail', {
        schema: {
            description: '获取小组件全部信息结构',
            summary: '获取小组件的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    widgetCode: {type: 'string'}
                },
                required: ['widgetCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(widgetSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await widgetService.getWidgetByCode(request.reqParams.widgetCode)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个小组件',
            summary: '修改单个小组件',
            body: widgetSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await widgetService.updateWidget(request.userInfo, request.reqParams.widgetCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除小组件',
            summary: '删除小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCode: {
                        type: 'string'
                    },
                },
                required: ['widgetCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await widgetService.deleteWidget(request.userInfo, request.reqParams.widgetCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用小组件',
            summary: '启用小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCode: {
                        type: 'string'
                    },
                },
                required: ['widgetCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await widgetService.enableWidget(request.userInfo, request.reqParams.widgetCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用小组件',
            summary: '禁用小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCode: {
                        type: 'string'
                    },
                },
                required: ['widgetCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await widgetService.disableWidget(request.userInfo, request.reqParams.widgetCode)
    })
}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取小组件列表',
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
            tags: ['widget-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(widgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await widgetService.getWidgets(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerWidgetCommonRoutes(fastify, opts)
}
