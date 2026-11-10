/**
 * @fileOverview 停机路径的纯决策（关闭宽限尺寸、关闭期间是否打断在途 run）
 * @module services/core/session/shutdownPolicy
 * @description
 * 这个模块存在的原因是两个已经实测过的坑：
 *
 * 1. **`FASTIFY_CLOSE_GRACE_DELAY` 曾经是"写了不生效"的配置**。
 *    `close-with-grace@2.2` 的源码是 `const delay = typeof opts.delay === 'number' ? opts.delay : undefined`，
 *    而旧代码传的是 `process.env[...] || 25000` —— env 读出来是**字符串** ⇒ `delay=undefined`
 *    ⇒ 那条 `setTimeout` 竞速根本不参与 ⇒ 应用**无限等**在途请求，直到 kubelet 在
 *    `deletionTimestamp + terminationGracePeriodSeconds` 上 SIGKILL。
 *    实测证据：`kill` 档 SIGTERM 后流继续跑了 **103,984ms**（远超配置的 45s）且落 `finish`。
 *    所以尺寸必须经过这里换算成**数字**，并且要和 k8s 的 grace 一起算——单改一边等于没改。
 *
 * 2. **"连接被拆"与"用户按停止"在旧代码里是同一个信号**（`root.js:70-75` 只看 `request.raw.destroyed`）。
 *    停机时链路必然拆连接，于是每一次发版都会被记成"用户自己取消"。
 *    这里给出区分位：`closing` 为真时**不要** abort 在途 run——让它把答案跑完并落档，
 *    这才是"发版不丢轮"的正解；用户按停止仍然照旧打断。
 *
 * 判据只放这里一份，`dac`、`services`、探针都从这里取（同 `llmUsagePolicy` 的理由：两处规则会漂移）。
 */

/** 代码默认关闭宽限（毫秒）。旧值 500ms 会让检查点与落档都跑不到（PR-E0.4）。 */
export const DEFAULT_CLOSE_GRACE_MS = 25000
/**
 * 关闭序列里"主动落档"要留的余量（毫秒）：宽限预算必须**早于** close-with-grace 的强制退出，
 * 否则轮到的是 `process.exit`，不是我们的落档。
 */
export const CLOSE_ARCHIVE_RESERVE_MS = 5000
/** 单条 run 主动落档的时限（毫秒）：一条卡住不能拖死其余所有条 */
export const CLOSE_ARCHIVE_PER_RUN_TIMEOUT_MS = 1500
/**
 * 档案是哪条路径写的（写进 `message.extInfo.writtenBy`）。
 *
 * 为什么必须有这个标记：2026-11-10 连续三轮验收里，我都无法回答"这条档是谁写的"——
 * 客户端收到完整答案而档案是 0 字 abort 那一次（v1.40/v1.41）、
 * 以及"档案比 abort 事件晚约 1 秒"那一次（v1.43），
 * **两个解释我都不能排除**，只能靠再花一次长流去猜。
 * 归因缺失的代价不是"多看一行日志"，而是每次改动都要重跑真实滚动才能验证。
 *
 * `unattributed` 是**故意保留**的默认值：它表示"这条档来自我还没区分的路径"，
 * 而不是"没有来源"。宁可读到 unattributed 也不给一个看似合理的假来源。
 */
export const PERSIST_VIA = {
    /** 正常收尾 */
    NORMAL: 'normal',
    /** drain 每帧检查命中停止位 ⇒ 带着已生成正文早退落档 */
    EARLY_STOP: 'early-stop',
    /** 关闭序列的兜底抢救（archiveAllInflight 调用） */
    RESCUE: 'rescue',
    /** 异常路径（describeError 之后） */
    ERROR: 'error',
    /** 循环入口/出口的 aborted 检查（还没区分到具体是哪一处） */
    UNATTRIBUTED: 'unattributed',
    /** 事后回填扫描补的档（区别于当场落下的） */
    BACKFILL: 'backfill',
}
/**
 * 抢救置完停止位之后，**先等 run 自己收尾**多久（毫秒）。
 * 必须小于 `CLOSE_ARCHIVE_PER_RUN_TIMEOUT_MS`，否则兜底动作会被外层超时切断，
 * 结果两边都没落成——这是"预算互相吃掉"的老错，这里显式留出余量。
 */
export const CLOSE_ARCHIVE_WAIT_FOR_RUN_MS = 1000
/**
 * 从 grace 里**留给关闭序列本身的余量**（毫秒）。
 * 为什么是 10s 而不是原来注释里的 5s：关闭序列要"先在途落档 → 关 mongo → 断两个 redis"，
 * 落档那步含真实写库；实测一次 abort 落档 + 账本 upsert 在几百毫秒级，但网络抖一下就没预算了。
 * 宁可让宽限短一点、把落档跑完，也不要"承诺 25s 结果连档案都没写下"。
 */
export const CLOSE_RESERVE_MS = 10000

/**
 * @description 把 env 与 k8s grace 换算成 close-with-grace 真正能用的数字延迟
 * @param {Object} [params] 参数
 * @param {String|Number} [params.envValue] `process.env.FASTIFY_CLOSE_GRACE_DELAY` 原值
 * @param {Number} [params.defaultMs] 无 env / env 无效时的默认
 * @param {Number} [params.terminationGraceSeconds] k8s `terminationGracePeriodSeconds`（未配则不钳制）
 * @param {Number} [params.reserveMs] 留给关闭序列的余量
 * @param {Number|String} [params.preStopSeconds] `preStop` 钩子占用的秒数。
 *   必须计入：grace 从 `deletionTimestamp` 起算，而 preStop 是**在这同一个窗口里跑完才发 SIGTERM** 的，
 *   所以进程真正可用的窗口是 `grace − preStop − 余量`。
 *   漏掉它的后果不是崩溃而是"预算被静默吃掉 5 秒"——清单里那 6 处 `sleep 5` 此前对代码完全不可见。
 * @returns {{delayMs: Number, applied: Boolean, reason: String}} 结果；`applied:false` 表示 env 写了但没被采纳
 */
export function resolveCloseGraceDelay({
    envValue,
    defaultMs = DEFAULT_CLOSE_GRACE_MS,
    terminationGraceSeconds,
    reserveMs = CLOSE_RESERVE_MS,
    preStopSeconds = 0,
} = {}) {
    const raw = String(envValue ?? '').trim()
    let delayMs
    let reason = 'default'
    let applied = true
    if (raw === '') {
        delayMs = defaultMs
    } else if (!/^\d+$/.test(raw)) {
        /** 非纯数字：以前这种值会一路传进 close-with-grace 变成"无上限"，这里退回默认并显式说明 */
        delayMs = defaultMs
        applied = false
        reason = `env 值 "${raw}" 不是正整数毫秒，退回默认 ${defaultMs}ms（旧写法会把它当无上限）`
    } else {
        delayMs = Number(raw)
        reason = 'from-env'
        if (delayMs <= 0) {
            delayMs = defaultMs
            applied = false
            reason = `env 值 ${raw} 不是正数，退回默认 ${defaultMs}ms`
        }
    }
    const graceMs = Number(terminationGraceSeconds) * 1000
    const preStopMs = Math.max(0, Number(preStopSeconds) || 0) * 1000
    if (Number.isFinite(graceMs) && graceMs > 0) {
        /**
         * 上限 = grace − preStop − 关闭序列余量。
         * 这一版之前少减了 preStop：`60 − 10 = 50` 看着有余量，
         * 但 preStop 的 5s 也来自同一个窗口 ⇒ 实际可用只有 45s，配置 45000 恰好贴着上限（零余量）。
         */
        const max = Math.max(1000, graceMs - preStopMs - reserveMs)
        if (delayMs > max) {
            return {
                delayMs: max,
                applied,
                reason: `clamped: env ${delayMs}ms 超过 grace ${terminationGraceSeconds}s`
                    + ` − preStop ${preStopMs / 1000}s − 余量 ${reserveMs}ms ⇒ ${max}ms`,
            }
        }
    }
    return {delayMs, applied, reason}
}

/**
 * @description 关闭期间，socket 断开要不要打断在途 run
 * @param {Object} params 参数
 * @param {Boolean} params.closing 进程是否已进入关闭序列
 * @param {Boolean} [params.destroyed] `request.raw.destroyed`
 * @param {Boolean} [params.aborted] 信号已被打断（幂等用）
 * @returns {{abort: Boolean, reason: String}} 决策
 */
export function socketCloseAbortDecision({closing = false, destroyed = false, aborted = false} = {}) {
    if (aborted) {
        return {abort: false, reason: 'already-aborted'}
    }
    if (closing) {
        /**
         * 发版时连接必然被拆，但这一轮的钱已经花了、正文还在内存里。
         * 此时打断 = 把"能被救回的一轮"判成"用户自己取消"，档案里就永远看不见了。
         */
        return {abort: false, reason: 'shutdown-draining'}
    }
    if (!destroyed) {
        /** 正常收尾的 close（响应写完）不是打断 */
        return {abort: false, reason: 'orderly-close'}
    }
    return {abort: true, reason: 'client-disconnect'}
}

/**
 * @description 在途 run 因停机而必须落档时，写进账本/档案的字段（口径只放一份）
 * @param {Object} params 参数
 * @param {String} [params.answerContent] 已生成的正文
 * @param {Number} [params.elapsedMs] 这一轮已跑时长
 * @param {String} [params.reason] 停机原因（signal 名）
 * @returns {{progress: String, interruptedBy: String, error: String, answerChars: Number}} 落档字段
 */
export function shutdownArchiveFields({answerContent = '', elapsedMs = 0, reason = 'sigterm'} = {}) {
    const chars = String(answerContent || '').length
    return {
        /** `abort` 是前端已经能正确渲染的形态（三端都有"本轮回答已被中断，内容不完整"） */
        progress: 'abort',
        /** 原因必须另存一列：不能拿 progress 一个字段同时表达"用户按停止"和"进程被杀" */
        interruptedBy: 'process-lost',
        error: `shutdown:${reason}`,
        answerChars: chars,
        elapsedMs,
    }
}

/**
 * @description 停机时是否值得为这一轮落档（没正文就别写一条空气泡）
 * @param {Object} params 参数
 * @param {Number} params.answerChars 已有正文字数
 * @param {Boolean} [params.persisted] 该轮是否已经落过档
 * @returns {{write: Boolean, reason: String}} 决策
 */
export function shutdownArchiveDecision({answerChars = 0, persisted = false} = {}) {
    if (persisted) {
        return {write: false, reason: 'already-persisted'}
    }
    if (answerChars <= 0) {
        /** 一个字都没有：写一条空 abort 气泡只会让用户以为系统坏了，且账本上看不出区别 */
        return {write: false, reason: 'no-content'}
    }
    return {write: true, reason: 'partial-content'}
}
