import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {getToken} from '../../../services/oauth/code.js'

export const autoPrefix = '/cgi-bin/oauth/code'

export default async function (fastify, opts) {
    fastify.post('/token', {
        schema: {
            description: '接入应用获取token',
            summary: '接入应用获取token',
            body: {
                type: 'object',
                properties: {
                    clientCode: {type: 'string'},
                    clientSecret: {type: 'string'},
                    authCode: {type: 'string'},
                    retUrl: {type: 'string'}
                },
                required: ['clientCode', 'clientSecret', 'authCode', 'retUrl']
            },
            tags: ['cgi-bin'],
            response: {
                default: {...getDefaultResponseSchema({
                        accessToken: {type: 'string'},
                        refreshToken: {type: 'string'},
                        scopes: {type: 'string'},
                        expiresTime: {type: 'string'},
                    })}
            }
        }
    }, async function (request, reply) {
        return getToken(request.reqParams)
    })
}
