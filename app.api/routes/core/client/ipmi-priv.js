/**
 * @fileOverview 应用下的授权管理相关的接口
 * @author xianyang
 * @priv
 */

import * as clientPrivService from '../../../services/core/clientPriv.js'
import {
    getListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/client/ipmi-priv'

export function registerClientPrivRoutes(fastify, opts, tags = ['client-ipmi']) {
    const privSchema = {
        type: 'object',
        properties: {
            modulePrivCode: {
                type: 'string'
            },
            modulePrivName: {
                type: 'string'
            },
            moduleCode: {
                type: 'string'
            },
            moduleName: {
                type: 'string'
            },
        },
        required: ['modulePrivCode', 'modulePrivName', 'moduleCode'],
    }

    fastify.get('/list', {
        schema: {
            description: '获取应用的模块权限列表',
            summary: '模块权限列表',
            querystring: {
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
                default: {...getListResSwaggerSchema(privSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.getClientPrivs(request.reqParams.clientCode)
    })

    fastify.post('/add', {
        schema: {
            description: '添加应用模块权限',
            summary: '添加应用模块权限',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: privSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema(privSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.addClientPriv(request.userInfo, request.reqParams.clientCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除应用模块权限',
            summary: '删除应用模块权限',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: {
                type: 'object',
                properties: {
                    modulePrivCode: {
                        type: 'string'
                    },
                },
                required: ['modulePrivCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.deleteClientPriv(request.userInfo, request.reqParams.clientCode, request.reqParams.modulePrivCode)
    })

    fastify.get('/group/list', {
        schema: {
            description: '获取应用的角色权限列表',
            summary: '角色权限列表',
            querystring: {
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
                default: {
                    ...getListResSwaggerSchema({
                        type: 'object',
                        properties: {
                            groupCode: {
                                type: 'string'
                            },
                            groupName: {
                                type: 'string'
                            },
                            modulePrivCodes: {
                                type: 'array',
                                items: {type: 'string'}
                            },
                        },
                    })
                }
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.getGroups(request.reqParams.clientCode)
    })

    fastify.post('/group/save-priv', {
        schema: {
            description: '保存用户组权限',
            summary: '保存用户组权限',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: {
                type: 'object',
                properties: {
                    groupCode: {
                        type: 'string'
                    },
                    modulePrivCodes: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                },
                required: ['groupCode'],
            },
            tags,
            response: {
                default: {...getResSwaggerSchema({type: 'number', description: '影响的行数'})}
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.saveGroupClientPrivs(request.userInfo, request.reqParams.clientCode, request.reqParams.modulePrivCodes, request.reqParams.groupCode)
    })

    fastify.post('/other-client/list', {
        schema: {
            description: '获取应用授权给其他应用的权限列表',
            summary: '获取应用授权给其他应用的权限列表',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: {
                type: 'object',
                properties: {
                    toClientCodes: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                },
                required: ['toClientCodes']
            },
            tags,
            response: {
                default: {
                    ...getListResSwaggerSchema({
                        type: 'object',
                        properties: {
                            clientCode: {
                                type: 'string'
                            },
                            clientName: {
                                type: 'string'
                            },
                            modulePrivCodes: {
                                type: 'array',
                                items: {type: 'string'}
                            },
                        },
                    })
                }
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.getOtherClientPrivs(request.reqParams.clientCode, request.reqParams.toClientCodes)
    })

    fastify.post('/other-client/save-priv', {
        schema: {
            description: '保存给其他应用分配的权限',
            summary: '保存给其他应用分配的权限',
            querystring: {
                type: 'object',
                properties: {
                    clientCode: {
                        type: 'string'
                    },
                },
                required: ['clientCode']
            },
            body: {
                type: 'object',
                properties: {
                    toClientCode: {
                        type: 'string'
                    },
                    modulePrivCodes: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                },
                required: ['toClientCode'],
            },
            tags,
            response: {
                default: {...getResSwaggerSchema({type: 'number', description: '影响的行数'})}
            }
        }
    }, async function (request, reply) {
        return await clientPrivService.saveOtherClientPrivs(request.userInfo, request.reqParams.clientCode, request.reqParams.modulePrivCodes, request.reqParams.toClientCode)
    })
}

export default async function (fastify, opts) {
    registerClientPrivRoutes(fastify, opts)
}
