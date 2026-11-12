import {
    getListResSwaggerSchema,
    getPageListResSwaggerSchema,
    getResSwaggerSchema
} from '../../../daos/swaggerSchema/responseHandler.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import { getToolResult,feedback, getMessagePage} from '../../../services/core/message.js'

const messageSchema = {$ref: 'fullStoreModels#/properties/Message'}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取大模型会话消息列表，返回展示视图（不含发给模型的完整提示词，附带执行过程统计）',
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
        return await getMessagePage(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options, request.userInfo)
    })

    fastify.post('/tool-result', {
        schema: {
            description: '按 ref 取回某轮工具调用被裁剪前的留档正文（只读，需为该会话成员）。'
                + '未裁剪过的结果本来就在 /core/message/list 的 process.toolCalls[].result 里，这里取不到；'
                + '超出留档上限（extInfo.toolOverflows.stored=false）的尾部任何地方都不存在，响应会如实标注范围',
            summary: '取回工具结果留档正文',
            body: {
                type: 'object',
                properties: {
                    messageCode: {type: 'string', description: '消息标识'},
                    ref: {type: 'string', description: '留档标识（即 tool_call_id）'},
                    offset: {type: 'number', description: '起始字符，默认 0'},
                    limit: {type: 'number', description: '本次最多取多少字符，默认 4000，上限 20000'},
                },
                required: ['messageCode', 'ref'],
            },
            tags: ['llm'],
            response: {}
        }
    }, async function (request, reply) {
        const ret = await getToolResult(request.userInfo, request.reqParams)
        if (ret.ok === false) {
            /** 纯函数给的判据在这里落地成状态码，不在组件/服务外再判一次 */
            const err = new Error(ret.error)
            err.statusCode = ret.statusCode || 404
            throw err
        }
        return ret.data
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
