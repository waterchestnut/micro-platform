/**
 * @fileOverview run 控制通道（PR-D 装配地基：/stop 与将来的 /steer 共用一条投递路径）
 * @module services/core/session/runControl
 * @description
 * 为什么必须走 redis pubsub 而不是"本地找 run 直接 abort"：**run 与 /stop 请求不保证落在同一个 worker**
 * （cw2pc 4 副本；`runRegistry` 每进程一份，本地表会给出"没有这个 run"的**假读数**——P5 的
  * runOverlap 注释立的同款事实）。所以：投递只有一条路（publish），每个 worker 的订阅端查本地把手——
 * "只在一部分路径生效的优化"就是"另一部分路径静默失效"的诞生方式。
 *
 * 分层与全部治理件同构：**纯判据**（通道命名、消息验证、投递决策、dispatch 状态机）与
 * **redis 传输**分离；传输的连接来源可注入（测试给假客户端走同一函数体，同 makeIntakeRunner 的家规）。
 * pubsub 无持久化：run 已结束 ⇒ 消息无接收者，/stop 的响应文案不许承诺"已停止"，只说"信号已投递"
 * （归属不明的结果不写成功——本档对日志与文案反复立的规矩）。/steer 同一条路：投递到 run 所在 worker
 * 的邮箱（steerMailbox.createRunMailbox），生效时机在 llmChat 的迭代边界——通道不做注入决策。
 */

/** 通道族前缀（stop/steer 共用一条订阅；分派靠消息里的 type，不靠第二条连接） */
export const CTL_FAMILY_PREFIX = 'chat:ctl:'
/** stop 通道前缀（改名等于换协议，测试钉死） */
export const STOP_CHANNEL_PREFIX = `${CTL_FAMILY_PREFIX}stop:`
/** steer 通道前缀（commit 2 新增；同族命名 = 前缀即类型，人肉扫频道也分得清） */
export const STEER_CHANNEL_PREFIX = `${CTL_FAMILY_PREFIX}steer:`
/** answer 通道前缀（commit 3：`/answer` 的答复投递，run 侧 router 是消费权威） */
export const ANSWER_CHANNEL_PREFIX = `${CTL_FAMILY_PREFIX}answer:`
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const CTL_TYPES = ['stop', 'steer', 'answer']
const CHANNEL_PREFIX_OF = {stop: STOP_CHANNEL_PREFIX, steer: STEER_CHANNEL_PREFIX, answer: ANSWER_CHANNEL_PREFIX}

function controlChannelFor(type, messageCode) {
    const id = String(messageCode || '')
    if (!SAFE_ID_RE.test(id)) {
        throw new Error(`${type} 通道拒绝该 messageCode（字符集/长度不合规）: ${JSON.stringify(id.slice(0, 40))}`)
    }
    return `${CHANNEL_PREFIX_OF[type]}${id}`
}

/**
 * @description 校验并生成 stop 通道名（messageCode 进频道名，字符集不过关必须抛而不是编码）
 * @param {String} messageCode run 标识
 * @returns {String} 频道名
 */
export function stopChannel(messageCode) {
    return controlChannelFor('stop', messageCode)
}

/**
 * @description steer 通道名（与 stop 同一条字符集闸——同一种注入风险不配两套标准）
 * @param {String} messageCode run 标识
 * @returns {String} 频道名
 */
export function steerChannel(messageCode) {
    return controlChannelFor('steer', messageCode)
}

/**
 * @description answer 通道名（同款字符集闸）
 * @param {String} messageCode run 标识（= 密封续体里的 runCode，不是自报的）
 * @returns {String} 频道名
 */
export function answerChannel(messageCode) {
    return controlChannelFor('answer', messageCode)
}

/**
 * @description 造控制消息（v 是协议位；type 分派 stop/steer；payload 只有 steer 用）
 * @param {Object} p {type, messageCode, actorCode, payload, now}
 * @returns {String} JSON 串
 */
export function buildControlMessage({type, messageCode, actorCode = '', payload = undefined, now = Date.now()} = {}) {
    if (!CTL_TYPES.includes(type)) {
        throw new Error(`buildControlMessage 不认识的 type: ${JSON.stringify(type)}`)
    }
    const msg = {v: 1, type, messageCode: controlChannelFor(type, messageCode).slice(CHANNEL_PREFIX_OF[type].length), actorCode: String(actorCode || ''), ts: Number(now)}
    if (payload !== undefined) {
        msg.payload = payload
    }
    return JSON.stringify(msg)
}

/**
 * @description 解析控制消息（坏消息 return {ok:false}——投递面的健壮性：一条烂 JSON 不许打断订阅）
 * @param {String} raw 消息体
 * @returns {{ok:true, value:Object}|{ok:false}} 结果；value.type ∈ CTL_TYPES，steer 带 value.payload
 */
export function parseControlMessage(raw) {
    try {
        const obj = JSON.parse(String(raw || ''))
        if (obj?.v !== 1 || !CTL_TYPES.includes(obj?.type) || !SAFE_ID_RE.test(String(obj?.messageCode || ''))) {
            return {ok: false}
        }
        const value = {type: obj.type, messageCode: String(obj.messageCode), actorCode: String(obj.actorCode || ''), ts: Number(obj.ts) || 0}
        if (obj.type !== 'stop') {
            value.payload = obj.payload
        }
        return {ok: true, value}
    } catch {
        return {ok: false}
    }
}

/**
 * @description 造 stop 消息（兼容封装：commit 1 的调用面不变）
 * @param {Object} p {messageCode, actorCode, now}
 * @returns {String} JSON 串
 */
export function buildStopMessage({messageCode, actorCode = '', now = Date.now()} = {}) {
    return buildControlMessage({type: 'stop', messageCode, actorCode, now})
}

/**
 * @description 解析 stop 消息（兼容封装：**steer 消息在这里必须判 ok:false**——
 *  只认 stop 的旧接线不能被新类型悄悄放行，测试钉着这条）
 * @param {String} raw 消息体
 * @returns {{ok:true, value:Object}|{ok:false}} 结果
 */
export function parseStopMessage(raw) {
    const r = parseControlMessage(raw)
    if (!r.ok || r.value.type !== 'stop') {
        return {ok: false}
    }
    return {ok: true, value: {messageCode: r.value.messageCode, actorCode: r.value.actorCode, ts: r.value.ts}}
}

/**
 * @description 订阅侧状态机（全类型）：坏消息弃、按 type 分派到本地把手、没有就 info（多 worker 里"不归我"是常态不是错误）
 * @param {Object} deps {takeAbort, takeSteerHandle, takeAnswerHandle, logger}
 * @returns {Function} (rawMessage) => 处理结果（测试直接喂）
 *
 * steer/answer 分支**不验 payload 形状**：入队闸在 steerMailbox.push、消费权威在 answerRouter
 * （各是各的唯一门）——这里再验一遍就是"同一判据两处实现"（ajv 三副本教训点名的形状）。
 * 两条 sink 分支同构：投给本地口、如实回报 accepted。取把手与执行全在 try 内：
 * 这是 redis 事件回调，任何异常逃逸都是 uncaughtException 候选。
 */
export function createControlDispatcher({takeAbort, takeSteerHandle, takeAnswerHandle, logger} = {}) {
    return (raw) => {
        const parsed = parseControlMessage(raw)
        if (!parsed.ok) {
            if (logger?.warn) logger.warn(`控制消息不合规，弃收: ${String(raw).slice(0, 80)}`)
            return {handled: false, reason: 'bad-message'}
        }
        const {type, messageCode, actorCode} = parsed.value
        try {
            if (type === 'stop') {
                const fn = typeof takeAbort === 'function' ? takeAbort(messageCode) : null
                if (typeof fn !== 'function') {
                    if (logger?.info) logger.info(`stop 不在本进程（正常：多副本各查各的）messageCode=${messageCode}`)
                    return {handled: false, reason: 'not-my-run'}
                }
                fn()
                if (logger?.warn) logger.warn(`stop 已执行 messageCode=${messageCode} actor=${actorCode || '?'}`)
                return {handled: true, reason: 'delivered'}
            }
            const taker = type === 'steer' ? takeSteerHandle : takeAnswerHandle
            const sink = typeof taker === 'function' ? taker(messageCode) : null
            if (typeof sink !== 'function') {
                if (logger?.info) logger.info(`${type} 不在本进程（正常：多副本各查各的）messageCode=${messageCode}`)
                return {handled: false, reason: 'not-my-run'}
            }
            const pushed = sink(parsed.value.payload)
            if (logger?.warn) logger.warn(`${type} 已投递 messageCode=${messageCode} actor=${actorCode || '?'} accepted=${Boolean(pushed?.accepted)}`)
            return {handled: true, reason: 'delivered', accepted: Boolean(pushed?.accepted), rejectError: pushed?.error || pushed?.reason}
        } catch (e) {
            if (logger?.error) logger.error(`控制消息执行抛错 type=${type} messageCode=${messageCode}: ${String(e?.message || e).slice(0, 120)}`)
            return {handled: false, reason: type === 'stop' ? 'abort-threw' : 'push-threw'}
        }
    }
}

/**
 * @description stop 专用分发器（兼容封装：commit 1 的调用面与四条出边不变）
 * @param {Object} deps {takeAbort, logger}
 * @returns {Function} (rawMessage) => 处理结果
 */
export function createStopDispatcher({takeAbort, logger} = {}) {
    return createControlDispatcher({takeAbort, logger})
}

/** —— 本地把手表（与并发闸的账**分概念**：闸关了 run 照样在跑、照样该能被停；
 *  把 stop 的可用性绑在 `limit>0` 上是把两个不相干的开关串成门禁串联。
 *  生命周期：/stream 的 controller 建立后 attach，finally 里 detach——
 *  **detach 无条件执行**，哪怕 stop 中途被关（attachArchive 同条教训）。 —— */
const handles = new Map()

/**
 * @description 登记本 worker 的控制把手
 * @param {Object} p {messageCode, abort, userCode, onSteer}——onSteer 可选：(payload)=>push 结果
 *  （stop 的可用性不绑 steer，反之也一样：两个开关各自独立接线，缺一个的降级面在 dispatcher 里是 not-my-run）
 * @returns {Boolean} 是否登记（无号/无 abort ⇒ false）
 */
export function attachHandle({messageCode, abort, userCode = '', onSteer = undefined, onAnswer = undefined} = {}) {
    if (!messageCode || typeof abort !== 'function') {
        return false
    }
    handles.set(String(messageCode), {
        abort,
        userCode: String(userCode || ''),
        onSteer: typeof onSteer === 'function' ? onSteer : null,
        onAnswer: typeof onAnswer === 'function' ? onAnswer : null,
        at: Date.now(),
    })
    return true
}

/**
 * @description 摘把手（幂等；不存在也不报错——finally 里不许藏新故障源）
 * @param {String} messageCode run 标识
 * @returns {Boolean} 是否真的摘掉过一个
 */
export function detachHandle(messageCode) {
    return handles.delete(String(messageCode || ''))
}

/**
 * @description 取把手（订阅侧唯一本地入口）；**取用不清除**——run 还在跑，
 *  重复 stop 信号应反复可用（幂等由 abort 本身保证：controller 二次 abort 是 no-op）
 * @param {String} messageCode run 标识
 * @returns {Function|null} abort 函数
 */
export function takeHandle(messageCode) {
    const h = handles.get(String(messageCode || ''))
    return typeof h?.abort === 'function' ? h.abort : null
}

/**
 * @description 取 steer 投递口（订阅侧唯一本地入口；同样**取用不清除**——邮箱活到 run 结束，
 *  每条插话各归各的边界，消费在 llmChat 的 pullBoundary 而不是这里）
 * @param {String} messageCode run 标识
 * @returns {Function|null} onSteer(payload) 函数；没挂 steer 的 run（steer 未启用）⇒ null
 */
export function takeSteerHandle(messageCode) {
    const h = handles.get(String(messageCode || ''))
    return typeof h?.onSteer === 'function' ? h.onSteer : null
}

/**
 * @description 取 answer 投递口（run 侧 answerRouter.deliver；同款"取用不清除"——
 *  一个 run 可以问多件事，每个 askId 各归各的 ledger）
 * @param {String} messageCode run 标识
 * @returns {Function|null} deliver 函数；没挂的 run（ask 未启用）⇒ null
 */
export function takeAnswerHandle(messageCode) {
    const h = handles.get(String(messageCode || ''))
    return typeof h?.onAnswer === 'function' ? h.onAnswer : null
}

/** 观测读数（并入 /runStats）：steerHandles = 挂了插话口的把手数（与 handles 的差即"只支持 stop 的 run"） */
export function controlSnapshot() {
    let steerHandles = 0
    let answerHandles = 0
    for (const h of handles.values()) {
        if (typeof h.onSteer === 'function') steerHandles++
        if (typeof h.onAnswer === 'function') answerHandles++
    }
    return {handles: handles.size, steerHandles, answerHandles}
}

/** 测试钩子 */
export function resetHandlesForTest() {
    handles.clear()
}

/** —— 以下是有状态传输层（连接对象注入；单例只允许一个订阅连接） —— */
let subState = {started: false, starting: null, client: null}

async function defaultRedis() {
    const mod = await import('../../../daos/cache/redisClient.js')
    return mod.default.client
}

/**
 * @description 投递 stop（fire-and-forget 的语义要如实：published=true 只代表进了 redis，不代表有人执行）
 * @param {Object} p {messageCode, actorCode, redisFactory?}
 * @returns {Promise<{published:Boolean, error?:String}>} 结果
 */
export async function publishStop({messageCode, actorCode = '', redisFactory = defaultRedis} = {}) {
    try {
        const client = await redisFactory()
        await client.publish(stopChannel(messageCode), buildStopMessage({messageCode, actorCode}))
        return {published: true}
    } catch (e) {
        return {published: false, error: String(e?.message || e).slice(0, 160)}
    }
}

/**
 * @description 投递 steer（与 publishStop 同一条路、同一个"已投递≠已生效"的如实语义——
 *  payload 原文搬运，归一化留在 run 侧的 mailbox.push：入队闸只有一道）
 * @param {Object} p {messageCode, actorCode, steer, redisFactory?}
 * @returns {Promise<{published:Boolean, error?:String}>} 结果
 */
export async function publishSteer({messageCode, actorCode = '', steer, redisFactory = defaultRedis} = {}) {
    try {
        const client = await redisFactory()
        await client.publish(steerChannel(messageCode), buildControlMessage({type: 'steer', messageCode, actorCode, payload: steer}))
        return {published: true}
    } catch (e) {
        return {published: false, error: String(e?.message || e).slice(0, 160)}
    }
}

/**
 * @description 投递 answer（同族同一条路。payload 里的 askId/responses 已在 /answer 路由开过密封续体，
 *  这里照搬不重验——消费权威在 run 侧 router）
 * @param {Object} p {messageCode, actorCode, answer, redisFactory?}
 * @returns {Promise<{published:Boolean, error?:String}>} 结果
 */
export async function publishAnswer({messageCode, actorCode = '', answer, redisFactory = defaultRedis} = {}) {
    try {
        const client = await redisFactory()
        await client.publish(answerChannel(messageCode), buildControlMessage({type: 'answer', messageCode, actorCode, payload: answer}))
        return {published: true}
    } catch (e) {
        return {published: false, error: String(e?.message || e).slice(0, 160)}
    }
}

/**
 * @description 确保本 worker 有控制订阅（run 登记时调用；幂等，失败后可再触发——不把订阅失败变成功能不可用，
 * 只是 stop/steer 到不了这个 worker，日志说清楚）。
 * 一条连接吃整个 `chat:ctl:*` 族：**每加一种控制类型就加一条订阅连接**是连接数的慢性泄漏，
 * 分派本来就在 dispatcher 的 type 上，订阅没必要按类型分家。
 * @param {Object} p {takeAbort, takeSteerHandle, takeAnswerHandle, logger, redisFactory?}
 * @returns {Promise<String>} 'ready' | 'already' | 'unavailable'
 */
export async function ensureRunControlSubscriber({takeAbort, takeSteerHandle, takeAnswerHandle, logger, redisFactory = defaultRedis} = {}) {
    if (subState.started) return 'already'
    if (subState.starting) return subState.starting
    const run = (async () => {
        try {
            const base = await redisFactory()
            const sub = base.duplicate()
            await sub.psubscribe(`${CTL_FAMILY_PREFIX}*`)
            sub.on('pmessage', (pattern, channel, raw) => {
                createControlDispatcher({takeAbort, takeSteerHandle, takeAnswerHandle, logger})(raw)
            })
            subState = {started: true, starting: null, client: sub}
            return 'ready'
        } catch (e) {
            if (logger?.warn) logger.warn(`控制订阅启动失败（本 worker 收不到跨进程 stop/steer，直到下次 run 再试）: ${String(e?.message || e).slice(0, 140)}`)
            subState = {started: false, starting: null, client: null}
            return 'unavailable'
        }
    })()
    subState = {started: false, starting: run, client: null}
    return run
}

/** 测试钩子（与 runRegistry.resetForTest 同名单约定） */
export function resetRunControlForTest() {
    subState = {started: false, starting: null, client: null}
}

export default {CTL_FAMILY_PREFIX, STOP_CHANNEL_PREFIX, STEER_CHANNEL_PREFIX, ANSWER_CHANNEL_PREFIX, stopChannel, steerChannel, answerChannel, buildControlMessage, parseControlMessage, buildStopMessage, parseStopMessage, createControlDispatcher, createStopDispatcher, attachHandle, detachHandle, takeHandle, takeSteerHandle, takeAnswerHandle, controlSnapshot, resetHandlesForTest, publishStop, publishSteer, publishAnswer, ensureRunControlSubscriber, resetRunControlForTest}
