import {getDefaultResponseSchema} from '../../plugins/format-reply.js'
import {getResSwaggerSchema} from '../../daos/swaggerSchema/responseHandler.js'
import {checkAuth} from '../../services/auth/index.js'

export default async function (fastify, opts) {
    const checkSchema = {
        description: '接口权限验证',
        summary: '接口权限验证',
        body: {
            type: 'object',
            properties: {
                path: {type: 'string'},
                method: {type: 'string'},
            },
            required: ['path', 'method']
        },
        tags: ['auth'],
        response: {
            default: {
                ...getDefaultResponseSchema({
                    userInfo: {type: 'string', description: '用户信息的base64编码格式'},
                    clientInfo: {type: 'string', description: '第三方应用的base64编码格式'}
                })
            }
        }
    }
    fastify.post('/check', {schema: checkSchema}, async function (request, reply) {
        return checkAuth(request.reqParams)
    })
}
