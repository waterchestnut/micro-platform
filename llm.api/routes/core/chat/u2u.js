import {createSseChannel} from '../../../tools/sseChannel.js'
import redisClient from '../../../daos/cache/redisClient.js'
import {
    assertMember,
    deleteU2uMessage,
    getU2uConversationList,
    getU2uMessages,
    readU2uMessages,
    sendU2uMessage,
} from '../../../services/core/u2uChat.js'

const logger = llm.logger

export const autoPrefix = '/core/chat/u2u'

export default async function (fastify, opts) {

    fastify.post('/conversation/list', {
        schema: {
            description: '获取我的u2u会话列表',
            summary: 'u2u会话-列表',
            body: {
                type: 'object',
                properties: {
                    filter: {type: 'object', description: '筛选条件，支持keyword'},
                    pageIndex: {type: 'number', description: '页码'},
                    pageSize: {type: 'number', description: '分页大小'},
                }
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        return await getU2uConversationList(request.userInfo, request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize)
    })

    fastify.post('/message/send', {
        schema: {
            description: '发送u2u消息（会话不存在时自动创建）',
            summary: 'u2u消息-发送',
            body: {
                type: 'object',
                properties: {
                    targetUserCode: {type: 'string', description: '接收者用户标识'},
                    content: {type: 'string', description: '消息内容'},
                    messageCode: {type: 'string', description: '前端预生成的消息标识（幂等）'},
                    messageType: {type: 'string', description: '消息类型：text/image/file，默认text'},
                    attachments: {type: 'array', description: '附件信息（FileInfo）'},
                },
                required: ['targetUserCode', 'content']
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        return await sendU2uMessage(request.userInfo, request.reqParams)
    })

    fastify.post('/message/list', {
        schema: {
            description: '获取u2u会话消息列表（支持增量游标）',
            summary: 'u2u消息-列表',
            body: {
                type: 'object',
                properties: {
                    conversationCode: {type: 'string', description: '会话标识（与targetUserCode二选一）'},
                    targetUserCode: {type: 'string', description: '对方用户标识（与conversationCode二选一，传入时按双方用户标识确定会话）'},
                    pageIndex: {type: 'number', description: '页码，默认1'},
                    pageSize: {type: 'number', description: '分页大小，默认20'},
                    afterInsertTime: {type: 'string', description: '增量游标（时间）'},
                    beforeInsertTime: {type: 'string', description: '向上翻页游标（时间）'},
                },
                anyOf: [
                    {required: ['conversationCode']},
                    {required: ['targetUserCode']},
                ]
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        return await getU2uMessages(request.userInfo, request.reqParams)
    })

    fastify.post('/message/read', {
        schema: {
            description: '标记u2u会话消息已读',
            summary: 'u2u消息-标记已读',
            body: {
                type: 'object',
                properties: {
                    conversationCode: {type: 'string', description: '会话标识'},
                    upToTime: {type: 'string', description: '读到的时间点，默认当前时间'},
                },
                required: ['conversationCode']
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        return await readU2uMessages(request.userInfo, request.reqParams)
    })

    fastify.post('/message/delete', {
        schema: {
            description: '删除u2u消息（软删除，仅本人消息）',
            summary: 'u2u消息-删除',
            body: {
                type: 'object',
                properties: {
                    messageCode: {type: 'string', description: '消息标识'},
                },
                required: ['messageCode']
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        return await deleteU2uMessage(request.userInfo, request.reqParams)
    })

    fastify.post('/message/stream', {
        schema: {
            description: 'u2u新消息实时推送（SSE长连接）',
            summary: 'u2u消息-实时推送',
            body: {
                type: 'object',
                properties: {
                    conversationCode: {type: 'string', description: '会话标识'},
                },
                required: ['conversationCode']
            },
            tags: ['u2u'],
            response: {}
        }
    }, async function (request, reply) {
        const {conversationCode} = request.reqParams
        const userCode = request.userInfo.userCode
        await assertMember(conversationCode, userCode)

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
         * 这条连接绝大多数时间是**静默的**（在等对方发消息），所以心跳在这里比聊天流更要紧：
         * 没有心跳，空闲超时一到就被掐，用户收不到新消息还看不出原因。
         * 抽成通道还顺手修了一个隐患：原来的写法没有 `id:`，客户端断线后无法判断漏了哪几条消息。
         */
        const channel = createSseChannel(stream, {
            pingIntervalMs: llm.config.stream?.pingIntervalMs,
            onError: (e) => logger.warn(`u2u SSE 写入失败（多半是客户端断开）: ${String(e?.message || e).slice(0, 160)}`),
        })
        channel.emit(JSON.stringify({conversationCode}), 'connected')

        const sub = redisClient.client.duplicate()
        /**
         * @description 收到 redis 推送后转成 SSE 事件
         * @param {String} channelName redis 频道名（注意不要遮蔽上面的 SSE 通道）
         * @param {String} message 推送内容（JSON 字符串）
         * @returns {void}
         */
        const onMessage = (channelName, message) => {
            if (!channel.isOpen()) {
                /** 连接已关（客户端断开）⇒ 丢弃推送，别把写入抛进 redis 回调 */
                return
            }
            try {
                const payload = JSON.parse(message)
                if (payload.conversationCode && payload.conversationCode !== conversationCode) {
                    return
                }
                channel.emit(JSON.stringify(payload.data), payload.event)
            } catch (err) {
                logger.error(`u2u stream 解析推送数据出错: ${err.message}`)
            }
        }

        try {
            await sub.subscribe(`u2u:msg:${userCode}`)
            sub.on('message', onMessage)
        } catch (err) {
            logger.error(`u2u stream 订阅失败: ${err.message}`)
        }

        request.raw.socket.on('close', () => {
            /** 必须关通道：心跳定时器是每连接一个，不关就是每断一条线漏一个定时器 */
            const seq = channel.close()
            sub.removeListener('message', onMessage)
            sub.unsubscribe(`u2u:msg:${userCode}`).catch(() => {})
            sub.quit().catch(() => {})
            logger.info(`u2u SSE 断开: conversationCode=${conversationCode}, seq=${seq}`)
        })

        return reply
    })
}
