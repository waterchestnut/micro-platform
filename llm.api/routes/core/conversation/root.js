import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {getConversations, statConversationByChannelGroup} from '../../../services/core/conversation.js'
import {LIST_EXCLUDE_INTERNAL} from '../../../daos/core/policy/conversationVisibility.js'

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
        return await getConversations({
            ...request.reqParams.filter,
            userCode: request.userInfo.userCode,
            /**
             * 工作会话不进列表（conversationVisibility：语义字段，不是前缀 regex）。
             * **必须放最后**：调用方 filter 覆盖不了它；而权限校验走 getConversationCodes
             * （无此过滤）——internal 会话的 byCode 读取照常，这条分离有守卫用例钉住。
             */
            ...LIST_EXCLUDE_INTERNAL
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
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
