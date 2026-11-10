/**
 * @fileOverview 关闭序列的编排：等在途 → 到点主动落档 → 再等收尾
 * @module services/core/session/shutdownSequence
 * @description
 * 这段编排原来只写在 `server.js` 的 `closeWithGrace` 监听器里，那就只有真在 pod 里收到 SIGTERM 才跑得到，
 * **而 Windows 下我根本发不出可用的 SIGTERM**（`taskkill /F` 等价于 SIGKILL，不触发处理器）。
 * 不可测的关闭逻辑就是没写的关闭逻辑，所以抽出来：`app` 与 `log` 都从外面给。
 *
 * 三件事的顺序是硬要求（§25 v1.33/v1.38）：
 *   1. `app.close()`：停止接新请求，等在途 run 自己跑完（跑完的那条会正常落 `finish` 并摘掉抢救函数）；
 *   2. 宽限预算用尽仍未跑完 ⇒ **主动落档**（带已有正文，`interruptedBy='process-lost'`）并置停止位；
 *   3. 收尾仍然交给 `app.close()` 的 promise：落档函数内部会走 `persistTurn` → 检查点 flush → 关 mongo/redis。
 * 反过来做（先关库再落档）就是"想续跑但现场没了"。
 */
import {archiveAllInflight} from './runRegistry.js'
import {CLOSE_ARCHIVE_RESERVE_MS, CLOSE_ARCHIVE_PER_RUN_TIMEOUT_MS} from './shutdownPolicy.js'

/**
 * @description 带抢救的关闭序列
 * @param {Object} params 参数
 * @param {{close: Function}} params.app 已启动的 fastify 实例（或测试替身）
 * @param {Number} params.delayMs close-with-grace 的宽限（毫秒），必须是数字
 * @param {Number} [params.reserveMs] 留给主动落档的余量
 * @param {Number} [params.perRunTimeoutMs] 单条落档的时限
 * @param {Function} [params.log] 日志函数（`(msg, obj)=>void`），测试里收集调用
 * @returns {Promise<{timedOut: Boolean, budgetMs: Number, archived: Array, closeMs: Number}>} 读数
 */
export async function closeWithRescue({
    app,
    delayMs,
    reserveMs = CLOSE_ARCHIVE_RESERVE_MS,
    perRunTimeoutMs = CLOSE_ARCHIVE_PER_RUN_TIMEOUT_MS,
    log = () => {},
} = {}) {
    if (!app || typeof app.close !== 'function') {
        throw new TypeError('closeWithRescue 需要一个带 close() 的 app')
    }
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs <= 0) {
        /** 这里再防一次字符串：正是这个类型错误让 env 配了三年都没生效 */
        throw new TypeError(`delayMs 必须是正数毫秒，当前 ${typeof delayMs}=${JSON.stringify(delayMs)}`)
    }
    const t0 = Date.now()
    const closing = app.close()
    const budgetMs = Math.max(1000, delayMs - reserveMs)
    const timedOut = await Promise.race([
        Promise.resolve(closing).then(() => false),
        new Promise(res => setTimeout(() => res(true), budgetMs)),
    ])
    let archived = []
    if (timedOut) {
        archived = await archiveAllInflight({perRunTimeoutMs})
        const ok = archived.filter(r => r.ok).length
        /**
         * 这行日志是验收面：落了几个、各花多久、失败在哪。
         * 必须带 messageCode 原文——上一轮就是因为日志无法归属到请求，我拿它下了错结论（§25 v1.38）。
         */
        log(`关闭宽限用尽(预算 ${budgetMs}ms)：主动落档 ${ok}/${archived.length} 条`
            + ` ${archived.map(r => `${r.messageCode}:${r.ok ? `${r.ms}ms` : `失败:${r.error}`}`).join(' | ')}`,
            {budgetMs, ok, total: archived.length, archived})
    }
    await closing
    return {timedOut, budgetMs, archived, closeMs: Date.now() - t0}
}
