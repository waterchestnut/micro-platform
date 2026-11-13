import {execChat} from '../../../services/core/llmChat.js'
import {createSseChannel} from '../../../tools/sseChannel.js'
import {validateChannels} from '../../../conf/llmChannel.js'
import {chatStreamBodySchema, chatResumeBodySchema} from '../../../schemas/chatStreamSchema.js'
import {auditBody} from '../../../tools/schemaAudit.js'
import {admitRun, releaseRun, snapshot, archiveCount, detachArchive, attachEventLog, finishEventLog, getEventLogEntry, eventLogStats} from '../../../services/core/session/runRegistry.js'
import {createRunEventLog, DEFAULT_SNAPSHOT_URL, gapBodyOf} from '../../../services/core/session/runEventLog.js'
import {createRunEventMirror, readRunEventLog, defaultGetClient} from '../../../services/core/session/runEventLogStore.js'
import messageDac from '../../../daos/core/dac/messageDac.js'
import {socketCloseAbortDecision} from '../../../services/core/session/shutdownPolicy.js'
import {isClosing, shutdownStatus} from '../../../services/core/session/shutdownState.js'
import {decideOverlap, overlapNote} from '../../../services/core/session/runOverlap.js'
import {rejectResponse} from '../../../services/core/session/runGate.js'
import llmUsageDac from '../../../daos/core/dac/llmUsageDac.js'

const logger = llm.logger
const tools = llm.tools

/**
 * @description 本副本没有这轮日志时，改从 Redis 镜像续接（跨副本 `/resume`）
 * @param {Object} p 参数
 * @param {String} p.messageCode 本轮标识
 * @param {Number} p.lastSeq 客户端游标
 * @param {Object} p.request fastify 请求
 * @param {Object} p.reply fastify 响应
 * @returns {Promise<Object|null>} 已处理返回 reply；镜像里没有这轮则返回 null（由调用方回不可用）
 *
 * 四条口径：
 * 1. **归属仍然要判**：镜像条目里没有 userCode，所以查 message 档案（`operator.userCode`，
 *    与 `feedback()` 同一口径）。**查不到档案就拒绝**——"验不了归属"不等于"归属没问题"，
 *    放行等于把别人的回答流交给任意拿到 messageCode 的人。
 * 2. **gap 与本地路径同一个形状**（都出自 `gapBodyOf`），前端只需一套分支。
 * 3. **没有直播**：本机连接不在，镜像只是历史。响应头 `x-run-final` 如实说明这轮结没结束，
 *    没结束就让客户端稍后再来，而不是在这里开一个轮询循环。
 * 4. 关着心跳（`pingIntervalMs: 0`）：这里写完就收，不会静默等人。
 */
async function resumeFromMirror({messageCode, lastSeq, request, reply}) {
    const cfg = llm.config.stream?.resume?.redis || {}
    if (cfg.enabled !== true) {
        return null
    }
    const r = await readRunEventLog({getClient: defaultGetClient, messageCode, lastSeq, cfg})
    if (!r.found) {
        /** 没键 / 读不了 / 没客户端：都交回调用方给统一的"不可用"码，别让原因散落在四个响应里 */
        return null
    }

    let owner = ''
    let conversationCode = ''
    try {
        const doc = await messageDac.getByCode(messageCode)
        owner = doc?.operator?.userCode || ''
        conversationCode = doc?.conversationCode || ''
    } catch (e) {
        logger.warn(`跨副本续接查档案失败: messageCode=${messageCode}, ${String(e?.message || e).slice(0, 140)}`)
    }
    if (!owner) {
        return reply.code(404).send({
            code: 'EVENT_LOG_UNAVAILABLE',
            msg: '镜像存在但无法核验归属（档案尚未落库），不予续接',
            reason: 'mirror-no-archive',
            messageCode,
            snapshotUrl: DEFAULT_SNAPSHOT_URL,
            snapshotRequest: {method: 'POST', url: DEFAULT_SNAPSHOT_URL, body: {filter: {messageCode}}},
            statusCode: 404,
        })
    }
    if (owner !== request.userInfo.userCode) {
        logger.warn(`跨副本续接越权拒绝: messageCode=${messageCode}, 归属=${owner}, 请求=${request.userInfo.userCode}`)
        const err = new Error('无权续接该消息的流')
        err.statusCode = 403
        throw err
    }

    if (r.gap) {
        return reply.code(410).send({...gapBodyOf({messageCode, gap: r.gap, conversationCode, source: 'redis'}), statusCode: 410})
    }

    const stream = reply.raw
    stream.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache,no-transform',
        'x-no-compression': 1,
        'x-run-last-seq': String(r.latest ?? 0),
        /** 这轮在别的副本上结没结束：让客户端知道要不要稍后再来取尾巴 */
        'x-run-final': r.final ? '1' : '0',
        'x-run-source': 'redis',
    })
    const channel = createSseChannel(stream, {
        pingIntervalMs: 0,
        onError: (e) => logger.warn(`跨副本续接写入失败: ${String(e?.message || e).slice(0, 160)}`),
    })
    for (const it of r.events) {
        channel.replay(it)
    }
    logger.info(`跨副本续接: messageCode=${messageCode}, lastSeq=${lastSeq}, 补发=${r.events.length}, `
        + `final=${r.final ? r.final.outcome : '-'}, user=${request.userInfo.userCode}`)
    channel.close()
    if (!stream.writableEnded) {
        stream.end()
    }
    return reply
}

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

        /**
         * P5：同一个会话已经有未终态 run 时怎么办（判据在 `runOverlap.js`，这里只接线）。
         *
         * 位置与并发闸同层是有原因的：`writeHead(200)` 之后就只能用 SSE 帧表达拒绝，
         * 而"这一轮根本没开始"与"开始了但被打断"是两件事，混在一个流里前端分不开。
         *
         * 数据源用账本的 `progress:'processing'` 行而不是进程登记表：`runRegistry` 每 worker 一份，
         * 两个标签页落到不同 worker 时进程内表会给出"没有并发"的**假读数**。
         *
         * 检测本身失败（库读不动）一律放行并 warn：把"我读不懂数据"变成"用户不能提问"是更坏的失败。
         */
        const overlapCfg = llm.config.limits?.runOverlap || {}
        let runOverlap = null
        if (overlapCfg.enabled !== false && request.reqParams?.conversationCode) {
            try {
                const prevOpen = await llmUsageDac.findOpenRun({
                    conversationCode: request.reqParams.conversationCode,
                    excludeMessageCode: messageCodeForGate,
                })
                const od = decideOverlap({
                    prev: prevOpen,
                    now: Date.now(),
                    windowMs: overlapCfg.windowMs,
                    reject: overlapCfg.reject,
                })
                runOverlap = overlapNote(od)
                if (!od.admit) {
                    const r = rejectResponse(od)
                    Object.entries(r.headers || {}).forEach(([k, v]) => reply.header(k, v))
                    logger.warn(`同会话重复拒绝: reason=${od.reason}, 上一轮=${od.prevMessageCode}, `
                        + `已跑ms=${od.ageMs}, userCode=${request.userInfo.userCode}, conversationCode=${request.reqParams.conversationCode}`)
                    /** 与并发闸同一套回法：200 + `success:false`，429 会让四端读不到这句话 */
                    return reply.code(r.httpStatus).send(r.body)
                }
                if (runOverlap) {
                    /** 放行但要说出来：这一轮的上下文里确实不可能有上一轮 */
                    logger.warn(`上一轮未终态就发起了新一轮（记录供界面说明）: 上一轮=${runOverlap.prevMessageCode}, `
                        + `已跑ms=${runOverlap.prevAgeMs}, reason=${runOverlap.reason}, conversationCode=${request.reqParams.conversationCode}`)
                }
            } catch (e) {
                logger.warn(`同会话重叠检测失败（放行，不影响这一轮）: ${String(e?.message || e).slice(0, 200)}`)
            }
        }

        const controller = new AbortController()
        const {signal} = controller
        /**
         * 通道句柄提前声明成 `let`：断开监听器要引用它，而监听器注册在通道创建之前。
         * 用 `const` 就地声明的话监听器里访问它就是 TDZ——同步代码踩不到，
         * 但"客户端在 writeHead 之后立刻断开"这种时序真会踩，而且是 ReferenceError。
         */
        let channel = null
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
            /**
             * 连接没了但**这一轮还活着**的两种情况都要转脱离态：
             * `client-disconnect`（停在下一个安全边界，之前还在产出）与
             * `shutdown-draining`（发版拆连接但不打断在途 run，会一路跑到完成）。
             * `orderly-close` 是响应正常写完，不需要也轮不到。
             */
            if (callSite.reason === 'client-disconnect' || callSite.reason === 'shutdown-draining') {
                const seqAt = channel?.detach()
                logger.info(`SSE 转入脱离态: messageCode=${messageCodeForGate}, 已记到 seq=${seqAt ?? '-'}, `
                    + `此后帧只入日志不写 socket（续接由 /stream/resume 负责）`)
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
        /**
         * PR-C：本轮的事件日志（/resume 的数据源），挂在通道的**写成功路径**上，
         * 所以记下的每一条都真的写出去过（与"号只在写成功时落下"是同一条纪律）。
         */
        const resumeCfg = llm.config.stream?.resume || {}
        const resumeEnabled = resumeCfg.enabled !== false
        const eventLog = resumeEnabled
            ? createRunEventLog({
                maxEvents: resumeCfg.maxEvents,
                maxBytes: resumeCfg.maxBytes,
                messageCode: messageCodeForGate,
                conversationCode: request.reqParams?.conversationCode,
            })
            : null
        if (eventLog) {
            /** 归属一起记下：续接时判越权用，此刻库里可能还没有这条 message */
            attachEventLog(messageCodeForGate, eventLog, {
                ttlMs: resumeCfg.ttlMs,
                userCode: request.userInfo.userCode,
                conversationCode: request.reqParams?.conversationCode,
            })
        }
        /**
         * Redis 镜像（跨副本续接的数据面）。**只在开了的时候才存在**，默认关（理由见 conf 那段注释）。
         * 它是旁路：写失败只计数，永远不影响这一轮回答。
         */
        const mirror = resumeCfg.redis?.enabled
            ? createRunEventMirror({
                getClient: defaultGetClient,
                messageCode: messageCodeForGate,
                cfg: resumeCfg.redis,
            })
            : null
        channel = createSseChannel(stream, {
            pingIntervalMs: llm.config.stream?.pingIntervalMs,
            onError: (e) => logger.warn(`SSE 写入失败（多半是客户端断开）: ${String(e?.message || e).slice(0, 160)}`),
            /** 入日志失败绝不打断流：丢了记录只是让续接报 gap，抛出去就是把一轮正常回答弄死 */
            onEmit: (seq, event, data) => {
                eventLog?.record(seq, event, data)
                /** 同步返回：镜像自己攒批，这里不能 await 一次 Redis 往返 */
                mirror?.onEvent(seq, event, data)
            },
        })
        let aborted = false
        /** 异常路径也要如实进镜像的终结标记（否则跨副本读到 error 收尾会被当成正常完成） */
        let errored = false
        try {
            const ret = await execChat(request.userInfo, request.reqParams.query, request.reqParams.conversationCode, {
                /**
                 * 把闸用的 messageCode 原样交给 run：
                 * 登记与注销必须是同一个键，否则要么额度永久泄漏，要么多减一次把别人的位置踩掉。
                 */
                ...request.reqParams.options, messageCode: messageCodeForGate,
                /** P5：路由在 writeHead 之前查到的"上一轮未终态"事实，交给 run 写进档案 */
                runOverlap,
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
            errored = true
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
            /** 标结束同样**不能放进闸的 if 里**：只有标了，TTL 才开始走、字节预算才把它当可淘汰对象 */
            if (eventLog) {
                finishEventLog(messageCodeForGate)
            }
        }
        /** 两侧的键都写上：reqId 接 HTTP 层日志，traceId（=messageCode）接 run 层日志与账本 */
        const finalSeq = channel.close()
        logger.info(`SSE 结束: reqId=${request.id}, seq=${finalSeq}, aborted=${aborted}`)
        stream.end()
        /** 反了会让"最后一帧已写出但没记录"，续接就少尾巴一帧 */
        eventLog?.close()
        if (mirror) {
            /**
             * 没有终结标记，另一副本读到"连续但没结束"的镜像时就无法区分
             * "这轮还在跑"与"镜像没写完就断了"——那种含糊会被读成成功。
             * 这里 await 是安全的：响应已经 flush 完，等的只是一次 Redis 往返，不是用户看到的时间。
             */
            const mirrorRet = await mirror.finish({
                finalSeq: Math.max(finalSeq, eventLog?.latest() || 0),
                outcome: errored ? 'error' : (aborted ? 'abort' : 'done'),
            })
            logger.info(`事件镜像收尾: messageCode=${messageCodeForGate}, 写出=${mirrorRet.written}, `
                + `失败=${mirrorRet.failed}, 键=${mirrorRet.key}`)
        }
        return reply
    })

    /**
     * PR-C：断线续接（D34 把它定为**可用性下限**，不是优化项）。
     *
     * 语义（§8.1 第一种 resume）：**无新输入**，只补发 `seq > lastSeq` 的已送达事件。
     * 三条不可让的口径：
     * 1. **gap 是一等返回**（§734）：缓冲过期/游标失效时给机器可读错误体，而不是裸 410，
     *    前端据此走快照重建；gap 时**一条事件都不发**——半套正文会被当成完整回答；
     * 2. 必须校归属：日志里记的是**这个进程里这一轮的原始帧**，含用户刚问的话与模型答的内容，
     *    任何人拿别人的 messageCode 就能读走——这与我们正在收口的"能读别人会话"是同一类缺陷；
     * 3. 日志在进程内 ⇒ **跨副本续不上是事实**，如实回 `EVENT_LOG_UNAVAILABLE`，
     *    不做"查不到就当成没断过"的假成功。
     */
    fastify.post('/stream/resume', {
        schema: {
            description: '断线后续接：按已收到的事件游标补发本轮剩余 SSE 事件（无新输入）',
            summary: '流式对话续接',
            tags: ['llm'],
            body: chatResumeBodySchema,
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const messageCode = request.reqParams?.messageCode
        /**
         * 游标来源有两个，优先体、退化到头：浏览器原生 EventSource 重连只带 `Last-Event-ID`，
         * 而我们的四端是手写 POST。两个都不给**不能当 0 处理**——0 意思是"从头全量重放"，
         * 那会让一次漏传参数变成整轮内容的流量放大，宁可 400。
         */
        const headerLast = Number(request.headers['last-event-id'])
        const rawLast = request.reqParams?.lastSeq ?? (Number.isInteger(headerLast) ? headerLast : undefined)
        if (rawLast === undefined || !Number.isInteger(Number(rawLast)) || Number(rawLast) < 0) {
            const err = new Error('缺少有效的游标：请提供 lastSeq（或 Last-Event-ID 头），值为已完整收到的事件号')
            err.statusCode = 400
            throw err
        }
        const lastSeq = Number(rawLast)

        const entry = getEventLogEntry(messageCode)
        if (!entry) {
            /**
             * 本副本没有 ⇒ 先试 Redis 镜像（这轮可能在别的副本上跑的）。
             * 顺序不能反：先查镜像会绕开本机日志的归属记录，而本机日志才是权威。
             */
            const remote = await resumeFromMirror({messageCode, lastSeq, request, reply})
            if (remote) {
                return remote
            }
            /** 未知/已过期/不在本副本：给可判别的码，前端与探针都能区分"这轮不存在"和"这轮在别的 pod 上" */
            return reply.code(404).send({
                code: 'EVENT_LOG_UNAVAILABLE',
                msg: '本轮事件日志不可用（已结束并过期、或该轮在别的副本上）',
                messageCode,
                /**
                 * 原来这里写的是 `/core/message/detail?messageCode=…`，而 `/core/message` 下
                 * 只注册了 `list` 与 `feedback`——**契约里指路的 URL 也是契约**，前端照着走会撞空。
                 * 这个分支里 `entry` 正是 null（正因如此才 404），所以没有 conversationCode 可给。
                 */
                snapshotUrl: DEFAULT_SNAPSHOT_URL,
                snapshotRequest: {
                    method: 'POST',
                    url: DEFAULT_SNAPSHOT_URL,
                    body: {filter: {messageCode}},
                },
                /** 必须显式写：不写 `preSerialization` 会补 `statusCode:200`，响应体就与 HTTP 状态不一致 */
                statusCode: 404,
            })
        }
        if (entry.userCode && entry.userCode !== request.userInfo.userCode) {
            logger.warn(`续接越权拒绝: messageCode=${messageCode}, 归属=${entry.userCode}, 请求=${request.userInfo.userCode}`)
            const err = new Error('无权续接该消息的流')
            err.statusCode = 403
            throw err
        }

        /**
         * 续接的帧必须带**原始号**，所以走 `channel.replay` 而不是 `emit`：
         * `emit` 会重新分配号，客户端的游标体系就会错位（要么漏事件，要么无限重放）。
         *
         * 顺序上有个坑，这里刻意绕开：`replayThenLive` 是**同步下发**补发帧的，
         * 若那时头还没写出去，帧就落在无头的响应上。所以先缓冲，判完再决定写什么：
         * - gap ⇒ 响应还没开始 ⇒ **直接回结构化 410**（这才叫"一等返回"，帧里塞 gap 是次品）；
         * - 无 gap ⇒ 写 SSE 头、把缓冲刷出去、继续直播。
         */
        /**
         * 单一订阅、两个阶段：补发期先进缓冲，写完 SSE 头之后**同一个回调**改为直发。
         * 为什么不用"cancel 掉再 subscribe 一次"：那样两次订阅之间产生的事件谁都没接住，
         * 而这段代码的风险恰恰全集中在"补发与直播的接缝"上。
         * 切换点安全是因为从 `replayThenLive` 到 `streaming = true` 之间没有 await，
         * 单线程下不可能有事件插进来。
         */
        const buffer = []
        let ended = false
        let streaming = false
        /** @type {Function|null} 帧写出器：写完 SSE 头才有通道，之前先进缓冲 */
        let writer = null

        /**
         * @description 日志条目的唯一出口
         * @param {Object} item 日志条目
         * @returns {void}
         */
        const onItem = (item) => {
            if (item.event === 'done' || item.event === 'abort' || item.event === 'error') {
                ended = true
            }
            if (streaming && writer) {
                writer(item)
            } else {
                buffer.push(item)
            }
        }

        const {cancel, result} = entry.log.replayThenLive(lastSeq, onItem)

        if (result.gap) {
            cancel()
            logger.info(`续接游标过期: messageCode=${messageCode}, lastSeq=${lastSeq}, oldest=${result.gap.oldest}`)
            /** `statusCode` 在这里补而不是写进 `gapBody()`：日志模块不该知道 HTTP 状态码 */
            return reply.code(410).send({...entry.log.gapBody(result.gap), statusCode: 410})
        }

        const stream = reply.raw
        stream.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache,no-transform',
            'x-no-compression': 1,
            /**
             * 本轮已产出的最大号：游标超前（客户端其实已经收全）时它能直接判定"无需重放"，
             * 不用等一个空流再自己猜。
             */
            'x-run-last-seq': String(entry.log.latest()),
        })
        const resumeChannel = createSseChannel(stream, {
            pingIntervalMs: llm.config.stream?.pingIntervalMs,
            onError: (e) => logger.warn(`续接写入失败（多半又断了）: ${String(e?.message || e).slice(0, 160)}`),
        })

        /** 重放保留原始号：走 `replay` 不走 `emit`（`emit` 会重新分配号，客户端游标就错位） */
        writer = (item) => resumeChannel.replay(item)
        for (const it of buffer) {
            writer(it)
        }
        /** 缓冲倒空、通道就绪：从这里起新事件直接写，不再进缓冲 */
        streaming = true

        let timer = null
        const stop = () => {
            cancel()
            resumeChannel.close()
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            if (!stream.writableEnded) {
                stream.end()
            }
        }
        stream.on('close', stop)

        if (ended || entry.finishedAt) {
            /**
             * 两种都直接收流：见终结帧 ⇒ 正常结束；该轮已结束却没见终结帧 ⇒
             * **日志里没有就是没有**，不补造一帧 `abort`。编造事件就是伪造事实，
             * 与回填那格修掉的"把推断当读数"是同一类错。
             */
            stop()
        } else {
            /**
             * run 还在跑：留着直播（`onItem` 已切成直发），直到终结帧或下面这个保险。
             * 定时器不是主路径——客户端在直播中再断开时我们不一定立刻察觉
             * （`write` 要到失败才走 `onError`），没有它这条连接可能一直挂着。
             */
            const idleMs = Number(llm.config.stream?.resume?.ttlMs) || 120000
            timer = setTimeout(() => {
                logger.info(`续接流超时收尾: messageCode=${messageCode}, seq=${entry.log.latest()}, ended=${ended}`)
                stop()
            }, idleMs)
            timer.unref?.()
        }
        logger.info(`续接开始: messageCode=${messageCode}, lastSeq=${lastSeq}, latest=${entry.log.latest()}, 补发=${buffer.length}, user=${request.userInfo.userCode}`)
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
            /**
             * PR-C 事件日志读数。内存涨了没人看得见的东西，必须在这里可见；
             * dropped.* 三个数是续接失败的原因分类（过期 / 超条数 / 超字节）。
             */
            eventLog: {
                ...eventLogStats(),
                enabled: llm.config.stream?.resume?.enabled !== false,
                ttlMs: llm.config.stream?.resume?.ttlMs,
                maxRuns: llm.config.stream?.resume?.maxRuns,
                maxTotalBytes: llm.config.stream?.resume?.maxTotalBytes,
                /**
                 * Redis 承载的开关与容量。镜像静默失败时聊天看起来一切正常，
                 * 只有这里能看出"跨副本续接现在到底有没有数据面"。
                 */
                redis: {
                    enabled: llm.config.stream?.resume?.redis?.enabled === true,
                    maxEvents: llm.config.stream?.resume?.redis?.maxEvents,
                    ttlSec: llm.config.stream?.resume?.redis?.ttlSec,
                    flushEvery: llm.config.stream?.resume?.redis?.flushEvery,
                    flushMs: llm.config.stream?.resume?.redis?.flushMs,
                    keyPrefix: llm.config.stream?.resume?.redis?.keyPrefix,
                },
            },
        }
    })
}
