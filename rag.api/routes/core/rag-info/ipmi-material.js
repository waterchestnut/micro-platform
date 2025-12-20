/**
 * @fileOverview 知识库材料管理相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import * as ragMaterialService from '../../../services/core/ragMaterial.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info/ipmi-material'

const ragMaterialSchema = {$ref: 'fullParamModels#/properties/RagMaterial'}

export function registerCommonRoutes(fastify, opts, tags = ['rag-ipmi']) {

    fastify.post('/list', {
        schema: {
            description: '获取知识库材料列表',
            summary: '知识库材料列表',
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
                default: {...getPageListResSwaggerSchema(ragMaterialSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.getRagMaterials(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.get('/detail', {
        schema: {
            description: '获取知识库材料全部信息结构',
            summary: '获取知识库材料的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    ragMaterialCode: {type: 'string'}
                },
                required: ['ragMaterialCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(ragMaterialSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.getRagMaterial(request.reqParams.ragMaterialCode)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个材料',
            summary: '添加单个材料',
            body: ragMaterialSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema(ragMaterialSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.addRagMaterial(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个知识库材料',
            summary: '修改单个知识库材料',
            body: ragMaterialSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.updateRagMaterial(request.userInfo, request.reqParams.ragMaterialCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除知识库材料',
            summary: '删除知识库材料',
            body: {
                type: 'object',
                properties: {
                    ragMaterialCode: {
                        type: 'string'
                    },
                },
                required: ['ragMaterialCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.deleteRagMaterial(request.userInfo, request.reqParams.ragMaterialCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用知识库材料',
            summary: '启用知识库材料',
            body: {
                type: 'object',
                properties: {
                    ragMaterialCode: {
                        type: 'string'
                    },
                },
                required: ['ragMaterialCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.enableRagMaterial(request.userInfo, request.reqParams.ragMaterialCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用知识库材料',
            summary: '禁用知识库材料',
            body: {
                type: 'object',
                properties: {
                    ragMaterialCode: {
                        type: 'string'
                    },
                },
                required: ['ragMaterialCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragMaterialService.disableRagMaterial(request.userInfo, request.reqParams.ragMaterialCode)
    })
}

export default async function (fastify, opts) {
    registerCommonRoutes(fastify, opts)
}