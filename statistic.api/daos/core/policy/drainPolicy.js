/**
 * @fileOverview 停机时的"停止接新活 + 等在途收尾 + 预算"纯决策（kafka 消费者与 cron 共用）
 * @module daos/core/policy/drainPolicy
 * @description
 * 放在 `daos/core/policy` 的理由与 `llmUsagePolicy.js` 相同：这是一份**纯判据**，
 * 谁都要用（kafka 消费者、cron 进程），而 `daos` 不引 `services` 是本仓的分层惯例。
 *
 * 为什么 kafka 侧必须有这个东西：`Consumer#close()` 的实测语义是 **leave group + 关连接，不等在途 callback**
 * （`dist/clients/consumer/consumer.js:110` 起）。所以原来那个"收到 SIGTERM 就 close 然后 exit(0)"
 * 的处理器如果真被触发，效果是把正在跑的那条消息**当场放弃**：offset 没提交 ⇒ 别的 pod 重跑一遍。
 * 而今天它之所以没造成损失，纯粹因为 PID 1 是 bash、信号根本没送到 node 进程 ——
 * 我们在靠一个缺陷的副产品过日子。翻入口之前必须先把"等不等在途"这件事做实。
 *
 * 顺序上的一个坑（这是本模块存在的主要理由）：**不能先 close 再等在途**。
 * close 会关掉连接，随后在途那条消息的 `message.commit()` 就会失败 ——
 * 活干完了但位点没提交 ⇒ 还是重跑。所以正确顺序是：
 *   ① 置 draining ⇒ 不再开新活（也不提交，留给别人）
 *   ② 等在途跑完并提交（有预算上限）
 *   ③ 再 close（干净 leave group，别的 pod 立刻接管，不用等 sessionTimeout 30s）
 *
 * 判据与 `shutdownPolicy` 同源：宽限尺寸必须跟 `TERM_GRACE_PERIOD_SECONDS` 成对算，
 * 单改一边等于没改（v1.42 那次 `FASTIFY_CLOSE_GRACE_DELAY` 传字符串导致"无上限"就是同一个错）。
 */

/** 没有 grace、也没有 env 时的默认排空预算（毫秒） */
export const DEFAULT_DRAIN_BUDGET_MS = 30000
/**
 * 排空之后还要留给 `close()`（leave group）与退出动作的时间（毫秒）。
 * 不给这段余量，就会出现"排空排到最后一毫秒，然后被 SIGKILL 截在 close 中间"。
 */
export const DRAIN_RESERVE_MS = 5000
/** 预算下限：再小的 grace 也要给在途一次机会，否则这个开关没有意义 */
export const DRAIN_MIN_MS = 1000

/**
 * @description 把 env 与 k8s grace 换算成排空预算（数字，不是字符串）
 * @param {Object} [params] 参数
 * @param {String|Number} [params.envValue] `process.env.KAFKA_DRAIN_TIMEOUT_MS` 原值
 * @param {Number} [params.terminationGraceSeconds] `TERM_GRACE_PERIOD_SECONDS`（未配则不钳制）
 * @param {Number} [params.defaultMs] 无 env / env 无效时的默认
 * @param {Number} [params.reserveMs] 留给 close 与退出的余量
 * @param {Number} [params.preStopSeconds] preStop 钩子占用的秒数（有则一并从 grace 里扣）
 * @returns {{budgetMs: Number, applied: Boolean, reason: String}} `applied:false` = env 写了但没被采纳
 */
export function resolveDrainBudget({
    envValue,
    terminationGraceSeconds,
    defaultMs = DEFAULT_DRAIN_BUDGET_MS,
    reserveMs = DRAIN_RESERVE_MS,
    preStopSeconds = 0,
} = {}) {
    const raw = String(envValue ?? '').trim()
    let budgetMs
    let applied = true
    let reason = 'default'
    if (raw === '') {
        budgetMs = defaultMs
    } else if (!/^\d+$/.test(raw)) {
        /** 与 resolveCloseGraceDelay 同样的理由：非纯数字的 env 不能当成"没写"，也不能照传 */
        budgetMs = defaultMs
        applied = false
        reason = `env "${raw}" 不是正整数毫秒，退回默认 ${defaultMs}ms`
    } else {
        budgetMs = Number(raw)
        reason = 'from-env'
        if (budgetMs <= 0) {
            budgetMs = defaultMs
            applied = false
            reason = `env ${raw} 不是正数，退回默认 ${defaultMs}ms`
        }
    }
    const graceSec = Number(terminationGraceSeconds)
    const preStop = Number(preStopSeconds) || 0
    if (Number.isFinite(graceSec) && graceSec > 0) {
        const max = Math.max(DRAIN_MIN_MS, graceSec * 1000 - reserveMs - preStop * 1000)
        if (budgetMs > max) {
            return {
                budgetMs: max,
                applied,
                reason: `clamped: ${budgetMs}ms 超过 grace ${graceSec}s − 余量 ${reserveMs}ms − preStop ${preStop}s ⇒ ${max}ms`,
            }
        }
    }
    return {budgetMs, applied, reason}
}

/**
 * @description 在途消息计数器 + 排空等待
 * @returns {Object} 控制器
 */
export function createDrainController() {
    let inFlight = 0
    let draining = false
    let startedAt = 0
    /** @type {Set<String>} 在途消息的标识，超时后要能说出"卡在哪一条"**/
    const pending = new Set()
    /** @type {Array<Function>} */
    const waiters = []

    /**
     * @description 唤醒等待者（只可能在 inFlight 归零或超时两处发生）
     * @param {Boolean} drained 是否真的排空
     * @returns {void}
     */
    function flush(drained) {
        if (waiters.length === 0) {
            return
        }
        const r = {drained, inFlight, waitedMs: startedAt ? Date.now() - startedAt : 0, pending: [...pending]}
        waiters.splice(0).forEach(resolve => resolve(r))
    }

    return {
        get inFlight () {
            return inFlight
        },
        get draining () {
            return draining
        },
        /**
         * @description 准备处理一条消息；已进入停机则拒绝（调用方必须**不提交**这条的 offset）
         * @param {String} ref 消息标识（topic/partition/offset）
         * @returns {Boolean} true = 可以开始干活
         */
        start (ref) {
            if (draining) {
                return false
            }
            inFlight += 1
            pending.add(ref)
            return true
        },
        /**
         * @description 一条消息彻底结束（含 offset 提交尝试）
         * @param {String} ref 标识
         * @returns {void}
         */
        finish (ref) {
            /**
             * 只认在途集合里真的有的 ref。上一版只防了"扣成负数"，
             * 结果一个重复 finish（或不认识的 ref）照样把计数扣穿 ——
             * 计数比真实在途少 ⇒ waitForDrain 提前放行 ⇒ close 插在还没干完的消息前面。
             * 这种错比"没排空"更隐蔽，因为它看起来一切正常。
             */
            if (!pending.delete(ref)) {
                return
            }
            if (inFlight > 0) {
                inFlight -= 1
            }
            if (inFlight === 0) {
                flush(true)
            }
        },
        /**
         * @description 置停机位：之后的 start() 一律拒绝
         * @returns {{wasInFlight: Number, pending: Array<String>}} 置位时的现场
         */
        beginDraining () {
            const snapshot = {wasInFlight: inFlight, pending: [...pending]}
            draining = true
            if (inFlight === 0) {
                flush(true)
            }
            return snapshot
        },
        /**
         * @description 等在途归零，最多等 budgetMs
         * @param {Number} budgetMs 预算
         * @returns {Promise<Object>} {drained, timedOut, waitedMs, pending, inFlight}
         */
        waitForDrain (budgetMs) {
            startedAt = Date.now()
            const settle = new Promise(resolve => waiters.push(resolve))
            if (inFlight === 0) {
                return Promise.resolve({drained: true, timedOut: false, waitedMs: 0, pending: [], inFlight: 0})
            }
            return new Promise(resolve => {
                /**
                 * 这里**不能** `unref()`。上一版 unref 之后，"循环里没有别的活动"时定时器就不触发，
                 * waitForDrain 的 Promise 永远挂着（node:test 直接报 "event loop has already resolved"）——
                 * 而"循环空了"恰恰是超时兜底最该生效的时刻。生产里也一样：
                 * consumer 一旦 leave group 就没有事件撑着循环，超时不触发就等于进程悬着不退。
                 */
                const timer = setTimeout(() => {
                    /**
                     * 超时不是失败而是**已知的取舍**：这条消息没提交，会被别的 pod 重跑。
                     * 所以必须把 pending 报出来，否则日志里只看得到"退出了"，看不到"重跑了几条"。
                     */
                    const r = {
                        drained: false, timedOut: true,
                        waitedMs: Date.now() - startedAt,
                        pending: [...pending], inFlight,
                    }
                    waiters.splice(0)
                    resolve(r)
                }, Math.max(DRAIN_MIN_MS, Number(budgetMs) || 0))
                settle.then(r => {
                    clearTimeout(timer)
                    resolve({...r, timedOut: false})
                })
            })
        },
        /**
         * @description 当前在途标识（诊断用）
         * @returns {Array<String>} 列表
         */
        pendingRefs () {
            return [...pending]
        },
    }
}
