import {getListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {execChat} from '../../../services/core/llmChat.js'
import {serializeSSEEvent} from '../../../tools/sse.js'

export default async function (fastify, opts) {

    fastify.post('/stream', {
        schema: {
            description: '大模型对话，以event-stream返回',
            summary: '大模型对话（流式）',
            body: {
                type: 'object',
                properties: {
                    query: {type: 'string', description: '用户问题'},
                    conversationCode: {type: 'string', description: '会话标识'},
                    options: {
                        type: 'object',
                        properties: {
                            llmModel: {type: 'string', description: '大模型'},
                            channel: {type: 'string', description: '大模型'},
                            channelGroup: {type: 'string', description: '大模型'},
                            llmParams: {
                                type: 'object',
                                properties: {
                                    maxTokens: {type: 'number', description: '最大返回tokens数量'},
                                },
                                description: '大模型提示词等相关的参数',
                                additionalProperties: {type: 'string'}
                            },
                            ragParams: {
                                type: 'object',
                                properties: {
                                    resCode: {type: 'string', description: '资源标识'},
                                    maxLength: {type: 'number', description: '最多返回资料片段数'},
                                    maxTokens: {type: 'number', description: '最大输入材料tokens数量'},
                                },
                                description: '增强检索相关的参数',
                                additionalProperties: {type: 'string'}
                            },
                        }
                    }
                }
            },
            tags: ['llm']
        },
    }, async function (request, reply) {
        const stream = reply.raw
        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache,no-transform',
            'Access-Control-Allow-Origin': request.headers.origin,
            'x-no-compression': 1
        }
        stream.writeHead(200, headers)
        try {
            await execChat(request.userInfo, request.reqParams.query, request.reqParams.conversationCode, {
                ...request.reqParams.options, streamCallback: (content) => {
                    stream.write(serializeSSEEvent({
                        event: 'delta',
                        data: content
                    }))
                }
            })
        } catch (err) {
            stream.write(serializeSSEEvent({
                event: 'error',
                data: err.message || '处理出错，请稍等再试'
            }))
        }
        stream.end()
        return reply
    })
}
