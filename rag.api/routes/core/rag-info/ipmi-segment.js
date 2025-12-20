/**
 * @fileOverview 材料分段管理相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import * as ragSegmentService from '../../../services/core/ragSegment.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info/ipmi-segment'

const ragSegmentSchema = {$ref: 'fullParamModels#/properties/RagSegment'}

export function registerCommonRoutes(fastify, opts, tags = ['rag-ipmi']) {

    fastify.post('/list', {
        schema: {
            description: '获取材料分段列表',
            summary: '材料分段列表',
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
                            withChunk: {type: 'number', description: '是否附加分句'},
                        }
                    }
                }
            },
            tags,
            response: {
                default: {...getPageListResSwaggerSchema(ragSegmentSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.getRagSegments(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.get('/detail', {
        schema: {
            description: '获取材料分段全部信息结构',
            summary: '获取材料分段的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    ragSegmentCode: {type: 'string'}
                },
                required: ['ragSegmentCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(ragSegmentSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.getRagSegment(request.reqParams.ragSegmentCode)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个材料分段',
            summary: '添加单个材料分段',
            body: ragSegmentSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema(ragSegmentSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.addRagSegment(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个材料分段',
            summary: '修改单个材料分段',
            body: ragSegmentSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.updateRagSegment(request.userInfo, request.reqParams.ragSegmentCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除材料分段',
            summary: '删除材料分段',
            body: {
                type: 'object',
                properties: {
                    ragSegmentCode: {
                        type: 'string'
                    },
                },
                required: ['ragSegmentCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.deleteRagSegment(request.userInfo, request.reqParams.ragSegmentCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用材料分段',
            summary: '启用材料分段',
            body: {
                type: 'object',
                properties: {
                    ragSegmentCode: {
                        type: 'string'
                    },
                },
                required: ['ragSegmentCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.enableRagSegment(request.userInfo, request.reqParams.ragSegmentCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用材料分段',
            summary: '禁用材料分段',
            body: {
                type: 'object',
                properties: {
                    ragSegmentCode: {
                        type: 'string'
                    },
                },
                required: ['ragSegmentCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragSegmentService.disableRagSegment(request.userInfo, request.reqParams.ragSegmentCode)
    })
}

export default async function (fastify, opts) {
    registerCommonRoutes(fastify, opts)
}