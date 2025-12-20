/**
 * @fileOverview 第三方客户端管理相关的接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import * as userInfoService from "../../../services/core/userInfo.js";

export const autoPrefix = '/core/client/ipmi'

export default async function (fastify, opts) {
    const clientSchema = {$ref: 'fullParamModels#/properties/Client'}

    fastify.get('/detail', {
        schema: {
            description: '获取客户端全部信息结构',
            summary: '获取客户端的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'}
                },
                required: ['clientCode']
            },
            tags: ['client-ipmi'],
            response: {
                default: {
                    ...getResSwaggerSchema(clientSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await clientService.getClientByCode(request.reqParams.clientCode)
    })

    fastify.post('/list', {
        schema: {
            description: '获取客户端列表',
            summary: '客户端列表',
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
            tags: ['client-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.getClients(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个客户端',
            summary: '添加单个客户端',
            body: clientSchema,
            tags: ['client-ipmi'],
            response: {
                default: {...getResSwaggerSchema(clientSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientService.addClient(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个客户端',
            summary: '修改单个客户端',
            body: clientSchema,
            tags: ['client-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.updateClient(request.reqParams.clientCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除客户端',
            summary: '删除客户端',
            body: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            tags: ['client-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.deleteClient(request.reqParams.clientCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用应用',
            summary: '启用应用',
            body: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            tags: ['client-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.enableClient(request.userInfo, request.reqParams.clientCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用应用',
            summary: '禁用应用',
            body: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            tags: ['client-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.disableClient(request.userInfo, request.reqParams.clientCode)
    })





}
