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
 * @returns {{httpStatus: Number, body: Object, headers: Object}} 回法
 * @description
 * **实测结论：不回 HTTP 429，回 HTTP 200 + JSON，且 JSON 里必须带 `success:false`。**
 * 依据是逐端读了四端实际打包进去的 x-sdk 源码（不是核版本号——同一个版本号也可能改行为）：
 *
 * | 端 | x-sdk | `!response.ok` | `application/json` |
 * |---|---|---|---|
 * | `xxzx.console` | 2.6.0 | `dist/x-sdk.js:2403` ⇒ `throw new Error('Fetch failed with status N')` | `:2639 jsonResponseHandler` |
 * | `xxzx.mopit.console` | 2.2.1 | 同上（1 处命中） | 同上 |
 * | `xxzx.pdfviewer.console` | 2.5.0 | 同上 | 同上 |
 * | `xxzx.raisef.console` | 2.10.0 | 同上 | 同上 |
 *
 * 两件事因此被定死：
 * 1. **429 会让四端都拿不到我们的信息**：非 2xx 直接 throw，**响应体一次都不会被读**，
 *    `code 4290`、`msg`、`data.reason` 全部丢失，用户只会看到"请求失败"。
 *    而且四端的 `catch` 之后还有自动重试（`:2547-2570`），拒绝反而变成客户端加压。
 * 2. 200 + JSON 才有错误通道：`jsonResponseHandler` 里
 *    **`chunk.success === false` ⇒ `onError(new Error(chunk.message), chunk, headers)`**；
 *    否则会被当成一条正常内容走 `onUpdate`/`onSuccess`。
 *    ⇒ 只按本项目 `retSchema` 回 `{code,msg,data}` 是不够的（那会进 onSuccess 分支，
 *    渲染出一条空回答），必须同时给 `success:false` + `message`。
 *
 * 所以 body 同时满足两套约定：`success/message` 给 x-sdk 的错误通道，
 * `code/msg/data` 给业务码分支（§2G.7 定的 4290 口径）。
 * 代价仍然要说清楚：**网关/APISIX 侧看不见 429，就看不见压力信号**——
 * 那个需求该由 `/runStats` 与指标导出满足，而不是靠把四端的错误信息换成一个状态码。
 */
export function rejectResponse(decision = {}) {
    const retryAfterMs = Number(decision.retryAfterMs) || 0
    const message = decision.reason === 'user-full'
        ? '你有多个问题正在处理中，请等待其中一个完成后再问'
        : '服务当前繁忙，请稍后再问'
    return {
        httpStatus: 200,
        body: {
            /** 给 x-sdk 的开关：没有它，这条拒绝会被渲染成一条空回答 */
            success: false,
            name: 'ConcurrencyLimited',
            message,
            /** 给本项目 retSchema 口径的调用方 */
            code: GATE_REJECT_CODE,
            msg: message,
            data: {reason: decision.reason, active: decision.active, limit: decision.limit},
        },
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
