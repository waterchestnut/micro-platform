import {execChat} from '../../../services/core/llmChat.js'
import {createSseChannel} from '../../../tools/sseChannel.js'
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
        /**
         * SSE 通道：每事件带单调 `id:seq`，静默期发 `:ping` 注释帧。
         * 心跳不是优化项——入口代理的空闲超时（生产 Traefik 180s，且无法用 k8s Ingress 注解调整；
         * dev nginx 默认 60s）一定会在长工具执行/长思考的静默阶段把连接掐掉。
         */
        const channel = createSseChannel(stream, {
            pingIntervalMs: llm.config.stream?.pingIntervalMs,
            onError: (e) => logger.warn(`SSE 写入失败（多半是客户端断开）: ${String(e?.message || e).slice(0, 160)}`),
        })
        let aborted = false
        try {
            const ret = await execChat(request.userInfo, request.reqParams.query, request.reqParams.conversationCode, {
                ...request.reqParams.options, signal, streamCallback: (content, eventType) => {
                    channel.emit(content, eventType)
                },
                /** PR-0.3：把 fastify 的 reqId 与入站 traceId 交给 run，日志才接得上 */
                reqId: request.id,
                inboundTraceId: request.headers['x-trace-id'],
            })
            aborted = ret === 'aborted'
            channel.emit(aborted ? 'aborted' : 'done', aborted ? 'abort' : 'done')
        } catch (err) {
            console.error(err);
            channel.emit(err.message || '处理出错，请稍等再试', 'error')
        }
        /** 两侧的键都写上：reqId 接 HTTP 层日志，traceId（=messageCode）接 run 层日志与账本 */
        logger.info(`SSE 结束: reqId=${request.id}, seq=${channel.close()}, aborted=${aborted}`)
        stream.end()
        return reply
    })
}
