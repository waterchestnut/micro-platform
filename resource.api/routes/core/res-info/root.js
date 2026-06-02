/**
 * @fileOverview 资源相关的接口
 * @author xianyang
 * @module
 */

import * as resInfoService from '../../../services/core/resInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/res-info'

export default async function (fastify, opts) {
    const resInfoSchema = {$ref: 'fullParamModels#/properties/ResInfo'}

    fastify.post('/add', {
        schema: {
            description: '添加单个资源',
            summary: '添加单个资源',
            body: {
                type: 'object',
                properties: {
                    title: {type: 'string'},
                    resType: {type: 'string'},
                },
                required: ['title', 'resType']
            },
            tags: ['res'],
            response: {
                default: {...getResSwaggerSchema(resInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.addResInfo(request.userInfo, request.reqParams)
    })

    fastify.post('/trans-title', {
        schema: {
            description: '获取资源标题的中文翻译',
            summary: '获取资源标题的中文翻译',
            body: {
                type: 'object',
                required: ['resCode'],
                properties: {
                    resCode: {type: 'string', description: '资源标识'},
                }
            },
            tags: ['res'],
            response: {
                default: {...getResSwaggerSchema({
                    type: 'object',
                    properties: {
                        fullTrans: {type: 'string'},
                    }
                })}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.transTitleToCn(request.reqParams.resCode)
    })

    fastify.post('/trans-abstract', {
        schema: {
            description: '获取资源摘要的中文翻译',
            summary: '获取资源摘要的中文翻译',
            body: {
                type: 'object',
                required: ['resCode'],
                properties: {
                    resCode: {type: 'string', description: '资源标识'},
                }
            },
            tags: ['res'],
            response: {
                default: {...getResSwaggerSchema({
                    type: 'object',
                    properties: {
                        fullTrans: {type: 'string'},
                        sentenceTrans: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    original: {type: 'string'},
                                    translation: {type: 'string'},
                                }
                            }
                        }
                    }
                })}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.transAbstractToCn(request.reqParams.resCode)
    })

    fastify.post('/list', {
        schema: {
            description: '获取资源列表',
            summary: '通用获取资源列表',
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
            tags: ['res-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(resInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.getResInfos(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })
}
