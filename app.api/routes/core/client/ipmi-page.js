/**
 * @fileOverview 应用下的路由授权相关的接口
 * @author xianyang
 * @page
 */

import * as clientPageConfigService from '../../../services/core/clientPageConfig.js'
import {
    getListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/client/ipmi-page'

export function registerClientPageRoutes(fastify, opts, tags = ['client-ipmi']) {
    const pageConfigSchema = {
        type: 'object',
        properties: {
            name: {
                type: 'string'
            },
            path: {
                type: 'string'
            },
            auth: {
                type: 'boolean'
            },
            clientAuth: {
                type: 'boolean'
            },
            privs: {
                type: 'array',
                items: {type: 'string'}
            },
            clientPrivs: {
                type: 'array',
                items: {type: 'string'}
            },
        },
        required: ['name', 'path'],
    }

    fastify.get('/list', {
        schema: {
            description: '获取应用的路由权限列表',
            summary: '路由权限列表',
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
                default: {...getListResSwaggerSchema(pageConfigSchema)}
            }
        }
    }, async function (request, reply) {
        return await clientPageConfigService.getClientPageConfigs(request.reqParams.clientCode)
    })

    fastify.post('/save', {
        schema: {
            description: '保存应用的路由权限',
            summary: '保存应用的路由权限',
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
                    pageConfigs: {
                        type: 'array',
                        nullable: false,
                        description: '配置列表',
                        items: pageConfigSchema
                    },
                },
                required: ['pageConfigs']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema({type: 'number', description: '修改的数量'})}
            }
        }
    }, async function (request, reply) {
        return await clientPageConfigService.saveClientPageConfig(request.userInfo, request.reqParams.clientCode, request.reqParams.pageConfigs)
    })
}

export default async function (fastify, opts) {
    registerClientPageRoutes(fastify, opts)
}
