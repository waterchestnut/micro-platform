/**
 * @fileOverview 并发闸：判定纯函数（PR-0.4）
 * @module services/core/session/runGate
 * @description
 * 这里只放**判定**，不放计数（计数在 `runRegistry.js`）。分成两个文件的原因和
 * `contactScope.js` / `messageScope.js` 一样：`runRegistry` 会被路由持有、间接连到请求生命周期，
 * 而判定必须能离线穷举——**闸的边界条件是不能靠"起个服务打一把"来测的**。
 *
 * 三条已定的口径（不要在这里重新发明）：
 * 1. **上限 0 = 关闸**。默认就是 0：不配就与现状逐字一致，不因为"加了个功能"而改变现网行为。
 * 2. 超限时**返回 4290 + `Retry-After`，不进队列**（D36）。排队要有排队的位置、上限与可见性，
 *    那些都属于 PR-C 的 Streams；在没有队列之前"偷偷排队"是最坏的选择——用户看到的是"卡住了"。
 * 3. **这是单进程闸**：PM2 cluster 下每个 worker 各数自己的，实测 `llm-api-http` 是 2 worker
 *    ⇒ 集群实际天花板 ≈ `上限 × worker 数`。这条不是实现偷懒，是 P-8 的读数本来就是"单 pod"口径；
 *    要做全局闸得靠 redis 计数或 Streams，见 §26.2 的 PR-C 前置。
 */

/** 超限拒绝：对外 200 + `code:4290`（本项目 retSchema 的既有形态），`retryAfterMs` 告诉客户端多久再来 */
export const GATE_REJECT_CODE = 4290

/**
 * @description 决定这一次 run 能不能开始
 * @param {Object} params 参数
 * @param {Number} [params.active] 当前在途 run 数（本进程）
 * @param {Number} [params.limit] 并发上限；0 或缺省表示不限制
 * @param {Number} [params.userActive] 该用户当前在途 run 数
 * @param {Number} [params.perUserLimit] 单用户上限；0 或缺省表示不限制
 * @param {Number} [params.retryAfterMs] 建议客户端重试的间隔
 * @returns {{admit: Boolean, code: Number, reason: String, retryAfterMs: Number, active: Number, limit: Number}} 判定
 */
export function decideAdmission({
    active = 0,
    limit = 0,
    userActive = 0,
    perUserLimit = 0,
    retryAfterMs = 1500,
} = {}) {
    const max = Number(limit) || 0
    /** 关闸时也要把 active 带回去：观测字段不该因为功能没开就消失 */
    if (max <= 0) {
        return {admit: true, code: 0, reason: 'gate-off', retryAfterMs: 0, active, limit: max}
    }
    if (active >= max) {
        return {admit: false, code: GATE_REJECT_CODE, reason: 'global-full', retryAfterMs, active, limit: max}
    }
    /**
     * 单用户上限排在总量之后是有意的：总量满了先拒，
     * 否则一个人能靠"我没超个人限额"挤掉别人的位置——那是把闸变成先到先得的抢锁。
     */
    const perUser = Number(perUserLimit) || 0
    if (perUser > 0 && userActive >= perUser) {
        return {admit: false, code: GATE_REJECT_CODE, reason: 'user-full', retryAfterMs, active, limit: max}
    }
    return {admit: true, code: 0, reason: 'ok', retryAfterMs: 0, active, limit: max}
}

/**
 * @description 拒绝时对外回什么形态
 * @param {Object} decision `decideAdmission` 的产物
 * @returns {{httpStatus: Number, bodyCode: Number, message: String, headers: Object}} 回法
 * @description
 * **这里刻意用 HTTP 200 + `code:4290`，不是 HTTP 429**，理由不是"这样更省事"：
 * 本项目的返回约定是 `retSchema`（HTTP 200 + `{code,msg,data}`），四端 x-sdk 的
 * `XRequest`/`useXChat` 都按这个约定解析；一旦返回 429，SDK 各版本会不会把它当"请求失败"
 * 而不是"业务码"处理，**我没有逐端核实现**（§2E-6 的教训：核实现，不核版本号）。
 * 拿不准的时候按现有约定回，把压力信号放在 `code` 与 `Retry-After` 头上——
 * 中间层看不见 429 是缺点，但让四端里某一端把拒绝渲染成"网络错误"是更差的缺点。
 * 真要换成 HTTP 429，前置条件是四端实测（已挂 §26.2）。
 */
export function rejectResponse(decision = {}) {
    const retryAfterMs = Number(decision.retryAfterMs) || 0
    return {
        httpStatus: 200,
        bodyCode: GATE_REJECT_CODE,
        message: decision.reason === 'user-full'
            ? '你有多个问题正在处理中，请等待其中一个完成后再问'
            : '服务当前繁忙，请稍后再问',
        /** `Retry-After` 单位是秒（RFC）；没有建议值就不给这个头——给 `0` 会被读成"立刻重试" */
        headers: retryAfterMs > 0 ? {'Retry-After': String(Math.max(1, Math.round(retryAfterMs / 1000)))} : {},
    }
}

/**
 * @description 拒绝时要不要额外告警
 * @param {Object} decision `decideAdmission` 的产物
 * @returns {Boolean} 是否升级为告警
 * @description
 * 闸拒的是**流量**，不是**故障**：把每次拒绝都记成 error，错误率就变成了"今天多少人同时发问"
 * 的函数，真故障会被埋掉（与 §2E-3"打断不记 error"同一条道理）。
 * 只有**持续顶穿**（在途数远超上限）才值得单独响一声——那说明上游正在大面积变慢，
 * 或者闸值配小了，两种都是要人看的情况。
 */
export function rejectShouldAlert(decision = {}) {
    return decision.admit === false
        && decision.reason === 'global-full'
        && Number(decision.active) >= Number(decision.limit) * 1.5
}
