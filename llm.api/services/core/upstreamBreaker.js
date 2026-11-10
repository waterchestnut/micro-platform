/**
 * @fileOverview relay 网关级故障的熔断（连续失败后一段时间内直接拒绝，不再打上游）
 * @module services/core/upstreamBreaker
 * @description
 * 要救的场景在 §2B.6 / D39 里写着，不是假想的通用最佳实践：
 * **12 个模型档全部指向同一个 relay 网关、同一把 key** ⇒ 现成的 `fallbackModel` 换档
 * 只解决"模型级故障"，救不了"网关整体不可用"——它连出口都不换。
 * 网关整体挂掉时，退避重试变成**持续 hammering**：每个请求照样失败，
 * 只是把失败摊得更久，还占着 run 闸位（`limits_concurrentRuns`）。
 * ⇒ 所以 §2B 要的是独立的 breaker：**连续失败达到阈值后，一段时间内直接拒绝**。
 * 本模块只做这件事，不做排队、不做降级文案（那是 PR-G 的事）。
 *
 * 三个刻意的设计选择：
 * 1. **键是"出口"不是"模型"**：`breakerKeyFor()` 取 baseURL 的 origin。
 *    若按模型分键，一个死网关会形成 12 个各自独立的熔断器，每个都还要先烧满一轮重试——
 *    那正是 D39 说的"假装能救"。
 * 2. **只计网关级失败**：429/5xx/无状态码的传输错误（连不上、DNS、socket 断），
 *    以及共用 key 带来的 `invalid api key` / `insufficient quota`。
 *    **不计**请求自身的问题（上下文超长、内容审核），也不计 `abort`（客户端关了页面）——
 *    否则一个超长请求就能把所有人的会话判死，那比原缺陷更糟。
 * 3. **默认关**（`enabled !== true` 一律不启用）。同 `upstreamRetry`、`cron_backfill*` 的口径：
 *    会改变现网请求结果的开关，默认值必须站在"不做事"那一边。
 *
 * 一个必须说清的局限（别把它读成全局保护）：状态在**进程内**，
 * N 个副本就是 N 个独立熔断器；半开探测每副本各放一条。共享熔断需要外部存储，
 * 那是另一件事，这里不留"看起来是全局的"错觉。
 */

/** 熔断器默认参数（`enabled` 默认 false，见模块注释第 3 条） */
export const BREAKER_DEFAULTS = {
    enabled: false,
    /** 连续多少次网关级失败后打开 */
    failureThreshold: 5,
    /** 打开后拒绝多久（毫秒）；到期转半开，放一条探测 */
    openMs: 15000,
}
/** 下限保护：`openMs` 小于一个正常 run 的量级时，熔断会反复吞掉正在跑的请求 */
export const BREAKER_MIN_OPEN_MS = 1000
/** 上限保护：写错一个 0 或多打一位数，不该让服务从此拒绝一切 */
export const BREAKER_MAX_OPEN_MS = 300000
export const BREAKER_MAX_THRESHOLD = 100

/**
 * 网关级 fatal 的正则：与 `UPSTREAM_PERMANENT_PATTERNS` 有交集，但**含义不同**。
 * 那边问的是"重试有没有可能变好"（答案：不可能），
 * 这边问的是"上游是不是整体不可用"（答案：key/额度坏了 = 12 档一起死）。
 * 上下文超长在前者算永久、在后者**不算**——它是这一个请求的问题。
 */
export const GATEWAY_FATAL_PATTERNS = [
    /invalid.{0,8}api.{0,8}key/i,
    /insufficient (quota|balance|credit)/i,
    /exhausted (quota|credits?)/i,
]
/** 这些状态码代表鉴权/额度层面坏了，同样是出口级信号 */
export const GATEWAY_FATAL_STATUS = [401, 403]

/**
 * @description 把 cfg（可能来自 env，值是**字符串**）归一成可执行配置
 * @param {Object} [params.cfg] `config.upstreamBreaker`
 * @returns {{enabled: Boolean, failureThreshold: Number, openMs: Number, notes: Array<String>}} 结果
 * @description
 * 这里必须做类型换算：`process.env` 出来的永远是字符串，
 * 而本方案已经被这条咬过（`FASTIFY_CLOSE_GRACE_DELAY` 传字符串 ⇒ close-with-grace 当成"无上限"）。
 * 归一规则与 `upstreamRetry` 一致：**只有 === true 才算开**，字符串 "true" 不算。
 */
export function resolveBreakerConfig({cfg = {}} = {}) {
    const notes = []
    const enabled = cfg.enabled === true
    let failureThreshold = Number(cfg.failureThreshold)
    if (!Number.isFinite(failureThreshold) || failureThreshold < 1) {
        if (cfg.failureThreshold !== undefined) {
            notes.push(`failureThreshold "${cfg.failureThreshold}" 无效，用默认 ${BREAKER_DEFAULTS.failureThreshold}`)
        }
        failureThreshold = BREAKER_DEFAULTS.failureThreshold
    }
    failureThreshold = Math.min(BREAKER_MAX_THRESHOLD, Math.round(failureThreshold))
    let openMs = Number(cfg.openMs)
    if (!Number.isFinite(openMs) || openMs <= 0) {
        if (cfg.openMs !== undefined) {
            notes.push(`openMs "${cfg.openMs}" 无效，用默认 ${BREAKER_DEFAULTS.openMs}`)
        }
        openMs = BREAKER_DEFAULTS.openMs
    }
    if (openMs < BREAKER_MIN_OPEN_MS) {
        notes.push(`openMs ${openMs} 小于下限，抬到 ${BREAKER_MIN_OPEN_MS}ms`)
        openMs = BREAKER_MIN_OPEN_MS
    }
    if (openMs > BREAKER_MAX_OPEN_MS) {
        notes.push(`openMs ${openMs} 超过上限，压到 ${BREAKER_MAX_OPEN_MS}ms（否则一次故障就永久拒绝）`)
        openMs = BREAKER_MAX_OPEN_MS
    }
    return {enabled, failureThreshold, openMs, notes}
}

/**
 * @description 求熔断键：取 baseURL 的 origin，让 12 个同出口模型收敛到同一个键
 * @param {Object} params 参数
 * @param {String} [params.baseURL] 模型档位配置的 baseURL
 * @param {String} [params.modelKey] 仅用于解析失败时的回退标识
 * @returns {String} 键
 */
export function breakerKeyFor({baseURL, modelKey = ''} = {}) {
    const raw = String(baseURL || '').trim()
    if (raw === '') {
        /** 没有 baseURL 就不要退化成"所有请求共用一个空键"——那会把不相干的出口捆在一起熔断 */
        return modelKey ? `unknown:${modelKey}` : ''
    }
    try {
        const u = new URL(raw)
        if (!u.host) {
            return `raw:${raw}`
        }
        return u.origin
    } catch (e) {
        return `raw:${raw}`
    }
}

/**
 * @description 这次失败是否该计入熔断
 * @param {Object} params 参数
 * @param {Object} params.errorInfo `describeError` 的产物 {kind, message, status}
 * @param {{retryable: Boolean, permanent: Boolean, reason: String}} params.cls `classifyUpstreamError` 的结果
 * @returns {{counts: Boolean, reason: String}} 结果
 */
export function breakerCountsFailure({errorInfo = {}, cls = {}} = {}) {
    /** 客户端中断永不计入：否则"用户关了页面"会熔断掉别人的会话 */
    if (cls.reason === 'abort' || errorInfo.kind === 'abort') {
        return {counts: false, reason: 'abort'}
    }
    if (cls.retryable) {
        return {counts: true, reason: cls.reason || 'retryable'}
    }
    const msg = String(errorInfo.message || '')
    if (GATEWAY_FATAL_PATTERNS.some(re => re.test(msg))) {
        return {counts: true, reason: 'gateway-fatal-message'}
    }
    if (GATEWAY_FATAL_STATUS.includes(Number(errorInfo.status))) {
        return {counts: true, reason: `gateway-fatal-status-${Number(errorInfo.status)}`}
    }
    return {counts: false, reason: cls.reason || 'not-counted'}
}

/**
 * @description 建一个进程内熔断器
 * @param {Object} [params] 参数
 * @param {Object} [params.cfg] 已归一或未归一的配置（内部会再归一）
 * @param {Function} [params.now] 时钟（测试注入）
 * @param {Function} [params.log] 观测钩子
 * @returns {Object} {allow, recordFailure, recordSuccess, snapshot, reset, config}
 */
export function createBreaker({cfg = {}, now = Date.now, log = () => {}} = {}) {
    const conf = resolveBreakerConfig({cfg})
    /** @type {Map<String, Object>} */
    const states = new Map()

    /**
     * @description 取或建某出口的状态
     * @param {String} key 出口键
     * @returns {Object} 状态
     */
    function stateOf(key) {
        let s = states.get(key)
        if (!s) {
            s = {failures: 0, openedAt: 0, probeInFlight: false}
            states.set(key, s)
        }
        return s
    }

    /**
     * @description 现在是否放行
     * @param {Object} p 参数
     * @param {String} p.key 出口键
     * @returns {{allowed: Boolean, reason: String, retryAfterMs: Number, phase: String}} 决策
     */
    function allow({key = ''} = {}) {
        if (!conf.enabled) {
            return {allowed: true, reason: 'breaker-disabled', retryAfterMs: 0, phase: 'off'}
        }
        if (!key) {
            /** 键都算不出来就别熔断：宁可放行让正常错误处理接管，也不要凭空串把所有流量捆一起拒 */
            return {allowed: true, reason: 'no-key', retryAfterMs: 0, phase: 'off'}
        }
        const s = stateOf(key)
        const t = now()
        if (s.openedAt > 0) {
            const elapsed = t - s.openedAt
            if (elapsed < conf.openMs) {
                return {
                    allowed: false, reason: 'open',
                    retryAfterMs: conf.openMs - elapsed, phase: 'open',
                }
            }
            if (s.probeInFlight) {
                /** 半开只放一条：放开成 N 条就等于没有熔断，只是把 hammering 延后一轮 */
                return {allowed: false, reason: 'probe-in-flight', retryAfterMs: 100, phase: 'half-open'}
            }
            s.probeInFlight = true
            log({note: 'breaker half-open probe', key, elapsedMs: elapsed})
            return {allowed: true, reason: 'half-open-probe', retryAfterMs: 0, phase: 'half-open'}
        }
        return {allowed: true, reason: 'closed', retryAfterMs: 0, phase: 'closed'}
    }

    /**
     * @description 记一次失败
     * @param {Object} p 参数
     * @param {String} p.key 出口键
     * @param {Boolean} [p.counts] 是否计入（来自 `breakerCountsFailure`）
     * @param {String} [p.reason] 原因（留痕用）
     * @returns {Object} 记录后的状态摘要
     */
    function recordFailure({key = '', counts = true, reason = ''} = {}) {
        const s = stateOf(key)
        if (!conf.enabled || !key) {
            return {phase: 'off', failures: s.failures}
        }
        if (!counts) {
            return {phase: s.openedAt > 0 ? 'open-or-probe' : 'closed', failures: s.failures, skipped: reason}
        }
        const wasProbe = s.probeInFlight || s.openedAt > 0
        s.failures += 1
        /** 半开探测失败 ⇒ 立刻重新打开，不等阈值：那一条本来就是"你好了吗"的提问 */
        if (wasProbe || s.failures >= conf.failureThreshold) {
            s.openedAt = now()
            s.probeInFlight = false
            log({note: 'breaker opened', key, failures: s.failures, reason, probe: wasProbe, openMs: conf.openMs})
        }
        return {phase: s.openedAt > 0 ? 'open' : 'closed', failures: s.failures}
    }

    /**
     * @description 记一次成功（闭合电路并清零）
     * @param {Object} p 参数
     * @param {String} p.key 出口键
     * @returns {Object} 记录后的状态摘要
     */
    function recordSuccess({key = ''} = {}) {
        const s = stateOf(key)
        if (!conf.enabled || !key) {
            return {phase: 'off', failures: 0}
        }
        const reopened = s.openedAt > 0 || s.probeInFlight
        s.failures = 0
        s.openedAt = 0
        s.probeInFlight = false
        if (reopened) {
            log({note: 'breaker closed after success', key})
        }
        return {phase: 'closed', failures: 0}
    }

    /**
     * @description 当前快照（`/runStats` 与测试用）
     * @returns {Object} 快照
     */
    function snapshot() {
        const t = now()
        return {
            enabled: conf.enabled,
            failureThreshold: conf.failureThreshold,
            openMs: conf.openMs,
            出口: [...states.entries()].map(([key, s]) => ({
                key,
                phase: s.openedAt > 0 ? (t - s.openedAt < conf.openMs ? 'open' : 'half-open-due') : 'closed',
                failures: s.failures,
                openedAgoMs: s.openedAt > 0 ? t - s.openedAt : null,
                probeInFlight: s.probeInFlight,
            })),
        }
    }

    return {allow, recordFailure, recordSuccess, snapshot, config: conf, reset: () => states.clear()}
}

/** 进程内单例：`withUpstreamRetry` 与各调用点必须看到同一份状态 */
let singleton = null

/**
 * @description 取进程内熔断器（配置变了就重建，避免"改了 env 但单例还拿着旧参数"）
 * @param {Object} [params.cfg] `config.upstreamBreaker`
 * @param {Function} [params.now] 时钟
 * @param {Function} [params.log] 观测钩子
 * @returns {Object} 熔断器
 */
export function getBreaker({cfg = {}, now = Date.now, log = () => {}} = {}) {
    const conf = resolveBreakerConfig({cfg})
    const sig = JSON.stringify(conf)
    if (!singleton || singleton.__sig !== sig) {
        singleton = createBreaker({cfg, now, log})
        singleton.__sig = sig
    }
    return singleton
}

/**
 * @description 仅供测试：清掉单例
 * @returns {void}
 */
export function __resetBreakerForTest() {
    singleton = null
}
