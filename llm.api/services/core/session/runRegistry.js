/**
 * @fileOverview 本进程在途 run 的登记表（PR-0.4 的计数侧，也是 PR-C runRegistry 的地基）
 * @module services/core/session/runRegistry
 * @description
 * 只做三件事：登记、注销、给快照。**判定在 `runGate.js`，路由只调这里的 `admitRun`/`releaseRun`。**
 *
 * 为什么要专门写"注销一定发生"这件事：一个数漏了，闸就会永久拒——而且症状是"过一会儿全站卡"，
 * 看起来像上游故障，最难查。所以：
 * - `releaseRun` 幂等（重复调用不报错、不多减）；
 * - 快照里带 `leakGuard`：只要出现过"注销次数 > 登记次数"就说明逻辑写错了，读数直接暴露它；
 * - 注册表只活在本进程（PM2 每 worker 一份），**不是全局状态**，见 `runGate.js` 文件头第 3 条。
 */
import {decideAdmission, rejectResponse} from './runGate.js'

/** messageCode -> {conversationCode, userCode, startedAt, channel} */
const runs = new Map()
const counters = {admitted: 0, rejected: 0, released: 0, overRelease: 0}

/**
 * @description 尝试登记一个 run
 * @param {Object} params 参数
 * @param {String} params.messageCode 本轮标识（必填：它是登记的唯一键）
 * @param {String} params.conversationCode 会话标识
 * @param {String} params.userCode 发起用户
 * @param {Object} [params.cfg] 闸配置（limit / perUserLimit / retryAfterMs）
 * @returns {{admit: Boolean, decision: Object, response?: Object}} 判定；拒绝时带对外回法
 */
export function admitRun({messageCode, conversationCode = '', userCode = '', cfg = {}} = {}) {
    const limit = Number(cfg.limit) || 0
    const decision = decideAdmission({
        active: runs.size,
        limit: cfg.limit,
        userActive: userCode ? [...runs.values()].filter(r => r.userCode === userCode).length : 0,
        perUserLimit: cfg.perUserLimit,
        retryAfterMs: cfg.retryAfterMs,
    })
    if (!decision.admit) {
        counters.rejected++
        return {admit: false, decision, response: rejectResponse(decision), registered: false}
    }
    /**
     * **关闸时完全不碰状态**（不登记、不计数）。
     * 这比"照样登记但不拒"多写一个判断，换来的是：默认配置下这张表恒空 ⇒
     * 既没有内存增长，也不可能出现"没开闸却泄漏格子"这种最难查的组合。
     * 代价要说清楚：`snapshot().active` 在关闸时恒为 0，**它不是负载读数**；
     * 读数接口会同时回 `gateEnabled:false`，避免有人把 0 读成"现在没人在跑"。
     */
    if (limit <= 0) {
        return {admit: true, decision, response: undefined, registered: false}
    }
    /**
     * 同一个 messageCode 重复进来（客户端重发、或断线后用同一个号续）：
     * **不新建第二格**，只刷新时间戳。否则一次重发就永久占两个位置，闸会被自己的重试喂满。
     */
    if (!messageCode) {
        /** 没有号就没法幂等登记：宁可不登记，也不留一个永远注销不掉的条目 */
        return {admit: true, decision: {...decision, reason: 'no-message-code'}, response: undefined, registered: false}
    }
    if (!runs.has(messageCode)) {
        runs.set(messageCode, {conversationCode, userCode, startedAt: Date.now()})
        counters.admitted++
    } else {
        runs.get(messageCode).startedAt = Date.now()
    }
    return {admit: true, decision, response: undefined, registered: true}
}

/**
 * @description 注销一个 run（必须在 finally 里调，且可以安全地重复调）
 * @param {String} messageCode 本轮标识
 * @returns {Boolean} 本次是否真的删掉了东西
 */
export function releaseRun(messageCode) {
    if (!messageCode) {
        return false
    }
    const had = runs.delete(messageCode)
    if (had) {
        counters.released++
    } else {
        /** 多减一次（重复 finally、或登记时因为没号没进表）要能被看见，不然 leakGuard 会假绿 */
        counters.overRelease++
    }
    return had
}

/**
 * @description 当前快照（给日志、拒绝响应与将来的 /resume、指标导出用）
 * @returns {{active: Number, rejected: Number, admitted: Number, released: Number, overRelease: Number, leakGuard: Number, oldestMs: Number, byUser: Object}} 读数
 */
export function snapshot() {
    const ages = [...runs.values()].map(r => Date.now() - r.startedAt)
    const byUser = {}
    for (const r of runs.values()) {
        byUser[r.userCode || '-'] = (byUser[r.userCode || '-'] || 0)
        byUser[r.userCode || '-'] += 1
    }
    /**
     * `accountingGap` 才是账平的判据：**任何时刻**都应等于 0
     * （登记过 − 已注销 − 还在表里 = 0）。
     *
     * 为什么不用"注销数 − 登记数"当泄漏哨兵：那一版我写的 `leakGuard` 在**在途中必然是负数**
     * （比如 2 个 run 正在跑时是 −2），探针第一次采到 −2 就差点被读成"漏了两格"。
     * 一个会在正常状态下报警的哨兵，等于没有哨兵。`overRelease` 仍然单独留着：
     * 它只在"注销了一个没登记过的键"时才涨，那才是真异常。
     */
    return {
        active: runs.size,
        admitted: counters.admitted,
        rejected: counters.rejected,
        released: counters.released,
        overRelease: counters.overRelease,
        accountingGap: counters.admitted - counters.released - runs.size,
        oldestMs: ages.length ? Math.max(...ages) : 0,
        byUser,
    }
}

/**
 * 停机落档用的函数表：**与闸的登记表分开存**（同一个文件、两张表）。
 * 为什么必须分开，是一条会静默失效的坑：`runRegistry` 在闸关闭时**根本不登记**
 * （`limits_concurrentRuns=0` 是默认值，见上面第 42-50 行）。
 * 如果关闭序列去遍历那张表，默认配置下集合恒空 ⇒ "我们修好了停机丢档"这句话
 * 会在所有没开闸的环境里悄悄变成假的。
 */
const archives = new Map()

/**
 * @description 挂上"这一轮的落档函数"，供关闭序列主动调用
 * @param {String} messageCode 本轮标识
 * @param {Function} archive 无参异步函数：把当前已有的正文落成终态
 * @returns {Boolean} 是否挂上（没 messageCode 或不是函数就挂不上，调用方要能看见）
 */
export function attachArchive(messageCode, archive) {
    if (!messageCode || typeof archive !== 'function') {
        return false
    }
    archives.set(messageCode, archive)
    return true
}

/**
 * @description 摘掉落档函数（run 正常收尾后必须摘，否则关闭时会重复落档）
 * @param {String} messageCode 本轮标识
 * @returns {Boolean} 是否真的摘掉了
 */
export function detachArchive(messageCode) {
    return archives.delete(messageCode)
}

/**
 * @description 当前挂着的落档函数数量（`/runStats` 用它证明"闸关着也有这张表"）
 * @returns {Number} 数量
 */
export function archiveCount() {
    return archives.size
}

/**
 * @description 停机时主动把在途 run 落档（**不等客户端断开被察觉**）
 * @param {Object} [params] 参数
 * @param {Number} [params.perRunTimeoutMs] 单条时限：关闭预算是共享的，一条卡死不等于全部卡死
 * @param {Function} [params.now] 时间源（测试注入）
 * @returns {Promise<Array<{messageCode: String, ok: Boolean, ms: Number, error: String}>>} 逐条结果
 *
 * 三条口径：
 * 1. 一条失败不影响其他条——这是抢救，不是事务；
 * 2. 每条都有时限，超时就记失败继续走（否则 SIGKILL 会替我们决定所有人都不落）；
 * 3. **逐条回报结果**："落了档"只能由这些读数支撑，不能由我的一句话支撑。
 */
export async function archiveAllInflight({perRunTimeoutMs = 3000, now = Date.now} = {}) {
    const entries = [...archives.entries()]
    const out = []
    for (const [messageCode, archive] of entries) {
        const t = now()
        try {
            await Promise.race([
                Promise.resolve(archive()),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error(`archive timeout ${perRunTimeoutMs}ms`)), perRunTimeoutMs)),
            ])
            out.push({messageCode, ok: true, ms: now() - t, error: ''})
        } catch (e) {
            out.push({messageCode, ok: false, ms: now() - t, error: String(e?.message || e).slice(0, 160)})
        }
    }
    return out
}

/**
 * @description 清空（只给测试与探针用；线上清空会把在途 run 的额度白送出去）
 * @returns {void}
 */
export function resetForTest() {
    archives.clear()
    runs.clear()
    eventLogs.clear()
    for (const k of Object.keys(logCounters)) {
        logCounters[k] = 0
    }
    for (const k of Object.keys(counters)) {
        counters[k] = 0
    }
}

export default {admitRun, releaseRun, snapshot, resetForTest}
/**
 * ------------------------------------------------------------------
 * 事件日志表（PR-C 的 `/resume` 数据源）
 * ------------------------------------------------------------------
 * **与闸的登记表、落档函数表分开存**，理由和 `archives` 完全一样：
 * `limits_concurrentRuns` 默认 0，此时 `runs` 恒空 ⇒ 如果日志挂在 `runs` 上，
 * 默认配置下 `/resume` 会**永远查不到任何一轮**，而单元测试里我多半会开着闸测，全绿上线。
 *
 * 三条纪律：
 * 1. **只活在本进程**。跨副本续接需要 Redis（PR-C 已定，§25 的 Redis 运维税那格）。
 *    这里不假装能跨 pod：dev/prod 多副本时，续接请求落到别的副本会拿到
 *    `EVENT_LOG_UNAVAILABLE`，那是**诚实的答案**而不是"续上了但少了东西"。
 * 2. **有界**。条数、字节、时长三重上限；淘汰只丢已结束的 run，**不丢在途的**——
 *    丢在途的等于把它的数据源删了，比丢一条更旧的严重得多。
 * 3. 上限变化要能看见：`stats()` 里有 `dropped` 三个计数，`/runStats` 直接读。
 */
const DEFAULT_LOG_TTL_MS = 120000
const DEFAULT_LOG_MAX_RUNS = 200
const DEFAULT_LOG_MAX_TOTAL_BYTES = 32 * 1024 * 1024

/** messageCode -> {log, finishedAt, ttlMs} */
const eventLogs = new Map()
const logCounters = {attached: 0, droppedTtl: 0, droppedCount: 0, droppedBytes: 0}

/**
 * @description 挂上一轮的事件日志（重复挂同一个键会替换：同一轮重开流时旧日志已失效）
 * @param {String} messageCode 本轮标识
 * @param {Object} log `createRunEventLog()` 的产物
 * @param {Object} [opt] 保留与归属
 * @param {Number} [opt.ttlMs] 结束后保留时长
 * @param {String} [opt.userCode] **发起者**：续接时必须同级校验，见下面归属注释
 * @param {String} [opt.conversationCode] 会话标识（诊断与快照指引用）
 * @returns {Boolean} 是否挂上（无 messageCode 或 log 不合接口就挂不上）
 */
export function attachEventLog(messageCode, log, {ttlMs = DEFAULT_LOG_TTL_MS, userCode = '', conversationCode = ''} = {}) {
    if (!messageCode || !log || typeof log.since !== 'function' || typeof log.record !== 'function') {
        return false
    }
    eventLogs.set(messageCode, {
        log,
        finishedAt: 0,
        userCode,
        conversationCode,
        attachedAt: Date.now(),
        ttlMs: Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_LOG_TTL_MS,
    })
    logCounters.attached++
    sweepEventLogs()
    return true
}

/**
 * @description 取一整条登记项（含归属），过期的顺手清掉
 * @param {String} messageCode 本轮标识
 * @returns {Object|null} 登记项
 *
 * 归属为什么记在**进程里**而不是查库：`/resume` 的典型场景是"这一轮还在跑，客户端断了"，
 * 那时 message 表里可能还没有这条 assistant 记录（落库在收尾或中断归档时才发生）。
 * 查库判归属会在最该续接的时刻判不出，退化成"查不到就放行"——那正好是要防的缺陷。
 */
export function getEventLogEntry(messageCode) {
    const hit = eventLogs.get(messageCode)
    if (!hit) {
        return null
    }
    if (hit.finishedAt && Date.now() - hit.finishedAt > hit.ttlMs) {
        eventLogs.delete(messageCode)
        logCounters.droppedTtl++
        return null
    }
    return hit
}

/**
 * @description 取某轮的事件日志
 * @param {String} messageCode 本轮标识
 * @returns {Object|null} 日志句柄
 */
export function getEventLog(messageCode) {
    return getEventLogEntry(messageCode)?.log || null
}

/**
 * @description 标记该轮已结束（开始计 TTL，并交还日志句柄给调用方收尾）
 * @param {String} messageCode 本轮标识
 * @returns {Object|null} 日志句柄；没挂过返回 null
 */
export function finishEventLog(messageCode) {
    const hit = eventLogs.get(messageCode)
    if (!hit) {
        return null
    }
    hit.finishedAt = Date.now()
    return hit.log
}

/**
 * @description 立即摘掉某轮日志（run 释放时用；幂等）
 * @param {String} messageCode 本轮标识
 * @returns {Boolean} 是否真的摘掉了
 */
export function detachEventLog(messageCode) {
    return eventLogs.delete(messageCode)
}

/**
 * @description 有界清理：按时长、条数、总量字节三重上限淘汰**已结束的** run
 * @param {Object} [opt] 参数（测试注入用）
 * @param {Number} [opt.maxRuns] 同时保留的 run 数上限
 * @param {Number} [opt.maxTotalBytes] 全部日志的字节总预算
 * @returns {{scanned: Number, dropped: Number}} 本次清理读数
 */
export function sweepEventLogs({maxRuns = DEFAULT_LOG_MAX_RUNS, maxTotalBytes = DEFAULT_LOG_MAX_TOTAL_BYTES} = {}) {
    const now = Date.now()
    const capRuns = Number(maxRuns) > 0 ? Number(maxRuns) : DEFAULT_LOG_MAX_RUNS
    const capBytes = Number(maxTotalBytes) > 0 ? Number(maxTotalBytes) : DEFAULT_LOG_MAX_TOTAL_BYTES
    const before = eventLogs.size
    /** 先按时长清：已结束且过期的直接走（在途的永远不动） */
    for (const [k, v] of [...eventLogs.entries()]) {
        if (v.finishedAt && now - v.finishedAt > v.ttlMs) {
            eventLogs.delete(k)
            logCounters.droppedTtl++
        }
    }
    /** 再按条数清：只从"已结束里最早结束的"开始丢 */
    const finishedFirst = (a, b) => (a[1].finishedAt || Infinity) - (b[1].finishedAt || Infinity)
    while (eventLogs.size > capRuns) {
        const victim = [...eventLogs.entries()].sort(finishedFirst).find(([, v]) => v.finishedAt)
        if (!victim) {
            break
        }
        eventLogs.delete(victim[0])
        logCounters.droppedCount++
    }
    /** 最后按字节清：同上，且在途的即使很大也不动（它的数据源删不得） */
    const bytesOf = () => [...eventLogs.values()].reduce((s, v) => s + (v.log?.stats?.().bytes ?? 0), 0)
    while (bytesOf() > capBytes) {
        const victim = [...eventLogs.entries()].sort(finishedFirst).find(([, v]) => v.finishedAt)
        if (!victim) {
            break
        }
        eventLogs.delete(victim[0])
        logCounters.droppedBytes++
    }
    return {scanned: before, dropped: before - eventLogs.size}
}

/**
 * @description 日志表读数（给 `/runStats` 与探针）
 * @returns {Object} 读数
 */
export function eventLogStats() {
    const list = [...eventLogs.values()]
    const bytes = list.reduce((s, v) => s + (v.log?.stats?.().bytes ?? 0), 0)
    return {
        attached: logCounters.attached,
        retained: eventLogs.size,
        inflight: list.filter(v => !v.finishedAt).length,
        finished: list.filter(v => v.finishedAt).length,
        bytes,
        dropped: {
            ttl: logCounters.droppedTtl,
            count: logCounters.droppedCount,
            bytes: logCounters.droppedBytes,
        },
    }
}

