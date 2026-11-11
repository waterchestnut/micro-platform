/**
 * @fileOverview agentTask 的执行认领（lease）——让"恢复"能分清"没人跑"与"有人在跑"
 * @module services/agent/execClaim
 * @description
 * 为什么需要它（v1.80 的判断落在这里）：`handleStatus=0` 且滞留超阈值**无法区分**
 * "流水线随进程重启蒸发"与"消费者只是排得慢"。前者重执行是对的，后者会**双跑有副作用的任务**
 * （生成 PPT、上传 doc.api、花上游 token）。恢复要么放弃，要么先拿到认领。
 *
 * **为什么不自己写 Lua CAS**：本仓已经有 `daos/redlock.js`（v5，含 driftFactor/retryJitter/
 * automaticExtensionThreshold 的调校），`updateAgentTaskWithLock` 用它做更新互斥，
 * 而且 `safeUnlock` 已经踩过并处理了"锁过期后再 release 会触发 redlock 重试卡死"这个坑。
 * 我再造一套 `SET NX + eval` 就是**同一个概念的第二份实现**——那是 PR-0.5 搬 llmModel 时
 * 立过规矩要明确禁止的事。这里只做"认领"这件事特有的语义：三值状态 + 角色决策。
 *
 * **与 `l2Cache.acquireOnce` 的关键区别**（照抄会出错，所以另写）：
 * `acquireOnce` 是 fail-open（redis 不可用返回 `true`，注释明写"放行优先于去重"）。
 * 那对"抑制重复投递"是对的；但认领的全部意义是**防双跑**，
 * 在 redis 挂掉时返回"拿到了"，它就恰好在最需要它的时候失效。
 * ⇒ 角色分开（`claimDecision`）：
 * - `executor`：拿不到认领也**照常执行**——不能让锁层的故障把用户任务卡死，
 *   只是这一次执行不受认领保护，日志要说明；
 * - `recover`：**只有明确拿到认领才动作**，其余一律跳过。恢复本来就是额外安全网，
 *   宁可这一轮不救，也不该制造第二个执行者。
 *
 * 争用代价是**实测**的，不是估的：沿用实例默认的 `retryCount:10` 时，
 * 资源被占一次 `acquire` 要等 **2187ms** 才失败；带上 `retryCount:0` 后是 **1ms**。
 * ⇒ 本模块一律以 `retryCount:0` 取锁，"快速失败"是设计的一部分而不是调优
 * （细节见 `acquireClaim` 里那段注释——包括"连不上"与"被占"为什么必须探一次才分得开）。
 */

/** 认领资源前缀。与更新互斥的 `updateAgentTask:` 分开：两种生命周期不同，撞在一起会互相误伤 */
export const CLAIM_RESOURCE_PREFIX = 'execAgentTask'

/** 默认租约毫秒。见 `leaseMs` 注释——这是个要按自己环境想清楚的数，不是常数 */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000

/**
 * @description 拼认领资源名
 * @param {String} agentCode 任务标识
 * @param {String} [prefix] 前缀
 * @returns {String} 资源名
 */
export function claimResource(agentCode, prefix = CLAIM_RESOURCE_PREFIX) {
    return `${prefix || CLAIM_RESOURCE_PREFIX}:${agentCode}`
}

/**
 * @description 延迟取 redlock 单例
 * @returns {Promise<Object|null>} redlock 实例，取不到返回 null
 */
async function defaultGetRedlock() {
    try {
        const mod = await import('../../daos/redlock.js')
        return mod.default || null
    } catch (e) {
        return null
    }
}

/**
 * @description 取执行认领
 * @param {Object} deps 依赖
 * @param {String} deps.agentCode 任务标识
 * @param {Number} [deps.leaseMs] 租约时长（必须大于该任务最长正常执行时间，否则保护会中途失效）
 * @param {Function} [deps.getRedlock] 注入 redlock（测试用）；默认延迟加载本仓单例
 * @returns {Promise<Object>} {state:'granted'|'held'|'unavailable', lock, ms, reason}
 *
 * `state` 是三值而不是布尔：**"被别人占着"和"问不到"必须分开**——
 * 压成一件事的话，恢复路径在 redis 故障时会以为自己"没抢到"而静默不救，
 * 运维从日志里看不出是没救还是救不了（本仓在 `writtenBy:unattributed` 上吃过同形亏）。
 *
 * **但这两态不能从错误本身分出来**：装的是 redlock 5.0.0-beta.2，dev 实测
 * "资源被占"和"连不上"抛的是同一个 `ExecutionError`、同一句消息，`err.attempts` 也读不出票型。
 * 第一版我写了个按类名分流的 `isLockedError`，**那是凭设想写的、没有验证过**——
 * 现在改成失败后探一次锁层可达性（`probeReachability`，只在失败路径、多一次 RTT）。
 * 顺带另一条被读数纠正的设计：`acquire` 必须带 `retryCount:0`。
 * 沿用实例默认（retryCount 10）时争用要等 **2187ms** 才失败，带上后是 **1ms**——
 * 认领要进执行路径，2 秒不是"保守"，是把去重机制变成延迟来源。
 */
export async function acquireClaim({agentCode, leaseMs = DEFAULT_LEASE_MS, getRedlock = defaultGetRedlock} = {}) {
    const t0 = Date.now()
    if (!agentCode) {
        return {state: 'unavailable', lock: null, ms: 0, reason: 'no-agent-code'}
    }
    let redlock = null
    /**
     * 取锁层这一步**必须在 try 里**：本模块的第一条存在理由是"不能把执行路径炸掉"，
     * 而注入进来的 getter 完全可能抛（默认实现是延迟 import，模块加载失败就是抛错不是返回 null）。
     * 这条是用例逼出来的——当时我把 `await getRedlock()` 写在 try 外面，测试直接把异常抛到了调用方。
     */
    try {
        redlock = await getRedlock()
    } catch (e) {
        return {state: 'unavailable', lock: null, ms: Date.now() - t0, reason: `get-lock-layer:${cut(e)}`}
    }
    if (!redlock) {
        return {state: 'unavailable', lock: null, ms: Date.now() - t0, reason: 'no-lock-layer'}
    }
    const duration = Number(leaseMs) > 0 ? Number(leaseMs) : DEFAULT_LEASE_MS
    try {
        /**
         * `retryCount: 0` 不是调优，是**接线的前提**，理由在 dev 实测量出来：
         * 沿用实例默认（`retryCount:10 × retryDelay:200 ± jitter`）时，
         * **争用一次 acquire 要等 2187ms**（attempts 共 11 次）才抛错；带 `retryCount:0` 是 **1ms**。
         * 认领要放进执行路径，2 秒的等待会直接加到每个"任务正在别处跑"的场景上，
         * 而争用本来就该立刻回答"占着，别管了"。
         */
        const lock = await redlock.acquire([claimResource(agentCode)], duration, {retryCount: 0})
        return {state: 'granted', lock, ms: Date.now() - t0, reason: 'acquired', probe: 'skipped'}
    } catch (e) {
        /**
         * **本仓装的是 redlock 5.0.0-beta.2，实测：争用与"连不上"抛出的是同一个 `ExecutionError`**，
         * 消息也一样（"unable to achieve a quorum during its retry window"），
         * `err.attempts` 里也读不出可用的票型信息（dev 实测为空对象）。
         * 所以我**不能**像第一版设计那样声称"从错误就能分 held / unavailable"——
         * 那句是凭设想写的，不是查出来的。分不开就只有两条路：假装能分（不诚实），
         * 或者**主动探一次可达性**：读一次锁层，通了就是"被人占着"，不通就是"问不到"。
         * 探测只在失败路径发生（成功路径一次都不多打），代价是一次 RTT，
         * 换来的是日志能说清真话——恢复侧跳过时，"没救"和"救不了"必须分清。
         */
        const probe = await probeReachability(redlock)
        return {
            state: probe === 'reachable' ? 'held' : 'unavailable',
            lock: null,
            ms: Date.now() - t0,
            reason: `${probe === 'reachable' ? 'locked' : 'lock-layer-unreachable'}:${cut(e)}`,
            probe,
        }
    }
}

/**
 * @description 探一次锁层是否可达（只在失败路径调用）
 * @param {Object} redlock redlock 实例
 * @returns {Promise<'reachable'|'unreachable'|'unknown'>} 探测结果
 */
async function probeReachability(redlock) {
    try {
        const client = redlock?.clients?.values?.().next?.().value
        if (!client || typeof client.get !== 'function') {
            /** 拿不到可探测的客户端：不许猜，如实报 unknown（决策侧与 unavailable 同等待遇） */
            return 'unknown'
        }
        await client.get('llmrun:claim:probe')
        return 'reachable'
    } catch (e) {
        return 'unreachable'
    }
}

/**
 * @description 续租
 * @param {Object} deps 依赖
 * @param {Object} deps.lock acquireClaim 拿到的锁
 * @param {Number} [deps.leaseMs] 新的租约长度
 * @returns {Promise<Object>} {ok:Boolean, reason:String, ms:Number}
 */
export async function extendClaim({lock, leaseMs} = {}) {
    const t0 = Date.now()
    if (!lock) {
        return {ok: false, reason: 'no-lock', ms: 0}
    }
    try {
        if (typeof lock.extend !== 'function') {
            /** 没有 extend 能力就不能假装能续：静默"续期成功"会让租约到点后失去保护 */
            return {ok: false, reason: 'extend-unsupported', ms: 0}
        }
        const next = await lock.extend(Number(leaseMs) > 0 ? Number(leaseMs) : DEFAULT_LEASE_MS)
        return {ok: true, reason: 'extended', ms: Date.now() - t0, lock: next}
    } catch (e) {
        return {ok: false, reason: `extend-failed:${cut(e)}`, ms: Date.now() - t0}
    }
}

/**
 * @description 释放认领（照 `safeUnlock` 的既有教训：已过期的锁不要再 release）
 * @param {Object} deps 依赖
 * @param {Object} deps.lock 锁
 * @param {Function} [deps.logger] 日志器
 * @returns {Promise<Object>} {ok:Boolean, skipped:Boolean, reason:String}
 *
 * 为什么这里要重复那个教训而不是直接 `release()`：redlock 在锁已过期后再 release 会进入重试路径，
 * 严重时把收尾卡住——`services/core/agentTask.js` 的 `safeUnlock` 就是为此存在的。
 * 两处逻辑看起来重复，但**把它抽出来要同时改更新互斥那条路径**，那是另一次带验证的重构，
 * 不该塞进这一刀里悄悄做。这里先复用同样的判据，并在注释里指向那个待合并项。
 */
export async function releaseClaim({lock, logger = null} = {}) {
    if (!lock) {
        return {ok: true, skipped: true, reason: 'no-lock'}
    }
    if (lock.expiration && lock.expiration < Date.now()) {
        return {ok: true, skipped: true, reason: 'already-expired'}
    }
    try {
        await lock.release()
        return {ok: true, skipped: false, reason: 'released'}
    } catch (e) {
        if (logger) {
            logger.warn(`agentTask 认领释放失败（不影响任务结果）: ${cut(e)}`)
        }
        return {ok: false, skipped: false, reason: `release-failed:${cut(e)}`}
    }
}

/**
 * @description 纯决策：给定角色与认领结果，要不要继续执行
 * @param {Object} p 参数
 * @param {'executor'|'recover'} p.role 调用方角色
 * @param {String} p.state acquireClaim 的 state
 * @returns {{proceed: Boolean, reason: String}} 决策
 *
 * 这张表本身就是这个模块的结论，不要在调用点用 if 再复述一遍：
 * - executor + held / unavailable：**继续**。正常路径已经是被派下来跑的，
 *   因为拿不到锁就不执行，等于把可选的去重升级成新的故障模式（用户任务直接不动）；
 * - recover + held：跳过——**这正是认领存在的目的**（有人在跑，别再开一个）；
 * - recover + unavailable：跳过。恢复是额外安全网，没有保护时它不该动作。
 */
export function claimDecision({role = 'executor', state = 'unavailable'} = {}) {
    if (role === 'recover') {
        return state === 'granted'
            ? {proceed: true, reason: 'claimed'}
            : {proceed: false, reason: `recover-need-claim:${state}`}
    }
    if (state === 'granted') {
        return {proceed: true, reason: 'claimed'}
    }
    if (state === 'held') {
        return {proceed: true, reason: 'executor-proceeds-unprotected'}
    }
    return {proceed: true, reason: 'executor-proceeds-no-claim-layer'}
}

/**
 * @description 该不该续租（避免每帧都打 redis）
 * @param {Object} p 参数
 * @param {Number} p.sinceRenewMs 距离上次续租的毫秒
 * @param {Number} [p.leaseMs] 当前租约长度
 * @param {Number} [p.ratio] 用掉多少比例后续租，默认 0.5
 * @returns {Boolean} 是否该续
 */
export function shouldRenew({sinceRenewMs = 0, leaseMs = DEFAULT_LEASE_MS, ratio = 0.5} = {}) {
    const lease = Number(leaseMs)
    if (!(lease > 0)) {
        return false
    }
    const r = Number(ratio) > 0 && Number(ratio) < 1 ? Number(ratio) : 0.5
    return Number(sinceRenewMs) >= lease * r
}

/**
 * @description 租约与滞留阈值的安全性判定（接线前必须先满足的条件）
 * @param {Object} p 参数
 * @param {Number} p.leaseMs 认领租约长度
 * @param {Number} p.stuckMs 恢复侧"滞留多久算中断"的阈值
 * @param {Number} [p.margin] 要求 `stuckMs >= leaseMs * margin`，默认 2
 * @returns {{ok: Boolean, reason: String}} 判定
 *
 * 为什么需要这条：恢复只处理"滞留超过 `stuckMs`"的任务。如果租约比它长，
 * **一个正常执行中的任务会先被恢复轮判定为"可以救"**——而它拿不到认领时会跳过（安全），
 * 但如果执行侧根本没接线（拿不到锁也照跑），跳过就不成立，两边就会同时跑。
 * 换句话说：`leaseMs` 与 `stuckMs` 是**一对必须一起想的数**，
 * 单独调其中一个就会悄悄破坏另一个的保护。
 * 默认要求滞留阈值至少是租约的 2 倍：留出"租约到期→下一轮扫描"的时间余量。
 */
export function leaseSafety({leaseMs = DEFAULT_LEASE_MS, stuckMs = 0, margin = 2} = {}) {
    const lease = Number(leaseMs)
    const stuck = Number(stuckMs)
    if (!(lease > 0)) {
        return {ok: false, reason: `lease-ms-invalid:${String(leaseMs)}`}
    }
    if (!(stuck > 0)) {
        return {ok: false, reason: `stuck-ms-invalid:${String(stuckMs)}`}
    }
    const m = Number(margin) > 1 ? Number(margin) : 2
    if (stuck < lease * m) {
        return {ok: false, reason: `stuck-too-small:${stuck}<${lease}*${m}`}
    }
    return {ok: true, reason: `stuck:${stuck}>=lease:${lease}*${m}`}
}

/**
 * @description 错误摘要（日志用，别把整条 stack 塞进一行）
 * @param {Object} e 错误
 * @returns {String} 摘要
 */
function cut(e) {
    return String(e?.message || e || 'unknown').slice(0, 120)
}

export default {
    CLAIM_RESOURCE_PREFIX, DEFAULT_LEASE_MS, claimResource,
    acquireClaim, extendClaim, releaseClaim, claimDecision, shouldRenew, leaseSafety,
}
