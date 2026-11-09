/**
 * @fileOverview SSE 输出通道：每事件 `id:seq` + `:ping` 心跳
 * @module tools/sseChannel
 * @description
 * PR-A 剩下的传输层地基（协议 3 里**后端可以单方面做完的两件事**）。
 * 之所以从路由里抽出来：这两件事的正确性不该依赖模型、数据库或真实网络，
 * 而 SSE 帧的写法在 `/core/chat/stream` 与 `/core/chat/u2u/message/stream` 两处是一样的——
 * 不抽出来就会有两份实现，然后其中一份悄悄漏掉 `id:`。
 *
 * 要满足的是 §19 的 SSE 四条不变量中与本模块有关的两条：
 * 1. **`id` 严格单调**：每条业务事件带 `id:<seq>`，seq 从 1 开始逐事件 +1；
 *    客户端与 `/resume` 都拿它当游标，所以它必须**只数事件**，不数心跳、不数重试；
 * 2. **心跳注释不进业务事件列表**：`:ping` 是纯注释帧，**不带 `id`、不推进 seq**——
 *    否则一次心跳就会在续接时被当成一条事件重放。
 *
 * 心跳为什么必须存在（§2B.2）：生产入口是 Traefik，`idleTimeout` 180s
 * 且**在 k8s Ingress 路径下无法通过注解调整**；工具执行或长思考阶段可能整段静默，
 * 连接被掐不是优化项而是硬约束。间隔取小值（默认 8s），dev 侧 nginx 的 60s 默认也一并覆盖。
 *
 * 写失败不抛：客户端断开后 `stream.write` 会报错，而那时"连接已经没了"本身就是正常路径，
 * 不该把一次浏览器的刷新变成服务端的一条 error 日志（真正的中断由 `options.signal` 负责）。
 */

import {serializeSSEEvent} from './sse.js'

/** 默认心跳间隔（毫秒）。证据见 §2B.2 与 §16.3 P-9b：要覆盖 Traefik 180s 与 dev nginx 60s，取小值 */
export const DEFAULT_PING_INTERVAL_MS = 8000

/**
 * @description 建一个 SSE 输出通道
 * @param {Object} sink 底层可写流（`reply.raw`），需要有 `write(chunk)`
 * @param {Object} [opts] 选项
 * @param {Number} [opts.pingIntervalMs] 心跳间隔；<=0 表示关闭心跳
 * @param {Function} [opts.onError] 写失败时的回调（只用于日志，不抛出）
 * @param {Function} [opts.now] 取当前毫秒时间（测试注入用）
 * @param {Function} [opts.setInterval] 定时器实现（测试注入用，避免真实等待）
 * @param {Function} [opts.clearInterval] 取消定时器实现（测试注入用）
 * @returns {{emit: Function, ping: Function, close: Function, getSeq: Function, isOpen: Function}} 通道
 */
export function createSseChannel(sink, opts = {}) {
    const {
        pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
        onError = () => { /* 默认吞掉：断线是正常路径 */ },
        now = () => Date.now(),
        setInterval: setIntervalImpl = setInterval,
        clearInterval: clearIntervalImpl = clearInterval,
    } = opts

    /** 业务事件游标：只数事件，心跳不数 */
    let seq = 0
    let open = true
    let lastWriteAt = now()
    let timer = null

    /**
     * @description 写一帧；写失败只回报不外抛
     * @param {String} frame 已序列化的 SSE 文本
     * @returns {Boolean} 是否写入成功
     */
    const writeFrame = (frame) => {
        if (!frame) {
            return false
        }
        if (!open) {
            return false
        }
        try {
            sink.write(frame)
            lastWriteAt = now()
            return true
        } catch (e) {
            open = false
            onError(e)
            return false
        }
    }

    /**
     * @description 发一条业务事件，自动带单调递增的 `id`
     * @param {String} data 事件载荷（通常是 JSON 字符串）
     * @param {String} [event] 事件名；缺省按 `delta`
     * @returns {Number|null} 分配到的 seq；通道已关闭或写入失败时返回 null
     */
    const emit = (data, event) => {
        if (!open) {
            return null
        }
        seq += 1
        const ok = writeFrame(serializeSSEEvent({id: String(seq), event: event || 'delta', data}))
        return ok ? seq : null
    }

    /**
     * @description 发一帧心跳注释（不带 id、不推进游标）
     * @returns {Boolean} 是否写入成功
     */
    const ping = () => writeFrame(serializeSSEEvent({comment: 'ping'}))

    /**
     * @description 启动心跳定时器；重复调用不会起第二个定时器
     * @returns {void}
     */
    const startPing = () => {
        if (!(pingIntervalMs > 0) || timer) {
            return
        }
        timer = setIntervalImpl(() => {
            if (!open) {
                return
            }
            /**
             * 只在"真的静默了"的时候发心跳：正常出字时没必要再插注释帧，
             * 那会让每一帧都多一行无意义的内容，也不好在日志里数事件。
             */
            if (now() - lastWriteAt >= pingIntervalMs) {
                ping()
            }
        }, pingIntervalMs)
    }

    /**
     * @description 关闭通道：停定时器、拒绝后续写入；可重复调用
     * @returns {Number} 关闭时的事件游标（用于日志）
     */
    const close = () => {
        open = false
        if (timer) {
            clearIntervalImpl(timer)
            timer = null
        }
        return seq
    }

    startPing()

    return {
        emit,
        ping,
        close,
        getSeq: () => seq,
        isOpen: () => open,
    }
}
