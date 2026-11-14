/**
 * @fileOverview 全局并发闸（PR-0.4 剩余项：跨 worker 的一份账）
 * @module services/core/session/globalRunGate
 * @description
 * `runGate` 的读数只有本进程那么大（§config 注释：2 worker ⇒ 天花板 ≈ limit×2）。这一层把它换成
 * **全站一份账**：redis ZSET + 单段 Lua——"清死账 → 数总量 → 数每人 → 占位"在一次原子执行里完成，
 * 两个 worker 同时挤门也只会有一个能占上最后一个位置（这不是锁：没有持有者、没有续期、没有红锁税，
 * D38 那笔账我们躲不掉但只欠一次 EVAL）。
 *
 * 三条口径继承既有裁定，不重新发明：
 * 1. **默认关**：`global.enabled !== true` ⇒ 连 redis 都不碰（root.js 门在 `limit>0` 之内、本模块之前）；
 * 2. **fail-open**：redis 不可用/脚本异常 ⇒ 放行 + warn（同 P5 重叠检测"读不懂数据一律放行"与
 *    acquireOnce"放行优先于去重"——把"我数不了"变成"大家不能提问"是比不设闸更坏的故障）；
 * 3. **拒绝回复形态复用 `rejectResponse`**（HTTP 200 + code 4290 + success:false，v1.30 四端实测的结论）。
 *
 * 死账自愈：登记条目带分数（占位时刻），每次 EVAL 先删 `maxRunAgeMs` 之前的残骸——进程崩溃没走到
 * finally 的 release 不会永久占位。键带 hash-tag `{llm-runz}`：cluster 下两键同槽（EVAL 多键的硬要求），
 * 单机下无害。
 */

import {GATE_REJECT_CODE, rejectResponse} from './runGate.js'
import {md5} from '../../../tools/security.js'

/** 键前缀含 hash-tag，保证 global/user 两键同槽 */
export const GLOBAL_RUN_ZKEY = '{llm-runz}:g'
export const userRunZKey = (userCode) => `{llm-runz}:u:${md5(String(userCode || 'anon'))}`

/**
 * KEYS[1]=全局 ZSET，KEYS[2]=该用户 ZSET。
 * ARGV: member, nowMs, staleBeforeMs, limit, perUserLimit, ttlSeconds
 * 返回 {0|−1|−2, 计数}：0=已占位，−1=全局满，−2=该用户满。
 */
export const ADMISSION_LUA = `
local g = KEYS[1]
local u = KEYS[2]
redis.call('ZREMRANGEBYSCORE', g, '-inf', ARGV[3])
redis.call('ZREMRANGEBYSCORE', u, '-inf', ARGV[3])
local limit = tonumber(ARGV[4])
if limit > 0 and redis.call('ZCARD', g) >= limit then
  return {-1, redis.call('ZCARD', g)}
end
local per = tonumber(ARGV[5])
if per > 0 and redis.call('ZCARD', u) >= per then
  return {-2, redis.call('ZCARD', u)}
end
redis.call('ZADD', g, ARGV[2], ARGV[1])
redis.call('ZADD', u, ARGV[2], ARGV[1])
redis.call('EXPIRE', g, ARGV[6])
redis.call('EXPIRE', u, ARGV[6])
return {0, redis.call('ZCARD', g)}
`

/** 全局闸开没开（关 ⇒ 调用方连 store 都不该构造） */
export function globalGateEnabled(cfg = {}) {
    return cfg?.global?.enabled === true && Number(cfg.limit) > 0
}

/** Lua 返回 → 决策对象（形状与 decideAdmission 的产物一致，rejectResponse 直接可用） */
export function parseAdmissionResult(res, {limit = 0, perUserLimit = 0, retryAfterMs = 1500} = {}) {
    const [flag, count] = Array.isArray(res) ? [Number(res[0]), Number(res[1])] : [Number(res?.[0]), Number(res?.[1])]
    if (![0, -1, -2].includes(flag)) {
        // 未知返回=脚本/服务端异常，交给 admitGlobal 的 catch 走 fail-open——"没读懂"不能冒充"满了"去误拒
        throw new Error(`全局闸返回未知结果: ${JSON.stringify(res)?.slice(0, 120)}`)
    }
    if (flag === 0) {
        return {admit: true, code: 0, reason: 'ok', retryAfterMs: 0, active: count, limit: Number(limit) || 0}
    }
    const reason = flag === -2 ? 'user-full' : 'global-full'
    return {admit: false, code: GATE_REJECT_CODE, reason, retryAfterMs: Number(retryAfterMs) || 1500, active: count, limit: Number(limit) || 0}
}

/**
 * @description 生产 store（ioredis v5，eval/zrem 原生 Promise）
 * @param {Object} client ioredis 实例
 * @param {Object} cfg `limits.concurrentRuns`
 */
export function createRedisStore(client, cfg = {}) {
    const maxRunAgeMs = Number(cfg?.global?.maxRunAgeMs) || 900000
    // TTL 只是最后防线（活跃集合平时靠 ZREMRANGEBYSCORE 收缩）；比死账线多 5 分钟
    const ttlSeconds = Math.ceil(maxRunAgeMs / 1000) + 300
    return {
        admit: async ({messageCode, userCode, now}) => client.eval(
            ADMISSION_LUA, 2, GLOBAL_RUN_ZKEY, userRunZKey(userCode),
            String(messageCode), String(now), String(now - maxRunAgeMs),
            String(Number(cfg.limit) || 0), String(Number(cfg.perUserLimit) || 0), String(ttlSeconds),
        ),
        release: async ({messageCode, userCode}) => {
            await client.zrem(GLOBAL_RUN_ZKEY, String(messageCode))
            await client.zrem(userRunZKey(userCode), String(messageCode))
        },
        /** 观测用：当前全局计数（不干净化，读数窗口自己知道这是近似值） */
        countGlobal: async () => client.zcard(GLOBAL_RUN_ZKEY),
    }
}

/**
 * @description 占位（fail-open：store 异常 ⇒ 放行 + 如实的 reason，由调用方决定记 warn）
 * @param {Object} params {store, messageCode, userCode, now, cfg, logger}
 * @returns {Promise<{admit:Boolean, decision:Object, response?:Object, degraded?:Boolean}>} 结果
 */
export async function admitGlobal({store, messageCode, userCode, now = Date.now(), cfg = {}, logger} = {}) {
    try {
        const res = await store.admit({messageCode, userCode, now})
        const decision = parseAdmissionResult(res, {
            limit: cfg.limit, perUserLimit: cfg.perUserLimit, retryAfterMs: cfg.retryAfterMs,
        })
        if (decision.admit) return {admit: true, decision}
        return {admit: false, decision, response: rejectResponse(decision)}
    } catch (e) {
        if (logger?.warn) logger.warn(`全局闸计数失败，放行（fail-open 是裁定不是偷懒）: ${String(e?.message || e).slice(0, 160)}`)
        return {admit: true, degraded: true, decision: {admit: true, code: 0, reason: 'store-unavailable', retryAfterMs: 0, active: -1, limit: Number(cfg.limit) || 0}}
    }
}

/** 注销（尽力而为：失败只 warn——死账线会兜住，不能让清理失败卡住响应收尾） */
export async function releaseGlobal({store, messageCode, userCode, logger} = {}) {
    try {
        await store.release({messageCode, userCode})
        return true
    } catch (e) {
        if (logger?.warn) logger.warn(`全局闸注销失败，交由死账线回收: ${String(e?.message || e).slice(0, 160)}`)
        return false
    }
}

export default {GLOBAL_RUN_ZKEY, userRunZKey, ADMISSION_LUA, globalGateEnabled, parseAdmissionResult, createRedisStore, admitGlobal, releaseGlobal}
