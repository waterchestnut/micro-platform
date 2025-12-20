/**
 * @fileOverview 机构管理相关的接口
 * @author xianyang
 * @module
 */

import * as orgInfoService from '../../../services/core/orgInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/org/ipmi'

export default async function (fastify, opts) {
    const orgSchema = {$ref: 'fullParamModels#/properties/OrgInfo'}
    /*console.log(orgSchema)*/

    fastify.get('/detail', {
        schema: {
            description: '获取机构全部信息结构',
            summary: '获取机构的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    orgCode: {type: 'string'}
                },
                required: ['orgCode']
            },
            tags: ['org-ipmi'],
            response: {
                default: {
                    ...getResSwaggerSchema(orgSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await orgInfoService.getOrgDetail(request.reqParams.orgCode)
    })

    fastify.post('/list', {
        schema: {
            description: '获取机构列表',
            summary: '机构列表',
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
            tags: ['org-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(orgSchema)}
            }
        }
    }, async function (request, reply) {
        return await orgInfoService.getOrgList(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个机构',
            summary: '添加单个机构',
            body: orgSchema,
            tags: ['org-ipmi'],
            response: {
                default: {...getResSwaggerSchema(orgSchema)}
            }
        }
    }, async function (request, reply) {
        return await orgInfoService.addOrgInfo(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个机构',
            summary: '修改单个机构',
            body: orgSchema,
            tags: ['org-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await orgInfoService.updateOrgInfo(request.reqParams.orgCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除机构',
            summary: '删除机构',
            body: {
                type: 'object',
                properties: {
                    orgCode: {
                        type: 'string'
                    },
                },
                required: ['orgCode']
            },
            tags: ['org-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await orgInfoService.deleteOrgInfo(request.reqParams.orgCode)
    })
}
