import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getConversations, statConversationByChannelGroup} from '../../../services/core/conversation.js'

const conversationSchema = {$ref: 'fullStoreModels#/properties/Conversation'}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取大模型会话列表',
            summary: '会话列表',
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
            response: {
            }
        }
    }, async function (request, reply) {
        return await getConversations(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/stat-channel-group', {
        schema: {
            description: '按照频道分组统计会话信息',
            summary: '按照频道分组统计会话信息',
            body: {
                type: 'object',
                properties: {
                    channel: {
                        oneOf: [
                            {type: 'string', description: '单个频道'},
                            {
                                type: 'array', description: '多个频道列表',
                                items: {type: 'string'}
                            },
                        ],
                    },
                    channelGroup: {
                        oneOf: [
                            {type: 'string', description: '单个频道分组'},
                            {
                                type: 'array', description: '多个频道分组列表',
                                items: {type: 'string'}
                            },
                        ],
                    },
                },
                required: ['channel', 'channelGroup']
            },
            tags: ['llm'],
            response: {}
        }
    }, async function (request, reply) {
        return await statConversationByChannelGroup(request.reqParams.channel, request.reqParams.channelGroup)
    })
}
