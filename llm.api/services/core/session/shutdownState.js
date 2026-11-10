/**
 * @fileOverview 进程是否已进入关闭序列（停机期间的单一状态位）
 * @module services/core/session/shutdownState
 * @description
 * 这个模块存在的理由只有一条：**"用户按停止"与"发版拆连接"在 HTTP 层长得一模一样**
 * （都是 `request.raw.destroyed === true`），而我们要对它们做相反的事——
 * 前者该立刻打断，后者该让这一轮继续跑完并落档。
 *
 * 2026-11-10 的现场取证（`evals/platform-probes/shutdown-forensics-probe.mjs`）读数：
 * 应用在处理 `request closed` 并 `abort()` 之后，**仍有 45 秒、10,772 字增量送达客户端**，
 * 最后档案没写、账本停在 `processing`、容器在信号后 71s 消失。
 * 也就是说旧代码同时踩了两个坑：拆连接被当成用户取消，而取消又拦不住生成。
 *
 * 状态位只在 `server.js` 的 `closeWithGrace` 监听器里置位（进程内单向、无并发写），
 * 判据本身在 `shutdownPolicy.js`，这里只管"现在是什么时刻"。
 */

const state = {closing: false, since: 0, signal: ''}

/**
 * @description 进入关闭序列（由 `closeWithGrace` 监听器在 `app.close()` 之前调用）
 * @param {Object} [params] 参数
 * @param {String} [params.signal] 触发信号（SIGTERM/SIGINT/manual）
 * @param {Number} [params.now] 时间源（测试注入）
 * @returns {{closing: true, since: Number, signal: String}} 置位后的状态
 */
export function beginShutdown({signal = '', now = Date.now} = {}) {
    if (!state.closing) {
        state.closing = true
        state.since = now()
        state.signal = signal
    }
    return {...state}
}

/**
 * @description 是否已进入关闭序列
 * @returns {Boolean} 结果
 */
export function isClosing() {
    return state.closing
}

/**
 * @description 当前状态（进日志与 `/runStats`，让"这个进程正在关机"成为可读事实）
 * @returns {{closing: Boolean, since: Number, signal: String, elapsedMs: Number}} 状态
 */
export function shutdownStatus({now = Date.now} = {}) {
    return {...state, elapsedMs: state.closing ? Math.max(0, now() - state.since) : 0}
}

/**
 * @description 复位（只给测试用；线上永远不该在置位后回退——回退会把半途的停机当成没发生）
 * @returns {void}
 */
export function resetForTest() {
    state.closing = false
    state.since = 0
    state.signal = ''
}

export default {beginShutdown, isClosing, shutdownStatus, resetForTest}
