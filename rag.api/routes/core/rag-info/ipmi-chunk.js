/**
 * @fileOverview 材料分句管理相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import * as ragChunkService from '../../../services/core/ragChunk.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info/ipmi-chunk'

const ragChunkSchema = {$ref: 'fullParamModels#/properties/RagChunk'}

export function registerCommonRoutes(fastify, opts, tags = ['rag-ipmi']) {

    fastify.post('/list', {
        schema: {
            description: '获取材料分句列表',
            summary: '材料分句列表',
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
            tags,
            response: {
                default: {...getPageListResSwaggerSchema(ragChunkSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.getRagChunks(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.get('/detail', {
        schema: {
            description: '获取材料分句全部信息结构',
            summary: '获取材料分句的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    ragChunkCode: {type: 'string'}
                },
                required: ['ragChunkCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(ragChunkSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.getRagChunk(request.reqParams.ragChunkCode)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个材料分句',
            summary: '添加单个材料分句',
            body: ragChunkSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema(ragChunkSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.addRagChunk(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个材料分句',
            summary: '修改单个材料分句',
            body: ragChunkSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.updateRagChunk(request.userInfo, request.reqParams.ragChunkCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除材料分句',
            summary: '删除材料分句',
            body: {
                type: 'object',
                properties: {
                    ragChunkCode: {
                        type: 'string'
                    },
                },
                required: ['ragChunkCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.deleteRagChunk(request.userInfo, request.reqParams.ragChunkCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用材料分句',
            summary: '启用材料分句',
            body: {
                type: 'object',
                properties: {
                    ragChunkCode: {
                        type: 'string'
                    },
                },
                required: ['ragChunkCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.enableRagChunk(request.userInfo, request.reqParams.ragChunkCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用材料分句',
            summary: '禁用材料分句',
            body: {
                type: 'object',
                properties: {
                    ragChunkCode: {
                        type: 'string'
                    },
                },
                required: ['ragChunkCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragChunkService.disableRagChunk(request.userInfo, request.reqParams.ragChunkCode)
    })
}

export default async function (fastify, opts) {
    registerCommonRoutes(fastify, opts)
}