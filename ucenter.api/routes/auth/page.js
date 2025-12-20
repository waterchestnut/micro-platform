/**
 * @fileOverview 路由配置管理相关的接口
 * @author xianyang
 * @module
 */

import * as pageConfigService from '../../services/core/pageConfig.js'
import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/auth/page'

export default async function (fastify, opts) {
    const pageConfigSchema = {$ref: 'fullParamModels#/properties/PageConfig'}

    fastify.post('/list', {
        schema: {
            description: '获取路由配置列表',
            summary: '路由配置列表',
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
                            withFormat: {
                                type: 'number',
                                description: '是否格式化所属应用等字段的名称,1-格式化，0-不格式化'
                            },
                        }
                    }
                }
            },
            tags: ['auth'],
            response: {
                default: {...getPageListResSwaggerSchema({$ref: 'fullParamModels#/properties/PageConfigFormatted'})}
            }
        }
    }, async function (request, reply) {
        return await pageConfigService.getPageConfigList(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/save', {
        schema: {
            description: '添加或更新单个路由配置',
            summary: '添加或更新单个路由配置',
            body: {$ref: 'fullStoreModels#/properties/PageConfig'},
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema(pageConfigSchema)}
            }
        }
    }, async function (request, reply) {
        return await pageConfigService.savePageConfig(request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除路由配置',
            summary: '删除路由配置',
            body: {
                type: 'object',
                properties: {
                    pageConfigCode: {
                        type: 'string'
                    },
                },
                required: ['pageConfigCode']
            },
            tags: ['auth'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await pageConfigService.deletePageConfig(request.reqParams.pageConfigCode)
    })

    fastify.get('/all', {
        schema: {
            description: '获取所有的路由配置',
            summary: '获取所有的路由配置',
            tags: ['auth'],
            response: {
                default: {...getListResSwaggerSchema({$ref: 'fullParamModels#/properties/PageConfigFormatted'})}
            }
        }
    }, async function (request, reply) {
        return await pageConfigService.getAllPageConfig()
    })

    fastify.post('/all/save', {
        schema: {
            description: '更新所有的路由配置',
            summary: '更新所有的路由配置',
            tags: ['auth'],
            body: {
                type: 'object',
                properties: {
                    infos: {
                        type: 'array',
                        nullable: false,
                        description: '配置列表',
                        items: {$ref: 'fullStoreModels#/properties/PageConfig'}
                    },
                },
                required: ['infos']
            },
            response: {
                default: {...getListResSwaggerSchema({$ref: 'fullParamModels#/properties/PageConfigFormatted'})}
            }
        }
    }, async function (request, reply) {
        return await pageConfigService.updateAll(request.userInfo, request.reqParams.infos)
    })
}
