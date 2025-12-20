import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {getClientToken, refreshClientAccessToken} from '../../../services/oauth/pwd.js'

export const autoPrefix = '/cgi-bin/oauth/pwd'

export default async function (fastify, opts) {
    fastify.post('/client-token', {
        schema: {
            description: '接入应用获取clientToken',
            summary: '接入应用获取clientToken',
            body: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    clientSecret: {type: 'string'}
                },
                required: ['clientCode', 'clientSecret']
            },
            tags: ['cgi-bin'],
            response: {
                default: {
                    ...getDefaultResponseSchema({
                        clientAccessToken: {type: 'string'},
                        clientRefreshToken: {type: 'string'},
                        expiresTime: {type: 'string'},
                    })
                }
            }
        }
    }, async function (request, reply) {
        return getClientToken(request.reqParams)
    })

    fastify.post('/client-token/refresh', {
        schema: {
            description: '接入应用刷新clientToken',
            summary: '接入应用刷新clientToken',
            body: {
                type: 'object',
                properties: {
                    clientRefreshToken: {type: 'string'}
                },
                required: ['clientRefreshToken']
            },
            tags: ['cgi-bin'],
            response: {
                default: {
                    ...getDefaultResponseSchema({
                        clientAccessToken: {type: 'string'},
                        clientRefreshToken: {type: 'string'},
                        expiresTime: {type: 'string'},
                    })
                }
            }
        }
    }, async function (request, reply) {
        return refreshClientAccessToken(request.reqParams.clientRefreshToken)
    })
}
