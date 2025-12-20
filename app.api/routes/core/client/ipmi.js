/**
 * @fileOverview 应用管理相关的接口
 * @author xianyang
 * @module
 */

import * as clientService from '../../../services/core/client.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {getUcenterClient, saveUcenterClient} from '../../../grpc/clients/client.js'

const clientSchema = {$ref: 'fullParamModels#/properties/Client'}
const ucenterClientReadSchema = {
    type: 'object',
    properties: {
        clientCode: {
            type: 'string'
        },
        clientName: {
            type: 'string'
        },
        clientSecret: {
            type: 'string'
        },
        retUrls: {
            type: 'array',
            items: {type: 'string'}
        },
        status: {
            type: 'number'
        },
        modulePrivCodes: {
            type: 'array',
            items: {type: 'string'}
        },
    },
    required: ['clientCode'],
}
const ucenterClientWriteSchema = {
    type: 'object',
    properties: {
        clientCode: {
            type: 'string'
        },
        clientName: {
            type: 'string'
        },
        clientSecret: {
            type: 'string'
        },
        retUrls: {
            type: 'array',
            items: {type: 'string'}
        },
    },
    required: ['clientCode'],
}

export const autoPrefix = '/core/client/ipmi'

export function registerClientCommonRoutes(fastify, opts,tags=['client-ipmi']) {
    fastify.get('/detail', {
        schema: {
            description: '获取应用全部信息结构',
            summary: '获取应用的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'}
                },
                required: ['clientCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(clientSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await clientService.getClientByCode(request.reqParams.clientCode)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个应用',
            summary: '修改单个应用',
            body: clientSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.updateClient(request.userInfo, request.reqParams.clientCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除应用',
            summary: '删除应用',
            body: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.deleteClient(request.userInfo, request.reqParams.clientCode)
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
            tags,
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
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientService.disableClient(request.userInfo, request.reqParams.clientCode)
    })

    fastify.get('/ucenter/detail', {
        schema: {
            description: '获取应用在授权中心的信息结构',
            summary: '获取应用在授权中心的信息结构',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'}
                },
                required: ['clientCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(ucenterClientReadSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await getUcenterClient(request.reqParams.clientCode)
    })

    fastify.post('/ucenter/save', {
        schema: {
            description: '保存应用在授权中心的信息',
            summary: '保存应用在授权中心的信息',
            body: ucenterClientWriteSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await saveUcenterClient(request.userInfo, request.reqParams)
    })
}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取应用列表',
            summary: '应用列表',
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

    registerClientCommonRoutes(fastify, opts)
}
