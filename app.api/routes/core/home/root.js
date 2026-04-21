/**
 * @fileOverview 用户首页相关的接口
 * @author xianyang
 * @module
 */

import * as homeClientService from '../../../services/core/homeClient.js'
import * as homeWidgetService from '../../../services/core/homeWidget.js'
import {getListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/home'

const homeClientSchema = {$ref: 'fullParamModels#/properties/HomeClient'}
const homeWidgetSchema = {$ref: 'fullParamModels#/properties/HomeWidget'}

export default async function (fastify, opts) {
    fastify.get('/client/list', {
        schema: {
            description: '获取用户首页应用列表',
            summary: '首页应用列表',
            querystring: {
                type: 'object',
                properties: {
                    homeEndpoint: {type: 'string'}
                }
            },
            tags: ['home'],
            response: {
                default: {...getListResSwaggerSchema(homeClientSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeClientService.getHomeClients(request.userInfo.userCode, request.reqParams.homeEndpoint)
    })

    fastify.post('/client/add', {
        schema: {
            description: '添加应用到用户首页',
            summary: '添加首页应用',
            body: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    homeEndpoint: {type: 'string'},
                    order: {type: 'number'}
                },
                required: ['clientCode']
            },
            tags: ['home'],
            response: {
                default: {...getResSwaggerSchema(homeClientSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeClientService.addHomeClient(request.userInfo, request.reqParams.clientCode, request.reqParams.homeEndpoint, request.reqParams.order)
    })

    fastify.post('/client/remove', {
        schema: {
            description: '从用户首页移除应用',
            summary: '移除首页应用',
            body: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    homeEndpoint: {type: 'string'},
                    order: {type: 'number'}
                },
                required: ['clientCode']
            },
            tags: ['home'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await homeClientService.removeHomeClient(request.userInfo, request.reqParams.clientCode, request.reqParams.homeEndpoint, request.reqParams.order)
    })

    fastify.post('/client/batch/save', {
        schema: {
            description: '批量保存用户首页应用',
            summary: '批量保存首页应用',
            body: {
                type: 'object',
                properties: {
                    clientCodes: {type: 'array', items: {type: 'string'}},
                    homeEndpoint: {type: 'string'}
                },
                required: ['clientCodes']
            },
            tags: ['home'],
            response: {
                default: {...getListResSwaggerSchema(homeClientSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeClientService.saveHomeClients(request.userInfo, request.reqParams.clientCodes, request.reqParams.homeEndpoint)
    })

    fastify.get('/widget/list', {
        schema: {
            description: '获取用户首页小组件列表',
            summary: '首页小组件列表',
            querystring: {
                type: 'object',
                properties: {
                    homeEndpoint: {type: 'string'}
                }
            },
            tags: ['home'],
            response: {
                default: {...getListResSwaggerSchema(homeWidgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeWidgetService.getHomeWidgets(request.userInfo.userCode, request.reqParams.homeEndpoint)
    })

    fastify.post('/widget/add', {
        schema: {
            description: '添加小组件到用户首页',
            summary: '添加首页小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCode: {type: 'string'},
                    homeEndpoint: {type: 'string'},
                    order: {type: 'number'}
                },
                required: ['widgetCode']
            },
            tags: ['home'],
            response: {
                default: {...getResSwaggerSchema(homeWidgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeWidgetService.addHomeWidget(request.userInfo, request.reqParams.widgetCode, request.reqParams.homeEndpoint, request.reqParams.order)
    })

    fastify.post('/widget/remove', {
        schema: {
            description: '从用户首页移除小组件',
            summary: '移除首页小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCode: {type: 'string'},
                    homeEndpoint: {type: 'string'},
                    order: {type: 'number'}
                },
                required: ['widgetCode']
            },
            tags: ['home'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await homeWidgetService.removeHomeWidget(request.userInfo, request.reqParams.widgetCode, request.reqParams.homeEndpoint, request.reqParams.order)
    })

    fastify.post('/widget/batch/save', {
        schema: {
            description: '批量保存用户首页小组件',
            summary: '批量保存首页小组件',
            body: {
                type: 'object',
                properties: {
                    widgetCodes: {type: 'array', items: {type: 'string'}},
                    homeEndpoint: {type: 'string'}
                },
                required: ['widgetCodes']
            },
            tags: ['home'],
            response: {
                default: {...getListResSwaggerSchema(homeWidgetSchema)}
            }
        }
    }, async function (request, reply) {
        return await homeWidgetService.saveHomeWidgets(request.userInfo, request.reqParams.widgetCodes, request.reqParams.homeEndpoint)
    })
}