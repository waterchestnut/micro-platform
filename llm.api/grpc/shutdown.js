/**
 * @fileOverview gRPC 服务端的停机（停收新调用 → 等在途 → 超预算强杀）
 * @module grpc/shutdown
 * @description
 * 为什么必须有这个：`grpc/server.js` 过去**没有任何信号处理**，而它的 deployment 早已把入口翻成
 * `command: ["node","$(APP)"]` ⇒ PID 1 就是 node，**node 在没有 SIGTERM 处理器时的默认行为是立即终止**。
 * 翻入口之前那 60 秒里在途 RPC 是"白捡"能跑完的（bash 把信号推迟了），翻完之后反而被当场切断。
 * 这与消费者侧的结论完全同形：**先翻入口、后补优雅停止 = 让停机变得更糟**，
 * 区别只是消费者那边我在翻入口之前查出来了，这里没查出来。
 *
 * gRPC 的原生形态是 `tryShutdown(cb)`：不再接受新连接/新调用，**等在途调用跑完**；
 * 等不到就 `forceShutdown()`（在途调用被取消，客户端拿到 CANCELLED）——
 * 所以必须有预算，否则一个挂住的调用能把停机拖到 grace 到点被 SIGKILL。
 *
 * 预算与 http/kafka 同一份判据（`resolveDrainBudget`，会按 `TERM_GRACE_PERIOD_SECONDS` 与
 * `PRE_STOP_SECONDS` 钳制）。另注：清单上那条 `FASTIFY_CLOSE_GRACE_DELAY` 在本入口**没人读**，
 * 它是从 http 抄 env 块时带过来的惰性配置，已记入 §25，不再让它看起来"已生效"。
 */
import {resolveDrainBudget} from '../daos/core/policy/drainPolicy.js'

/**
 * @description 给 grpc server 装停机处理（幂等：重复信号只处理一次）
 * @param {Object} params 参数
 * @param {Object} params.server grpc.Server（需有 tryShutdown / forceShutdown）
 * @param {Object} [params.logger] 日志器
 * @param {Object} [params.env] env 来源（默认 process.env；测试注入用）
 * @param {Function} [params.exit] 退出动作（默认 process.exit；测试注入用）
 * @param {Function} [params.onSignal] 注册信号的函数（默认 process.on；测试注入用）
 * @returns {{dispose: Function, state: Object}} 句柄（state 供测试断言真实顺序）
 */
export function installGrpcShutdown({
    server,
    logger = console,
    env = process.env,
    exit = (code) => process.exit(code),
    onSignal = (sig, fn) => process.on(sig, fn),
}) {
    const state = {signals: [], phase: 'running', waitedMs: 0, forced: false}
    const t0 = {at: 0}

    /**
     * @description 一次停机（重复信号直接忽略）
     * @param {String} signal 信号名
     * @returns {void}
     */
    function shutdown(signal) {
        if (state.phase !== 'running') {
            logger.warn(`grpc 停机重复信号被忽略: ${signal}（当前 phase=${state.phase}）`)
            return
        }
        state.signals.push(signal)
        const budget = resolveDrainBudget({
            envValue: env.GRPC_SHUTDOWN_TIMEOUT_MS,
            terminationGraceSeconds: env.TERM_GRACE_PERIOD_SECONDS,
            preStopSeconds: env.PRE_STOP_SECONDS,
        })
        state.phase = 'draining'
        t0.at = Date.now()
        logger.warn(`grpc 停机开始: signal=${signal} 预算=${budget.budgetMs}ms(${budget.reason}, env采纳=${budget.applied})`)
        const timer = setTimeout(() => {
            /** 超时强杀是**有代价的决定**，不是失败：宁可让在途调用 CANCELLED，也不要整轮被 SIGKILL 且无日志 */
            state.forced = true
            state.phase = 'forced'
            state.waitedMs = Date.now() - t0.at
            logger.warn(`grpc 停机超预算 ${budget.budgetMs}ms ⇒ forceShutdown（在途调用将被取消）`)
            try {
                server.forceShutdown()
            } catch (e) {
                logger.error(`grpc forceShutdown 出错: ${e.stack || e.message}`)
            }
            exit(0)
        }, budget.budgetMs)
        try {
            server.tryShutdown((err) => {
                clearTimeout(timer)
                state.waitedMs = Date.now() - t0.at
                if (err) {
                    logger.error(`grpc tryShutdown 出错: ${err.message || err}`)
                }
                if (state.phase === 'forced') {
                    /** 强杀之后 tryShutdown 的回调也可能迟到回来，这里不能把 phase 改回去 */
                    return
                }
                state.phase = 'drained'
                logger.info(`grpc 停机完成: 在途已跑完 等待=${state.waitedMs}ms forced=${state.forced}`)
                exit(0)
            })
        } catch (e) {
            clearTimeout(timer)
            logger.error(`grpc tryShutdown 抛出: ${e.stack || e.message} ⇒ 直接退出`)
            exit(1)
        }
    }

    for (const sig of ['SIGTERM', 'SIGINT']) {
        onSignal(sig, () => shutdown(sig))
    }
    return {
        dispose () {
            for (const sig of ['SIGTERM', 'SIGINT']) {
                process.removeAllListeners(sig)
            }
        },
        state,
    }
}
