/**
 * @fileOverview 知识库管理相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import * as ragInfoService from '../../../services/core/ragInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info/ipmi'

const ragInfoSchema = {$ref: 'fullParamModels#/properties/RagInfo'}

export function registerCommonRoutes(fastify, opts, tags = ['rag-ipmi']) {
    fastify.get('/detail', {
        schema: {
            description: '获取知识库全部信息结构',
            summary: '获取知识库的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'}
                },
                required: ['ragCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(ragInfoSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.getRagInfo(request.reqParams.ragCode)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个知识库',
            summary: '修改单个知识库',
            body: ragInfoSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.updateRagInfo(request.userInfo, request.reqParams.ragCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除知识库',
            summary: '删除知识库',
            body: {
                type: 'object',
                properties: {
                    ragCode: {
                        type: 'string'
                    },
                },
                required: ['ragCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.deleteRagInfo(request.userInfo, request.reqParams.ragCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用知识库',
            summary: '启用知识库',
            body: {
                type: 'object',
                properties: {
                    ragCode: {
                        type: 'string'
                    },
                },
                required: ['ragCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.enableRagInfo(request.userInfo, request.reqParams.ragCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用知识库',
            summary: '禁用知识库',
            body: {
                type: 'object',
                properties: {
                    ragCode: {
                        type: 'string'
                    },
                },
                required: ['ragCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.disableRagInfo(request.userInfo, request.reqParams.ragCode)
    })
}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取知识库列表',
            summary: '知识库列表',
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
            tags: ['rag-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(ragInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.getRagInfos(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts)
}