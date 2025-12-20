import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {feedback, getMessages} from '../../../services/core/message.js'

const messageSchema = {$ref: 'fullStoreModels#/properties/Message'}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取大模型会话消息列表',
            summary: '消息列表',
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
            tags: ['llm'],
            response: {}
        }
    }, async function (request, reply) {
        return await getMessages(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/feedback', {
        schema: {
            description: '用户对大模型回答的内容进行反馈',
            summary: '回答反馈',
            body: {
                type: 'object',
                properties: {
                    messageCode: {type: 'string', description: '会话消息标识'},
                    like: {type: 'number', description: '-1=不喜欢，0=不作反馈，1-喜欢'},
                }
            },
            tags: ['llm'],
            response: {}
        }
    }, async function (request, reply) {
        return await feedback(request.userInfo, request.reqParams.messageCode, request.reqParams.like)
    })
}
