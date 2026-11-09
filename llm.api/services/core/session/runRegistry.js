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
 * @description 清空（只给测试与探针用；线上清空会把在途 run 的额度白送出去）
 * @returns {void}
 */
export function resetForTest() {
    runs.clear()
    for (const k of Object.keys(counters)) {
        counters[k] = 0
    }
}

export default {admitRun, releaseRun, snapshot, resetForTest}
