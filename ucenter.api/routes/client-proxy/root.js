import {getDefaultResponseSchema} from '../../plugins/format-reply.js'

export default async function (fastify, opts) {
    fastify.get('/', {
        schema: {
            description: '测试接口',
            summary: '测试接口',
            tags: ['client-proxy'],
            response: {
                default: {
                    ...getDefaultResponseSchema({test: {type: 'string'}}),
                }
            }
        }
    }, async function (request, reply) {
        /*reply.cookie('param-accessToken', '1213')*/
        return {test: '123'}
    })
}
