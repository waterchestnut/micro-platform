/**
 * @fileOverview 同一会话的"上一轮还没结束"判据（P5，纯函数）
 * @module services/core/session/runOverlap
 * @description
 * 这条与 `runGate.js` 的并发闸**不是一回事**，两者口径不同、都要保留：
 *
 * | | `runGate`（PR-0.4） | 这里（P5） |
 * |---|---|---|
 * | 拦什么 | 全局在途数、单用户在途数 | **同一个会话**是否已有未终态 run |
 * | 数据源 | 本进程登记表（PM2 每 worker 一份） | 账本里的 `progress:'processing'` 行（跨 worker 可见） |
 * | 默认 | 关（`limit=0` 时连登记都不做） | 开（窗口很窄，只打秒级重复） |
 *
 * 为什么必须用账本而不是登记表：实测 `llm-api-http` 是 2 worker，进程内登记表看不见另一个
 * worker 上的 run；而"用户开了两个标签页问同一会话"恰恰最可能落到不同 worker。
 *
 * 两条口径是刻意的，不要"顺手优化"掉：
 * 1. **读数不可信时一律放行**（时间取不到、算不出年龄 ⇒ 不拒）。宁可少拒一次，
 *    也不要把"我读不懂数据"变成"用户不能提问"——那比静默缺上下文更糟。
 *    窗口值本身同理：`NaN`/负数/`0` 都退化成"只记录"；但**不传**（undefined）走默认窗口，
 *    配置漏填不该等于不设防。
 * 2. **窗口之外只记录、不拒绝**。未终态但已经很久（多半是被硬杀留下的行）时拒绝，
 *    等于让一条僵尸行永久锁死一个会话。
 *
 * 记录（`overlapNote`）比拒绝更重要：P5 的实测结论是"后一轮静默地看不到前一轮"，
 * 用户只会觉得模型失忆。把这件事写进档案、说在界面上，才是这一条的正题；
 * 拒绝只是对明显误用的止损。
 */

/** 与 4290（全站/每用户超限）分开：客户端要能区分"稍后再试"和"你上一轮还在收尾" */
export const OVERLAP_REJECT_CODE = 4291

/** 默认窗口：只覆盖"同一人同一会话秒级重复"，不试图覆盖任何有意义的连续对话 */
export const DEFAULT_OVERLAP_WINDOW_MS = 1500

/**
 * @description 判断这一轮是不是撞在自己会话的未终态 run 上
 * @param {Object} params 参数
 * @param {Object} [params.prev] 账本里的未终态 run（`{messageCode, insertTime}`，时间为毫秒或 Date），没有传 null
 * @param {Number} [params.now] 当前时间（毫秒）
 * @param {Number} [params.windowMs] 拒绝窗口；<=0 表示只记录不拒绝
 * @param {Boolean} [params.reject] false 表示只记录不拒绝（灰度/排障用）
 * @returns {{admit: Boolean, reason: String, code: Number, prevMessageCode: (String|null), ageMs: (Number|null), retryAfterMs: Number}} 判定
 */
export function decideOverlap({prev = null, now = Date.now(), windowMs = DEFAULT_OVERLAP_WINDOW_MS, reject = true} = {}) {
    if (!prev || typeof prev !== 'object' || Array.isArray(prev)) {
        return {admit: true, reason: 'no-prev', code: 0, prevMessageCode: null, ageMs: null, retryAfterMs: 0}
    }
    const prevMessageCode = typeof prev.messageCode === 'string' && prev.messageCode ? prev.messageCode : null
    const started = toMs(prev.insertTime)
    const t = toMs(now)
    /** 读数不可信 ⇒ 放行并说明原因：把"我读不懂"变成"你不能问"是更坏的结果 */
    if (started === null || t === null) {
        return {admit: true, reason: 'unreadable-time', code: 0, prevMessageCode, ageMs: null, retryAfterMs: 0}
    }
    const ageMs = t - started
    if (ageMs < 0) {
        /** 时钟倒挂（跨节点时钟漂移）：同样不算重复 */
        return {admit: true, reason: 'clock-skew', code: 0, prevMessageCode, ageMs, retryAfterMs: 0}
    }
    const win = Number(windowMs) || 0
    if (win <= 0 || reject === false) {
        return {admit: true, reason: 'note-only', code: 0, prevMessageCode, ageMs, retryAfterMs: 0}
    }
    if (ageMs < win) {
        return {
            admit: false,
            reason: 'same-conversation-duplicate',
            code: OVERLAP_REJECT_CODE,
            prevMessageCode,
            ageMs,
            retryAfterMs: Math.max(win - ageMs, 300),
        }
    }
    /** 未终态但已过窗口：多半是硬杀留下的僵尸行。放行，但把话说清楚 */
    return {admit: true, reason: 'stale-open-run', code: 0, prevMessageCode, ageMs, retryAfterMs: 0}
}

/**
 * @description 该往档案里写什么（没有可写就返回 null，不写假字段）
 * @param {Object} decision `decideOverlap` 的结果
 * @returns {Object|null} `{prevMessageCode, prevAgeMs, contextMissing, reason}`
 *
 * `contextMissing` 的口径要说准：**发起这一轮时上一轮还没终态**，
 * 所以它的答复不可能是本轮上下文的一部分。这不是推测——它是本轮开始前的读数。
 */
export function overlapNote(decision = {}) {
    if (!decision || decision.reason === 'no-prev' || !decision.prevMessageCode) {
        return null
    }
    return {
        prevMessageCode: decision.prevMessageCode,
        prevAgeMs: decision.ageMs === null || decision.ageMs === undefined ? null : decision.ageMs,
        contextMissing: true,
        reason: decision.reason,
    }
}

/**
 * @description 时间归一到毫秒；读不出就返回 null（调用方据此放行，绝不猜）
 * @param {Object} v Date、毫秒数或可解析字符串
 * @returns {Number|null} 结果
 */
function toMs(v) {
    if (v instanceof Date) {
        const d = v.getTime()
        return Number.isFinite(d) ? d : null
    }
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : null
    }
    if (typeof v === 'string' && v) {
        const p = Date.parse(v)
        return Number.isFinite(p) ? p : null
    }
    return null
}
