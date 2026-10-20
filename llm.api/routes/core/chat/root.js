import {execChat} from '../../../services/core/llmChat.js'
import {serializeSSEEvent} from '../../../tools/sse.js'
import {validateChannels} from '../../../conf/llmChannel.js'
import {chatStreamBodySchema} from '../../../schemas/chatStreamSchema.js'
import {auditBody} from '../../../tools/schemaAudit.js'

const logger = llm.logger

export default async function (fastify, opts) {

    fastify.post('/stream', {
        schema: {
            description: '大模型对话，以event-stream返回',
            summary: '大模型对话（流式）',
            body: chatStreamBodySchema,
            tags: ['llm']
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }

        /*schema 收紧（R2-b）的前置观测：记录未声明字段，只告警不改行为、不记字段值*/
        auditBody({body: request.body, schema: chatStreamBodySchema})

        /*频道必须在配置中定义，否则 sysPrompt/skills/MCP 会静默走空配置*/
        const reqChannel = request.reqParams?.options?.channel
        if (reqChannel && validateChannels([reqChannel]).length) {
            const err = new Error(`无效的频道: ${reqChannel}，该频道未在配置中定义`)
            err.statusCode = 400
            throw err
        }

        const controller = new AbortController()
        const {signal} = controller
        request.raw.socket.on('close', () => {
            logger.info(`request closed execChat request.raw.aborted:${request.raw.aborted} request.raw.aborted:${request.raw.destroyed}`)
            if (request.raw.destroyed) {
                controller.abort()
            }
        })

        const stream = reply.raw
        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache,no-transform',
            'x-no-compression': 1
        }
        if (request.headers.origin) {
            headers['Access-Control-Allow-Origin'] = request.headers.origin
        }
        stream.writeHead(200, headers)
        let aborted = false
        try {
            const ret = await execChat(request.userInfo, request.reqParams.query, request.reqParams.conversationCode, {
                ...request.reqParams.options, signal, streamCallback: (content, eventType) => {
                    stream.write(serializeSSEEvent({
                        event: eventType || 'delta',
                        data: content
                    }))
                }
            })
            aborted = ret === 'aborted'
            stream.write(serializeSSEEvent({
                event: aborted ? 'abort' : 'done',
                data: aborted ? 'aborted' : 'done'
            }))
        } catch (err) {
            console.error(err);
            stream.write(serializeSSEEvent({
                event: 'error',
                data: err.message || '处理出错，请稍等再试'
            }))
        }
        stream.end()
        return reply
    })
}
