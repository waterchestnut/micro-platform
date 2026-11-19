import {execChat, defaultChannel, defaultChannelGroup} from '../../../services/core/llmChat.js'
import {archiveUncaughtErrorTurn} from '../../../services/core/session/errorTurnArchive.js'
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
import {decideQueueOnOverlap, decideQueueOnStaleOpenRun} from '../../../services/core/session/turnScheduler.js'
import {rejectQueueFull} from '../../../services/core/session/taskAdmission.js'
import {buildIdemFilter, pickIdempotentHit, isDuplicateKeyError} from '../../../services/core/session/taskIdempotency.js'
import {decideFanOutEntry} from '../../../services/core/session/fanOutEntry.js'
import {buildSerializedTurnTask} from '../../../services/core/session/taskQueueComposer.js'
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
         * 任务模式入口（PR-任务编排 M4b c2；属主拍板**显式进**：前端开关 / 频道白名单，不做每条消息自动判定）。
         * 判据在纯件 `fanOutEntry.decideFanOutEntry`（可离线穷举），这里只接线。
         *
         * 位置在并发闸与 overlap **之前**，两个理由都是刻意的：
         * - planner 是一次最长 30s 的模型调用，让它占着并发闸的坑不划算；而扇出建树本来就不受 chat 闸计数
         *   （与建课等现网 agentTask 同语义）——它的边界是 `taskBudget` 的单 root 子任务上限（≤4），不是这里。
         * - 扇出不读会话历史（planner 只看本句 query），因此也不该被"上一轮还没完"拦住：
         *   用户可以在一条回答还在流的时候下一条任务。
         *
         * **失败一律落回普通回答**：功能没开、模型抖动、输出不合规——都不该让用户拿不到答案。
         * （漏判退化成一次普通回答＝无损；误判把用户的话拆成树＝事故。这条不对称与 `fanOutIntake` 同族。）
         *
         * ⚠️ 关时本块连 planner 服务都不加载：`fanOutPlannerService` 静态引 OpenAI SDK 且经 `core/agentTask`
         *   触到 redlock/kafka，与 `globalRunGate`/`redisClient` 同规——重模块绝不进默认热路径。
         */
        const plannerCfg = llm.config.agentTask?.fanOutPlanner || {}
        const fanOutEntryDecision = decideFanOutEntry({
            enabled: plannerCfg.enabled === true,
            taskMode: request.reqParams?.options?.taskMode,
            channel: reqChannel,
            entryChannels: plannerCfg.entryChannels || [],
        })
        if (fanOutEntryDecision.attempt) {
            const { planFanOutFromRequest } = await import('../../../services/agent/fanOutPlannerService.js')
            try {
                const planned = await planFanOutFromRequest({
                    query: request.reqParams.query,
                    conversationCode: request.reqParams.conversationCode,
                    operator: {userCode: request.userInfo.userCode, realName: request.userInfo.realName},
                    request: request.reqParams.options || {},
                    taskCode: request.reqParams.options?.taskCode, // §5-1 客户端幂等键（不传⇒无幂等，诚实默认）
                })
                if (planned.fanOut) {
                    logger.info(`任务模式受理: rootCode=${planned.rootCode}, 子任务=${planned.subtasks?.length || 0}, duplicate=${planned.duplicate === true}, `
                        + `via=${fanOutEntryDecision.via}, userCode=${request.userInfo.userCode}, conversationCode=${request.reqParams.conversationCode}`)
                    /**
                     * 200 + `success:true` + `data.taskAccepted`：**这一轮不是 SSE**（没有同步 run）。
                     * 前端据此显示"任务已受理"；综合结果落 `root:<rootCode>` 会话，可用
                     * `/core/message/list` 带该 conversationCode 取（过程区实时呈现属 M1-c/M8，
                     * 现在只有"终态可读"，没有"直播"——不假装）。
                     * §5-1：同 taskCode 重发命中幂等 ⇒ `duplicate:true` 指回原 rootCode（不二次调 planner、不建二树）。
                     */
                    return reply.code(200).send({
                        success: true, code: 0, msg: '',
                        data: {
                            taskAccepted: true, rootCode: planned.rootCode,
                            ...(planned.duplicate ? {duplicate: true} : {}),
                            subtasks: (planned.subtasks || []).map((s) => ({title: s.title, query: s.query})),
                        },
                    })
                }
                /** 判不拆 / planner 失败 ⇒ 往下走普通回答（用户的话绝不丢） */
                logger.info(`任务模式未成行(落回普通回答): reason=${planned.reason}, via=${fanOutEntryDecision.via}, conversationCode=${request.reqParams.conversationCode}`)
            } catch (e) {
                logger.error(`任务模式规划异常(落回普通回答): conversationCode=${request.reqParams.conversationCode} ${String(e?.message || e).slice(0, 300)}`)
            }
        } else if (fanOutEntryDecision.reason === 'task-mode-disabled') {
            /** 用户按了任务模式但服务端没开：这是部署事实不是用户错误 ⇒ 普通回答照给，但要说在日志里 */
            logger.warn(`收到 taskMode 但 fanOutPlanner 未启用(按普通回答处理): conversationCode=${request.reqParams.conversationCode}, userCode=${request.userInfo.userCode}`)
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
        /** 全局闸的句柄（开且占位成功才非 null）——finally 成对释放靠它 */
        let globalGate = null
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
            /**
             * 全局闸（PR-0.4）：`global.enabled` 不真值 ⇒ 这里连模块都不加载
             * （redisClient 是"import 即建连"的模块，绝不能被默认路径拖进来）。
             * 顺序刻意：**先局部后全局**——局部闸便宜且先削峰；全局拒了要**归还局部位**，
             * 不然每次全局拒绝都永久吃掉一格本地额度，finally 防的泄漏从这个分支同样成立。
             */
            if (gateCfg.global?.enabled === true) {
                const G = await import('../../../services/core/session/globalRunGate.js')
                const R = await import('../../../daos/cache/redisClient.js')
                const store = G.createRedisStore(R.default.client, gateCfg)
                const g = await G.admitGlobal({
                    store, messageCode: messageCodeForGate, userCode: request.userInfo.userCode, cfg: gateCfg, logger,
                })
                if (!g.admit) {
                    releaseRun(messageCodeForGate)
                    const r = g.response
                    Object.entries(r.headers || {}).forEach(([k, v]) => reply.header(k, v))
                    logger.warn(`全局闸拒绝: reason=${g.decision.reason}, active=${g.decision.active}, limit=${g.decision.limit}, userCode=${request.userInfo.userCode}, conversationCode=${request.reqParams?.conversationCode}`)
                    return reply.code(r.httpStatus).send(r.body)
                }
                globalGate = {mod: G, store}
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
                /**
                 * M1-b 会话任务队列（PR-任务编排，默认关）。两个入口（判据各自穷举）：
                 * 1. `runOverlap` 已判拒（1.5s 防重窗内双击）⇒ `decideQueueOnOverlap` 改判"持久入队返回
                 *    queued"，不丢单；开关关时**逐字走现网拒绝体**（"开关关=现网不变"的判据）。
                 * 2. **开闸测验实锤的第二入口（2026-11-19）**：overlap 放行但 `reason=stale-open-run`
                 *    （账本行还在 processing、只是过了防重窗）⇒ 心跳新鲜（<staleMs）就是"会话真忙"，
                 *    追问该排队而不是并发双跑——overlap 的窗只防双击，会话串行是队列层的职责。
                 *    判据在 `turnScheduler.decideQueueOnStaleOpenRun`；入队形状共用 `buildSerializedTurnTask`。
                 *
                 * ⚠️ 三条来自读码的硬约束（详见 handoff §3.0），别"顺手改回去"：
                 * 1. 入队用 `handleMode:'manual'`（`addAgentTask` 只在 queue 才投 Kafka）——consumer 无会话级串行，
                 *    投 queue 会在上一轮还活着时并发跑同一 conversationCode，正是 runOverlap 要防的竞态；
                 * 2. 执行体是 `turnRunner`（忠实重放用户轮）而非 `agentChat`（后者 memory:off，语义不符）；
                 * 3. `addAgentTask`/`agentTaskDac` 走**动态 import**：本文件的原则是重模块（kafka/redlock）
                 *    绝不进默认热路径（同 `globalRunGate`、`redisClient` 的处置），开关关时一行都不该加载。
                 *    计数查询也只在"可能入队"的两种判定下才跑（普通消息 no-prev 不付这笔钱）。
                 */
                const qCfg = llm.config.limits?.conversationTaskQueue || {}
                let queueDecision = null
                let addAgentTask = null
                let agentTaskDac = null
                let queueCount = 0
                if (qCfg.enabled === true && (!od.admit || od.reason === 'stale-open-run')) {
                    ;({addAgentTask} = await import('../../../services/core/agentTask.js'))
                    agentTaskDac = (await import('../../../daos/core/dac/agentTaskDac.js')).default
                    try {
                        queueCount = await agentTaskDac.getCount({
                            complexFilter: {conversationCode: request.reqParams.conversationCode, agentRole: 'serialized-turn', handleStatus: 0},
                        }) || 0
                    } catch { /* 读不到排队数按 0，是否放行交给 maxQueue 判定 */ }
                    if (!od.admit) {
                        queueDecision = decideQueueOnOverlap({
                            enabled: true, overlapAdmit: false, overlapReason: od.reason, queueCount, maxQueue: qCfg.maxQueue,
                        })
                    } else {
                        const hbAge = prevOpen?.updateTime ? Date.now() - new Date(prevOpen.updateTime).getTime() : null
                        queueDecision = decideQueueOnStaleOpenRun({
                            enabled: true, overlapReason: od.reason, prevHeartbeatAgeMs: hbAge,
                            queueCount, maxQueue: qCfg.maxQueue, staleMs: qCfg.staleMs,
                        })
                    }
                }
                if (queueDecision && queueDecision.decision === 'queue') {
                    /**
                     * §5-1 幂等：同一会话同一 messageCode（前端预生成码重发/网关重试同一请求体）只留一条等待行。
                     * 快路径=入队前预查；**并发终裁=partial-unique 索引**（uniq_serializedTurn_messageCode），
                     * 撞键回查胜者行 ⇒ 两次请求同一 rootCode。预查读失败不拦插入（"读不到"≠"不存在"）。
                     */
                    const idemFilter = buildIdemFilter({
                        conversationCode: request.reqParams.conversationCode,
                        agentRole: 'serialized-turn', keyField: 'messageCode', keyValue: messageCodeForGate,
                    })
                    try {
                        const hit = pickIdempotentHit({
                            rows: await agentTaskDac.getTop(5, idemFilter, {insertTime: 1}),
                            keyField: 'messageCode', keyValue: messageCodeForGate,
                        })
                        if (hit) {
                            logger.warn(`同会话追问重复入队(幂等回原 root): rootCode=${hit.agentCode}, conversationCode=${request.reqParams.conversationCode}`)
                            // 位次如实=含命中行自身的排队数（queueCount 本就只数库里行，不+1——它不是新请求）
                            return reply.code(200).send({success: true, code: 0, msg: '', data: {queued: true, idempotent: true, rootCode: hit.agentCode, queuePosition: Math.max(1, queueCount)}})
                        }
                    } catch { /* 预查失败照走插入，唯一索引兜底 */ }
                    try {
                        const turn = buildSerializedTurnTask({
                            conversationCode: request.reqParams.conversationCode,
                            messageCode: messageCodeForGate,
                            query: request.reqParams.query,
                            request: request.reqParams || {},
                            options: request.reqParams.options,
                            userInfo: request.userInfo,
                            operator: {userCode: request.userInfo?.userCode, realName: request.userInfo?.realName},
                            handler: 'turnRunner',
                        })
                        try {
                            await addAgentTask(turn) // manual ⇒ 落库但不自动派发，等 pump 在会话空闲时忠实重放
                        } catch (e) {
                            if (!isDuplicateKeyError(e)) throw e
                            const hit2 = pickIdempotentHit({
                                rows: await agentTaskDac.getTop(5, idemFilter, {insertTime: 1}),
                                keyField: 'messageCode', keyValue: messageCodeForGate,
                            })
                            if (!hit2) throw e // 报重复却回查无行：不装成功，落回拒绝给真话
                            logger.warn(`同会话追问重复入队(竞态幂等回原 root): rootCode=${hit2.agentCode}, conversationCode=${request.reqParams.conversationCode}`)
                            return reply.code(200).send({success: true, code: 0, msg: '', data: {queued: true, idempotent: true, rootCode: hit2.agentCode, queuePosition: Math.max(1, queueCount)}})
                        }
                        logger.warn(`同会话追问入队（排队非拒绝）: rootCode=${turn.agentCode}, 位次=${queueDecision.queuePosition}, `
                            + `上一轮=${od.prevMessageCode}, 已跑ms=${od.ageMs}, 入口=${od.admit ? 'stale-open-run' : 'overlap-reject'}, userCode=${request.userInfo?.userCode}, conversationCode=${request.reqParams.conversationCode}`)
                        /** 200 + success:true：这是"已受理并排队"，不是错误；前端据 `data.queued` 进排队态（呈现属 M1-c） */
                        return reply.code(200).send({success: true, code: 0, msg: '', data: {queued: true, rootCode: turn.agentCode, queuePosition: queueDecision.queuePosition}})
                    } catch (e) {
                        /** 入队失败绝不谎称已排队：落回现网拒绝，用户至少拿到一句真话 */
                        logger.error(`同会话追问入队失败，退回拒绝: conversationCode=${request.reqParams.conversationCode} ${String(e?.message || e).slice(0, 200)}`)
                    }
                } else if (queueDecision && queueDecision.reason === 'queue-full') {
                    /**
                     * 队列满：回 **4292 专用拒绝体**（`rejectQueueFull` 单源形态：200+success:false，
                     * 非 2xx 各端读不到体）。active/limit 带上真实队列数与上限——前端要能说明
                     * "排队已满（N/上限）"，这与 4291"上一条还在处理中"是两句不同的真话。
                     * 造不出拒绝体（形状漂移⇒null）时落回 4291 体：宁可话不精确，不可无话。
                     */
                    logger.warn(`同会话排队已满，拒绝本轮: reason=${queueDecision.reason}, maxQueue=${qCfg.maxQueue}, 队列数=${queueCount}, conversationCode=${request.reqParams.conversationCode}`)
                    const rq = rejectQueueFull({...queueDecision, active: queueCount, limit: qCfg.maxQueue})
                    if (rq) {
                        Object.entries(rq.headers || {}).forEach(([k, v]) => reply.header(k, v))
                        return reply.code(rq.httpStatus).send(rq.body)
                    }
                }
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
        /** 打断信号从这里交给 run；`signal` 必须在 close 监听之后仍然可用（旧写法是解构在监听前，别退回） */
        const {signal} = controller
        /**
         * PR-D /stop + /steer：把手表登记 + 本 worker 确保有控制订阅（任一开关开才做任何事）。
         * 与并发闸无关——闸管"能不能再开一个 run"，这里管"开着的这个能不能被停/被插话"。
         * 订阅失败只意味着**本 worker** 收不到跨进程信号（下次 run 再试），不打断这一轮。
         * 组合读法：steer 开而 stop 关时把手照带 abort——那是本 worker 唯一的终止把手，
         * 关掉的是**发布侧**（/stop 路由 4003），不是把手本身；直连 redis 的发布方本来就在信任边界外。
         */
        const ctlCfg = llm.config.controlConfig || {}
        const stopOn = ctlCfg.stopEnabled === true
        const steerOn = ctlCfg.steerEnabled === true
        const askOn = ctlCfg.askEnabled === true
        let runMailbox = null
        let answerRouter = null
        /**
         * hard steer 的停止位（PR-D commit 2b）。刻意**不是** AbortController：
         * drain 的 break 会经 iterator.return 关连接（停花钱等价，shutdown 抢救已实战验证），
         * 而子 signal 的 APIUserAbortError 会在 withUpstreamRetry 里被误判成"可重试的网络断"——
         * 首字前打断还要把刚被插话打断的那次调用重发一遍，那才是这刀真正危险的错误面。
         * 三道闸缺一不可：
         *  · mode==='hard'（soft 不该掐任何东西）；
         *  · hardSteerEnabled（路由侧同判据的兜底：两闸同一次配置加载，翻一侧红另一侧红不了）；
         *  · **active（生成窗闸）**——置位只发生在主循环 create→drain 窗口，finalize/self-check/
         *    工具执行期的 hard 一律排队走 postTools 边界（与 llmLoop.steerAction 的阶段裁决同构：
         *    打断只属于 generating；tool_executing 期置位会烧掉下一轮的首帧调用）。
         */
        let hardSteer = null
        if (stopOn || steerOn || askOn) {
            const RC = await import('../../../services/core/session/runControl.js')
            if (steerOn) {
                const SB = await import('../../../services/core/session/steerMailbox.js')
                hardSteer = {flag: null, active: false}
                runMailbox = SB.createRunMailbox({
                    maxQueue: Number(ctlCfg.steerMaxQueue) || undefined,
                    onAccept: (s) => {
                        if (s.mode === 'hard' && ctlCfg.hardSteerEnabled === true && hardSteer.active) {
                            hardSteer.flag = 'hard-steer'
                        }
                    },
                })
            }
            /**
             * PR-E：答复路由器在这里建（run 侧），`/answer` 从任何 worker 投递都汇到这一个实例——
             * 一次性消费与先到先得的**权威账本**只认它（路由侧预检只是快速失败）。
             * 密钥缺失照常建 router：到 awaitAskUser 的 no-signing-secret 如实降级，
             * 把"能问不能答"配错的爆炸半径留在可见的错误里，不做成静默关功能。
             */
            if (askOn) {
                const AT = await import('../../../services/core/session/askUserTool.js')
                answerRouter = AT.createAnswerRouter({
                    runCode: messageCodeForGate,
                    initiator: request.userInfo?.userCode || '',
                    secret: AT.answerSecret(),
                    logger,
                    /** P-19：deliver 终局走 run 自己的 SSE 通道发 answer_ack（进 eventLog，/resume 可见）；channel 未建的窗口只丢事件不丢账 */
                    emitAck: (ack) => {
                        if (channel) {
                            channel.emit(JSON.stringify({...ack, messageCode: messageCodeForGate}), 'answer_ack')
                        }
                    },
                })
            }
            RC.attachHandle({
                messageCode: messageCodeForGate,
                abort: () => controller.abort(),
                userCode: request.userInfo?.userCode,
                onSteer: runMailbox ? (payload) => runMailbox.push(payload) : undefined,
                onAnswer: answerRouter ? (payload) => answerRouter.deliver(payload) : undefined,
            })
            await RC.ensureRunControlSubscriber({takeAbort: RC.takeHandle, takeSteerHandle: RC.takeSteerHandle, takeAnswerHandle: RC.takeAnswerHandle, logger})
        }


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
                /** PR-D commit 2：soft 插话的收件箱（steerEnabled 关时为 null，主循环连判断都是一次假值短路） */
                runMailbox,
                /** PR-D commit 2b：hard 打断的停止位（{flag, active}；同上 null 语义） */
                hardSteer,
                /** PR-E：ask_user 的答复路由器（askEnabled 关时为 null ⇒ llmChat 连工具都不注册） */
                answerRouter,
            })

            aborted = ret === 'aborted'
            channel.emit(aborted ? 'aborted' : 'done', aborted ? 'abort' : 'done')
        } catch (err) {
            /**
             * 原来这里是 `console.error(err)`。问题不在于"用了 console"，
             * **而在于那一行没有任何归属字段**：不带 reqId、不带 messageCode、不带 conversationCode，
             * 而 `logger` 也没有接管 console（全仓搜不到 `console.error =` 之类的改写），
             * 所以它进了容器 stdout 就等于没进日志——dev 库里那批"有会话、无消息"的残留之所以无法归因，
             * 根子就在这条路上（不只是"日志留存期过了"：本来就没写下可对账的线索）。
             *
             * 现在走本仓既有的路由约定 `request.log`（fastify 请求级 logger，自带 reqId，
             * 见 plugins/format-reply.js 与 routes/core/agentTask/root.js），
             * 并把 messageCode / conversationCode 显式带上——**归属信息必须在事件本身里，不能指望读的人去猜**。
             * 与母本 xxzx.llm.api 同一轮改：两侧都是这条错误路径，单边改完 cw2pc 照旧。
             *
             * 这里补的是 P8 处置 ②：**仅当这一轮一行档案都没落时**，补一条 `progress:'error'` 的行。
             * 判据与写库都在 `session/errorTurnArchive.js`，这里只负责"要不要叫它"与"把结果记进日志"：
             * 已有档案（run 自己的 catch 落的）不覆盖、会话还没建起来的不造行、账本收尾走条件更新。
             * 顺序是刻意的：**先把 error 帧发给用户，再补档**——补档是一次数据库写，
             * 让它挡在用户能看见的那句话前面，就是拿体验换排障。
             */
            request.log.error({
                messageCode: messageCodeForGate,
                conversationCode: request.reqParams?.conversationCode || '',
                errName: String(err?.name || ''),
                errMessage: String(err?.message || err).slice(0, 300),
                errStack: String(err?.stack || '').slice(0, 800),
            }, 'chat/stream 未捕获异常（本轮可能没有档案行）')
            errored = true
            channel.emit(err.message || '处理出错，请稍等再试', 'error')
            /**
             * 补写档案。这个调用**不会抛**（内部把所有失败收成返回值），所以不写在 try 里；
             * 返回值一律记下来：`skip:archive-exists` 与 `written` 是两件不同的事实，
             * 只写"补档完成"就会把"其实什么都没写"混进去。
             */
            const archived = await archiveUncaughtErrorTurn({
                messageCode: messageCodeForGate,
                conversationCode: request.reqParams?.conversationCode || '',
                query: request.reqParams?.query || '',
                options: request.reqParams?.options || {},
                userInfo: request.userInfo,
                err,
                defaultChannel,
                defaultChannelGroup,
            })
            request.log[archived.action === 'written' ? 'warn' : 'info']({
                messageCode: messageCodeForGate,
                conversationCode: archived.conversationCode,
                action: archived.action,
                reason: archived.reason,
                ledger: archived.ledger || '',
            }, 'chat/stream 未捕获异常的补档结果')
        } finally {
            /**
             * **注销放在 finally 是这条链上唯一的保险**：正常收尾、上游抛错、客户端断开、
             * `streamCallback` 写失败都会走到这里。少一次注销，闸就永久少一格，
             * 症状是"用久了整站变慢"，看起来完全不像自己写的 bug。
             */
            if (Number(gateCfg.limit) > 0) {
                releaseRun(messageCodeForGate)
            }
            /** 局部位与全局位**成对归还**（同一条"少一次注销=闸永久少一格"的保险，只是另一张账本） */
            if (globalGate) {
                await globalGate.mod.releaseGlobal({
                    store: globalGate.store, messageCode: messageCodeForGate, userCode: request.userInfo.userCode, logger,
                })
            }
            /**
             * stop 把手**无条件摘**，不放进 `if (stopEnabled)`：今天关闸的 run 也可能在结束时
             * 开关刚被翻过（进程内配置只读一次的话不存在，但 attach 的逆操作写成条件版
             * 就是在复刻 detachArchive 被点名的那个错）。import 是缓存的，代价可忽略。
             */
            {
                const RC = await import('../../../services/core/session/runControl.js')
                RC.detachHandle(messageCodeForGate)
            }
            /**
             * run 结束时邮箱里还有货 ⇒ 这些插话永远不会被注入了（pubsub 无持久化，随进程死）。
             * 不静默：用户收到的每个 /steer 响应都只承诺过"已投递"，这条日志是"投递≠生效"的另一半账。
             */
            if (runMailbox && runMailbox.size() > 0) {
                logger.warn(`run 结束仍有未消费插话 messageCode=${messageCodeForGate}, 队列=${runMailbox.size()}, 邮箱账=${JSON.stringify(runMailbox.stats)}`)
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
     * PR-D /stop：停掉一个在途 run（跨 worker 经控制通道投递，见 session/runControl）。
     * 三条纪律都在这条小路由上：
     * 1. **防枚举**："不存在 / 已终态 / 不是你的" 三种情况回**同一个 403 同一句话**
     *    （messageAccess.test:46 立的成文规矩——能区分"这号存在但不归你"的接口就是活跃账号探测器）；
     * 2. 开关关 ⇒ 明说未启用（不是拒绝，是没这功能——别让用户界面把配置问题当权限问题排查）；
     * 3. 响应只承诺"信号已投递"，不承诺"已停止"——pubsub 无回执，运行与否以账本终态为准
     *    （归属不明的结果不写成功，同日志纪律）。
     */
    fastify.post('/stop', {
        schema: {
            description: '请求中止一个在途 run（仅本人、仅 processing 中的轮次）',
            summary: '停止本轮生成',
            tags: ['llm'],
            body: {
                type: 'object',
                properties: {messageCode: {type: 'string', description: '要停止的 run 标识（= 该轮 messageCode）'}},
                required: ['messageCode'],
            },
            response: {},
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const ctlCfg = llm.config.controlConfig || {}
        if (ctlCfg.stopEnabled !== true) {
            return reply.code(200).send({success: false, code: 4003, msg: '停止功能未启用（control_stopEnabled）'})
        }
        const {messageCode} = request.reqParams || {}
        const row = await llmUsageDac.findProcessingByMessageCode(messageCode).catch((e) => {
            logger.error(`/stop 查账失败 messageCode=${String(messageCode).slice(0, 64)}: ${String(e?.message || e).slice(0, 140)}`)
            return null
        })
        if (!row || row.userCode !== request.userInfo.userCode) {
            /** 两种情形故意不可区分（见头注第 1 条） */
            return reply.code(403).send({success: false, code: 4030, msg: '无法停止该轮：不存在、已结束或不属于当前用户'})
        }
        const RC = await import('../../../services/core/session/runControl.js')
        const sent = await RC.publishStop({messageCode: row.messageCode, actorCode: request.userInfo.userCode})
        if (!sent.published) {
            logger.warn(`/stop 投递失败 messageCode=${row.messageCode}: ${sent.error}`)
            return reply.code(200).send({success: false, code: 4003, msg: '停止信号未能投递（控制通道不可用），请稍后重试'})
        }
        return {success: true, data: {messageCode: row.messageCode, delivered: 'broadcast', note: '停止信号已投递；是否已停以该轮档案终态为准'}}
    })

    /**
     * PR-D /steer（commit 2，soft）：往在途 run 投一句话，主循环在迭代边界注入（见 llmChat 的 pullBoundary）。
     * 与 /stop 共享的纪律：防枚举同文案、开关关回 4003、投递失败如实回错不 500。
     * steer 特有的三条：
     * 1. **说话人取自身份，不收 body 字段**——一个能"冒充别人插话"的接口等于给未鉴权网关发明伪造面；
     * 2. 判序是"先归属后内容"：若先拒坏文本再查归属，一条空 text 就能拿 400/403 之差探测 run 存在性；
     *    归属过了之后 400 带拒因**只关于自己的话**，不含对方信息；
     * 3. 校验复用 normalizeSteerMessage——路由侧是 fail-fast 与身份覆盖，mailbox 侧 push 再走一遍同一函数
     *    兜住直发通道的人；两处同一个函数，判据不漂移。
     * 响应只承诺"已投递控制通道"：边界来不来、迟到几分钟、会不会被判陈旧而弃，都不是路由此刻能知道的。
     */
    fastify.post('/steer', {
        schema: {
            description: '向在途 run 插话（仅本人、仅 processing 中的轮次；soft 在迭代边界注入）',
            summary: '插话本轮生成',
            tags: ['llm'],
            body: {
                type: 'object',
                properties: {
                    messageCode: {type: 'string', description: '目标 run 标识（= 该轮 messageCode）'},
                    text: {type: 'string', description: '插话内容（单行语义，换行会被折成空格）'},
                    mode: {type: 'string', description: 'soft|hard，默认 soft（hard 需 control_hardSteerEnabled 开闸；关着回 400 拒收，不降级成 soft）'},
                    steerCode: {type: 'string', description: '客户端幂等键（重复投递只注入一次）'},
                },
                required: ['messageCode', 'text'],
            },
            response: {},
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const ctlCfg = llm.config.controlConfig || {}
        if (ctlCfg.steerEnabled !== true) {
            return reply.code(200).send({success: false, code: 4003, msg: '插话功能未启用（control_steerEnabled）'})
        }
        const {messageCode, text, mode, steerCode} = request.reqParams || {}
        const row = await llmUsageDac.findProcessingByMessageCode(messageCode).catch((e) => {
            logger.error(`/steer 查账失败 messageCode=${String(messageCode).slice(0, 64)}: ${String(e?.message || e).slice(0, 140)}`)
            return null
        })
        if (!row || row.userCode !== request.userInfo.userCode) {
            /** 与 /stop 同款：三种被拒情形故意不可区分 */
            return reply.code(403).send({success: false, code: 4030, msg: '无法插话该轮：不存在、已结束或不属于当前用户'})
        }
        const SB = await import('../../../services/core/session/steerMailbox.js')
        const n = SB.normalizeSteerMessage({
            text, mode, steerCode,
            userCode: request.userInfo.userCode,
            realName: request.userInfo.realName,
        }, {})
        if (!n.ok) {
            return reply.code(400).send({success: false, code: 4000, msg: `插话被拒：${n.error}`})
        }
        /**
         * hard 未开闸 ⇒ 逐条拒这一句并说清原因。刻意**不降级成 soft**：mode 决定打断与否，
         * 把 hard 悄悄跑成 soft = "该打断没打断"——normalize 从严拒的裁定在这条路由上同款执行。
         * 位置在归属核验之后 ⇒ 400 里不含任何对方存在性信息。
         */
        if (n.value.mode === 'hard' && ctlCfg.hardSteerEnabled !== true) {
            return reply.code(400).send({success: false, code: 4000, msg: 'hard 插话未启用（control_hardSteerEnabled），本条未入队'})
        }
        const RC = await import('../../../services/core/session/runControl.js')
        const sent = await RC.publishSteer({messageCode: row.messageCode, actorCode: request.userInfo.userCode, steer: n.value})
        if (!sent.published) {
            logger.warn(`/steer 投递失败 messageCode=${row.messageCode}: ${sent.error}`)
            return reply.code(200).send({success: false, code: 4003, msg: '插话未能投递（控制通道不可用），请稍后重试'})
        }
        return {success: true, data: {messageCode: row.messageCode, steerCode: n.value.steerCode, delivered: 'broadcast', note: '插话已投递控制通道；是否注入以 steer_ack 事件为准'}}
    })

    /**
     * PR-E /answer：回答一次 ask_user 挂起（跨 worker 经控制通道投给 run 侧 router）。
     * 判序是安全结构，不是风格：
     * 1. **requestState 就是凭证**（服务端签名、含 runCode/askId/kind）——开不了 ⇒ 统一 403，
     *    不解释"签名错/过期/不存在"（这是对外唯一的模糊面，内部原因进日志）；
     * 2. 信密封里的 runCode，不信 body 的任何自报；账本 owner 核验与 /stop 同源；
     * 3. **路由侧参与者预检只认 ledger owner（participants 数据源未建，保守方向）**，
     *    kind=approval 非发起人在这里就拒——但**裁决权威在 run 侧 router**
     *    （先到先得的 `alreadyAnsweredBy` 账只在 run 的内存里，跨 worker 无从复制）；
     * 4. 响应只承诺"已投递"：你的答复**被采用还是迟到**，要等 run 侧的账，这里给不了答案
     *    （迟到者的 notice 通道待多人协议窗口，不发明事件——同 channel-scope defer 的裁定家族）。
     */
    fastify.post('/answer', {
        schema: {
            description: '回答一次 ask_user 挂起（回传 await_input 的 inputResponses + requestState 原样）',
            summary: '回答挂起的提问',
            tags: ['llm'],
            body: {
                type: 'object',
                properties: {
                    requestState: {type: 'string', description: 'await_input 下发的密封续体（原样回传）'},
                    inputResponses: {type: 'object', description: '对 form 问题的作答（未知键会被拒）'},
                    answerCode: {type: 'string', maxLength: 64, description: '可选：调用方对账标识，answer_ack 原样带回'},
                },
                required: ['requestState', 'inputResponses'],
            },
            response: {},
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const ctlCfg = llm.config.controlConfig || {}
        if (ctlCfg.askEnabled !== true) {
            return reply.code(200).send({success: false, code: 4003, msg: '提问/回答功能未启用（control_askEnabled）'})
        }
        const {requestState, inputResponses, answerCode} = request.reqParams || {}
        const AT = await import('../../../services/core/session/askUserTool.js')
        const MP = await import('../../../services/core/session/mrtrPayload.js')
        const refuse = () => reply.code(403).send({success: false, code: 4030, msg: '无法处理该答复：凭证无效、已被使用或不属于当前用户'})
        const opened = MP.openRequestState(requestState, {secret: AT.answerSecret()})
        if (!opened.ok) {
            logger.warn(`/answer 续体校验失败 actor=${request.userInfo.userCode}: ${opened.error}`)
            return refuse()
        }
        const state = opened.value
        const row = await llmUsageDac.findProcessingByMessageCode(state.runCode).catch((e) => {
            logger.error(`/answer 查账失败 runCode=${String(state.runCode).slice(0, 64)}: ${String(e?.message || e).slice(0, 140)}`)
            return null
        })
        if (!row || row.userCode !== request.userInfo.userCode) {
            return refuse()
        }
        const adm = MP.decideAnswerAdmission({
            kind: state.kind === 'approval' ? 'approval' : 'question',
            answerer: request.userInfo.userCode,
            initiator: row.userCode,
            participants: [],
        })
        if (!adm.admit) {
            logger.warn(`/answer 预检拒绝 reason=${adm.reason} runCode=${state.runCode}`)
            return refuse()
        }
        const RC = await import('../../../services/core/session/runControl.js')
        const sent = await RC.publishAnswer({
            messageCode: state.runCode,
            actorCode: request.userInfo.userCode,
            answer: {askId: state.askId, responses: inputResponses, answeredBy: request.userInfo.userCode, requestState: String(requestState), answerCode: String(answerCode || '')},
        })
        if (!sent.published) {
            logger.warn(`/answer 投递失败 runCode=${state.runCode}: ${sent.error}`)
            return reply.code(200).send({success: false, code: 4003, msg: '答复未能投递（控制通道不可用），请稍后重试'})
        }
        return {success: true, data: {runCode: state.runCode, askId: state.askId, delivered: 'broadcast', note: '答复已投递；是否被采用（先到先得）以该轮工具结果为准'}}
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
        const ctlSnap = (await import('../../../services/core/session/runControl.js')).controlSnapshot()
        /**
         * §5-4 后半：调用者**本人**当日的消耗读数（credits 三值语义：null=当日只有历史/未知计价行，
         * 不是免费）。只查自己的账——日汇总若可传任意 userCode 就变成枚举他人消耗的面，与禁 byUser 同理。
         */
        const {getUserDailyUsage} = await import('../../../services/core/usageStats.js')
        const usageDaily = await getUserDailyUsage(request.userInfo.userCode, new Date().toISOString().slice(0, 10))
            .catch((e) => ({error: String(e?.message || e).slice(0, 160)}))
        return {
            usageDaily,
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
            /** PR-D stop/steer/answer 的本地读数（只有把手数——不返回任何 messageCode/userCode，理由同上禁枚举） */
            stopHandles: ctlSnap.handles,
            steerHandles: ctlSnap.steerHandles,
            answerHandles: ctlSnap.answerHandles,
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
