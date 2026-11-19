/**
 * @fileOverview 会话任务队列的准入判定（PR-任务编排 M1-a，纯函数）
 * @module services/core/session/taskAdmission
 * @description
 * 与 `runGate.js` 的分工：runGate 判"这一轮 run 能不能**立即开始**、超了就 4290/4291 拒"；
 * 这里判"会话模式下这个任务**能不能开始、还是排队等额度**"。核心差别是——**有队列之后，
 * 超容量默认是排队(queue)不是拒绝(reject)**。`runGate.js` 文件头立过"没队列前不许偷偷排队"，
 * 它反对的是"没有队列语义时的隐式排队"；本模块的前提正是队列已存在（agentTask waiting 行 +
 * 可见排队态），所以排队在这里是正当的一等状态，不是那个被禁止的东西。
 *
 * 判定与计数/IO 分离（照 runGate）：调用方从 `globalRunGate`/账本读来 active/queue 计数喂进来，
 * 这里只做纯决策，可离线穷举。三层额度任一吃满 ⇒ queue；队列也满 ⇒ reject（唯一拒绝面）。
 *
 * 顺序口径（不要"顺手优化"）：
 * 1. 先 subtask（一个 root 并行子智能体上限）——它是最贴近"这次 fan-out 会不会失控"的闸；
 * 2. 再 conversation（单会话并发）——防一个人把某会话灌爆；
 * 3. 再 user / global——总量与公平；
 * 4. 队列深度最后——只有队列本身满了才 reject（这是"真拒绝"，不是"忙"）。
 *
 * 关闸口径沿用 runGate：`limit<=0/NaN` 视作**这一层不限**，而不是"一个都不许"；全 0 ⇒ admit。
 * 关闸时观测字段照带（读数不因功能没开就消失）。
 */

/** 队列也满、彻底拒绝：与 4290/4291 分开编号，客户端可对"忙(排队)"与"满(拒)"分别处理 */
export const QUEUE_FULL_REJECT_CODE = 4292

/**
 * @description 决定会话模式下这个任务能否开始
 * @param {Object} [p] 参数（计数由调用方读账本/闸喂入）
 * @param {Number} [p.subtaskActive] 该 root 当前在跑的并行子任务数
 * @param {Number} [p.subtaskLimit] 单 root 子任务上限（属主拍板默认 4；<=0=不限）
 * @param {Number} [p.conversationActive] 该会话当前活跃 run 数
 * @param {Number} [p.conversationLimit] 单会话并发上限（默认 8；<=0=不限）
 * @param {Number} [p.userActive] 该用户跨会话活跃 run 数
 * @param {Number} [p.userLimit] 单用户上限（<=0=不限）
 * @param {Number} [p.globalActive] 全局在途 run 数
 * @param {Number} [p.globalLimit] 全局上限（<=0=不限；PM2 下调用方应用 redis 一份账）
 * @param {Number} [p.queueDepth] 该会话当前排队中的任务数
 * @param {Number} [p.maxQueue] 队列上限（<=0=不限）
 * @param {Number} [p.retryAfterMs] 排队时的建议重探间隔
 * @returns {{action:'proceed'|'queue'|'reject', admit:Boolean, code:Number, reason:String,
 *            retryAfterMs:Number, limitedBy:(String|null), active:Number, limit:Number}} 判定
 */
export function decideTaskAdmission({
    subtaskActive = 0, subtaskLimit = 0,
    conversationActive = 0, conversationLimit = 0,
    userActive = 0, userLimit = 0,
    globalActive = 0, globalLimit = 0,
    queueDepth = 0, maxQueue = 0,
    retryAfterMs = 1500,
} = {}) {
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
    const cnt = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

    // 三层容量闸：命中 ⇒ 进队列（不是拒绝），除非队列本身也满
    const tiers = [
        { key: 'subtask', active: cnt(subtaskActive), limit: num(subtaskLimit) },
        { key: 'conversation', active: cnt(conversationActive), limit: num(conversationLimit) },
        { key: 'user', active: cnt(userActive), limit: num(userLimit) },
        { key: 'global', active: cnt(globalActive), limit: num(globalLimit) },
    ]
    const saturated = tiers.find((t) => t.limit > 0 && t.active >= t.limit)

    if (!saturated) {
        return { action: 'proceed', admit: true, code: 0, reason: 'ok', retryAfterMs: 0, limitedBy: null, active: 0, limit: 0 }
    }

    // 命中容量闸：先问队列放不放得下（maxQueue<=0=不限排队深度）
    const mq = num(maxQueue)
    if (mq > 0 && cnt(queueDepth) >= mq) {
        return {
            action: 'reject', admit: false, code: QUEUE_FULL_REJECT_CODE, reason: `queue-full:${saturated.key}`,
            retryAfterMs: Math.max(1, Math.round(retryAfterMs)), limitedBy: saturated.key,
            active: saturated.active, limit: saturated.limit,
        }
    }
    return {
        action: 'queue', admit: false, code: 0, reason: `capacity:${saturated.key}`,
        retryAfterMs: Math.max(1, Math.round(retryAfterMs)), limitedBy: saturated.key,
        active: saturated.active, limit: saturated.limit,
    }
}

/**
 * @description 拒绝时对外回什么形态（队列满 = 真忙，沿用 runGate 的"200+success:false"通道口径）
 * @param {Object} decision `decideTaskAdmission` 的产物
 * @returns {{httpStatus:Number, body:Object, headers:Object}} 回法
 * @description
 * 只有 `action==='reject'`（队列也满）才回拒绝体；`proceed/queue` 都不该走到这里。
 * 形态照 `runGate.rejectResponse`：**HTTP 200 + `success:false` + `code`**——非 2xx 会让各端
 * x-sdk 读不到拒绝体（`runGate.js` 头实测坐实），排队/忙的信息必须能被客户端读到并分叉处理。
 */
export function rejectQueueFull(decision = {}) {
    /**
     * 形状适配（单源在此，不许散落路由做映射）：两个判据件用两个键名表达同一事实——
     * `decideTaskAdmission` 回 `action:'reject'`，`decideQueueOnOverlap` 回 `decision:'reject'`。
     * 都认 ⇒ "拒绝判定"到"拒绝体"的转换只有一个函数；都不认（proceed/queue/pass）⇒ null，
     * 调用方落回既有路径，绝不把放行判定演成拒绝。
     */
    const isReject = !!decision && (decision.action === 'reject' || decision.decision === 'reject')
    if (!isReject) {
        return null
    }
    const retryAfterMs = Number(decision.retryAfterMs) || 0
    const message = '当前会话排队已满，请稍后再发起'
    return {
        httpStatus: 200,
        body: {
            success: false,
            name: 'QueueFull',
            message,
            code: decision.code || QUEUE_FULL_REJECT_CODE,
            msg: message,
            data: {
                reason: decision.reason,
                limitedBy: decision.limitedBy ?? null,
                active: decision.active ?? null,
                limit: decision.limit ?? null,
            },
        },
        headers: retryAfterMs > 0 ? { 'Retry-After': String(Math.max(1, Math.round(retryAfterMs / 1000))) } : {},
    }
}

export default { decideTaskAdmission, rejectQueueFull, QUEUE_FULL_REJECT_CODE }
