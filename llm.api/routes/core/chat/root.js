import {execChat} from '../../../services/core/llmChat.js'
import {createSseChannel} from '../../../tools/sseChannel.js'
import {validateChannels} from '../../../conf/llmChannel.js'
import {chatStreamBodySchema} from '../../../schemas/chatStreamSchema.js'
import {auditBody} from '../../../tools/schemaAudit.js'
import {admitRun, releaseRun, snapshot, archiveCount, detachArchive} from '../../../services/core/session/runRegistry.js'
import {socketCloseAbortDecision} from '../../../services/core/session/shutdownPolicy.js'
import {isClosing, shutdownStatus} from '../../../services/core/session/shutdownState.js'

const logger = llm.logger
const tools = llm.tools

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

        /**
         * 并发闸（PR-0.4）。**默认关**：`limit` 为 0 时连登记都不做，行为与改造前逐字一致。
         *
         * 位置必须在这里——`writeHead(200)` 之后就只能靠 SSE 帧表达拒绝，
         * 而"这一轮根本没开始"和"开始了但被掐掉"是两件事，混在一个流里前端就分不开。
         * 拒绝也不进队列：没有队列的时候就老老实实拒（D36），"偷偷排队"只会让用户看到卡住。
         */
        const gateCfg = llm.config.limits?.concurrentRuns || {}
        const messageCodeForGate = request.reqParams?.options?.messageCode || tools.getUUID()
        if (Number(gateCfg.limit) > 0) {
            const gated = admitRun({
                messageCode: messageCodeForGate,
                conversationCode: request.reqParams?.conversationCode,
                userCode: request.userInfo.userCode,
                cfg: gateCfg,
            })
            if (!gated.admit) {
                const r = gated.response
                Object.entries(r.headers || {}).forEach(([k, v]) => reply.header(k, v))
                logger.warn(`并发闸拒绝: reason=${gated.decision.reason}, active=${gated.decision.active}, limit=${gated.decision.limit}, userCode=${request.userInfo.userCode}, conversationCode=${request.reqParams?.conversationCode}`)
                /**
                 * 直接回整个 body：里面同时有 `success:false`+`message`（x-sdk 的错误通道）
                 * 和 `code:4290`+`msg`+`data`（本项目 retSchema 口径）。
                 * 注意**不能再套 retSchema**——那会把 `success` 抹掉，拒绝就会走 onSuccess 分支，
                 * 用户看到的是一条空回答而不是一句"请稍后再问"。
                 */
                return reply.code(r.httpStatus).send(r.body)
            }
        }

        const controller = new AbortController()
        const {signal} = controller
        request.raw.socket.on('close', () => {
            /**
             * 断开要不要打断这一轮，判据在 `shutdownPolicy.socketCloseAbortDecision`：
             * **关闭期间的断开不是用户按停止**。源仓的真实滚动实测：网关只拆客户端侧，
             * 应用侧连接还活着 ⇒ 被动等 socket close 根本等不到，所以抢救必须自己主动下停止位。
             *
             * 这行日志原来有两处必须修：① 同一个字段 `request.raw.aborted` 打了两遍
             * （第二处本意是 destroyed）；② 不带 reqId/messageCode ⇒ keep-alive 复用时
             * 一行日志归属不到具体请求。**归属不明的日志不能作为证据**——源仓就因此下错过一次结论。
             */
            const callSite = socketCloseAbortDecision({
                closing: isClosing(),
                destroyed: request.raw.destroyed,
                aborted: controller.signal.aborted,
            })
            logger.info(`request closed execChat reqId=${request.id}, messageCode=${messageCodeForGate}, `
                + `aborted=${request.raw.aborted}, destroyed=${request.raw.destroyed}, `
                + `closing=${isClosing()}, 决策=${callSite.reason}`)
            if (callSite.abort) {
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
         * 心跳不是优化项——生产入口 Traefik 的 `idleTimeout` 180s 且无法用注解调整（§2B.2），
         * 工具执行/长思考阶段一旦静默超时，连接必被掐断。
         */
        const channel = createSseChannel(stream, {
            pingIntervalMs: llm.config.stream?.pingIntervalMs,
            onError: (e) => logger.warn(`SSE 写入失败（多半是客户端断开）: ${String(e?.message || e).slice(0, 160)}`),
        })
        let aborted = false
        try {
            const ret = await execChat(request.userInfo, request.reqParams.query, request.reqParams.conversationCode, {
                /**
                 * 把闸用的 messageCode 原样交给 run：
                 * 登记与注销必须是同一个键，否则要么额度永久泄漏，要么多减一次把别人的位置踩掉。
                 */
                ...request.reqParams.options, messageCode: messageCodeForGate,
                signal, streamCallback: (content, eventType) => {
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
        } finally {
            /**
             * **注销放在 finally 是这条链上唯一的保险**：正常收尾、上游抛错、客户端断开、
             * `streamCallback` 写失败都会走到这里。少一次注销，闸就永久少一格，
             * 症状是"用久了整站变慢"，看起来完全不像自己写的 bug。
             */
            if (Number(gateCfg.limit) > 0) {
                releaseRun(messageCodeForGate)
            }
            /**
             * 摘掉落档函数**必须放在闸的 if 外面**：放进 `if (limit > 0)` 就是重复同一个错——
             * 闸关着时挂上的函数永远不摘 ⇒ archives 只增不减，直到某天关闭时把几百条历史
             * messageCode 当成"在途 run"去落档。
             */
            detachArchive(messageCodeForGate)
        }
        /** 两侧的键都写上：reqId 接 HTTP 层日志，traceId（=messageCode）接 run 层日志与账本 */
        logger.info(`SSE 结束: reqId=${request.id}, seq=${channel.close()}, aborted=${aborted}`)
        stream.end()
        return reply
    })

    /**
     * 并发闸的读数（PR-0.4）。
     * 只给聚合数：**不返回 `byUser`**——"谁现在有几个 run 在跑"是把别人的在线状态卖给了任意调用方，
     * 与 §2E-4/§2F.37 是同一类问题（能枚举活跃账号的接口，和能读别人会话的接口是同一种缺陷）。
     */
    fastify.post('/runStats', {
        schema: {
            description: '本进程在途 run 与并发闸计数（只含聚合数，不含用户维度）',
            summary: '并发闸读数',
            tags: ['llm'],
            response: {},
        },
    }, async function (request, reply) {
        /**
         * 身份校验不能省。公网一侧由网关拦 token，但**内部路径不能当成已鉴权**：
         * 集群里任意 pod 直连 12008 就能匿名读到闸的 limit/active/rejected 与抢救表长度。
         */
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const s = snapshot()
        const cfg = llm.config.limits?.concurrentRuns || {}
        return {
            active: s.active,
            admitted: s.admitted,
            rejected: s.rejected,
            released: s.released,
            overRelease: s.overRelease,
            /** 任何时刻都应为 0；非 0 说明登记/注销不配对 ⇒ 闸会越用越紧，那是 bug 不是负载 */
            accountingGap: s.accountingGap,
            oldestMs: s.oldestMs,
            limit: Number(cfg.limit) || 0,
            perUserLimit: Number(cfg.perUserLimit) || 0,
            gateEnabled: (Number(cfg.limit) || 0) > 0,
            /**
             * 停机抢救的两个可读事实。放这里的理由很具体：`active` 在闸关闭时恒为 0（设计如此），
             * 如果抢救表也挂在那张表上，"有没有东西等着被抢救"就变成**查不到**——
             * 而这是一个必须能被查到的问题（源仓 §25 v1.43 就是在途采样 archiving=1 才证成分表设计）。
             */
            archiving: archiveCount(),
            shutdown: shutdownStatus(),
        }
    })
}
