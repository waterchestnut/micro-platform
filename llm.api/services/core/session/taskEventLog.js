/**
 * @fileOverview 编排 root 的任务事件日志镜像（M1-c 刀 1，写侧+回放读侧）
 * @module services/core/session/taskEventLog
 * @description
 * M1-c 的账本地基："现在只有终态可读，没有直播"（root.js 受理注释的自白）——要直播，
 * 事件必须先有一本**跨进程可读的账**：执行链在 executor/cron 进程跳，订阅者在 http 进程，
 * 内存 emit 谁也看不见谁。这本账就是 redis Stream（与 runEventLogStore 同族同纪律）。
 *
 * 游标为什么用 **Stream 原生 id** 而不是自增 seq（v1 草案的跨进程坑，写测试时抓到）：
 * 任务事件由多个进程写同一个键（受理在 http、child 终局在 executor、finalize 段界在
 * executor/cron）——各自数 1,2,3 必然撞号，"连续性"在跨进程下根本不成立。
 * Stream id 由服务端生成、单键内单调，天然就是跨写者的全序：**谁写都不需要协调**。
 * 代价如实记：id 不是连续整数，MAXLEN 修剪掉的旧事件**检不出洞**（无法用"号不挨着"判断）——
 * 但里程碑事件量级是"每树几十条"，默认 500 条窗在实测容量（P-8 批核算）内不会触顶；
 * 真触顶时订阅端拿到的是"窗口内最新一段"，detail 面（账本事实）仍是兜底。
 *
 * 三条纪律（逐字继承 runEventLogStore）：
 * 1. fail-open：写失败只计数不抛——事件是加法，不许变成编排关键路径的新故障源；
 * 2. 段界 `__end__`：root 会被 clarifyAnswer/grace 泵**多次 finalize**，每段以 __end__ 收口；
 *    回放读到段界即停（订阅者据此知道"这一段直播到头了"）；
 * 3. 专用客户端（redisEventClient，D38 隔离 db12）：绝不与 redlock/共享 cache 连接挤兑。
 */

export const TASK_EVENT_KEY_PREFIX = 'llmtask:events'

/**
 * 拼键（纯函数）。
 * @param {String} rootCode 编排 root
 * @param {String} [prefix] 键前缀
 * @returns {String}
 */
export function taskEventKey(rootCode, prefix = TASK_EVENT_KEY_PREFIX) {
    return `${prefix || TASK_EVENT_KEY_PREFIX}:${rootCode}`
}

/**
 * @description 建一个任务事件镜像（写侧）
 * @param {Object} deps
 * @param {Function} deps.getClient 异步取专用 ioredis 客户端（null ⇒ 静默降级）
 * @param {String} deps.rootCode 编排 root
 * @param {Object} [deps.cfg] {maxEvents,ttlSec,flushEvery,keyPrefix}
 * @returns {Object} {emit, finish, stats}
 */
export function createTaskEventMirror({getClient, rootCode, cfg = {}} = {}) {
    if (!rootCode) throw new Error('createTaskEventMirror 需要 rootCode')
    const key = taskEventKey(rootCode, cfg.keyPrefix)
    const maxEvents = Number(cfg.maxEvents) > 0 ? Number(cfg.maxEvents) : 500
    const ttlSec = Number(cfg.ttlSec) > 0 ? Number(cfg.ttlSec) : 3600
    const stats = {written: 0, failed: 0, droppedAfterFinish: 0, key}
    let finished = false

    async function writeOne(type, payload) {
        try {
            const client = await getClient()
            if (!client) { stats.failed++; return false }
            const pipe = client.pipeline()
            pipe.xadd(key, 'MAXLEN', '~', maxEvents, '*', 'type', String(type), 'data', payload)
            pipe.expire(key, ttlSec)
            await pipe.exec()
            stats.written++
            return true
        } catch (e) {
            stats.failed++
            const lg = (typeof llm !== 'undefined' && llm.logger) ? llm.logger : console
            lg.warn(`任务事件镜像写入失败（不影响任务本身）: ${rootCode} ${String(e?.message || e).slice(0, 140)}`)
            return false
        }
    }

    /**
     * 记一个事件（taskEvents 构造的 {type, ...payload}；游标=服务端 Stream id）。
     * @param {Object} event
     * @returns {Promise<Boolean>} 是否写入（fail-open：false 只代表账没记上，不代表任务出错）
     */
    async function emit(event) {
        if (finished) {
            stats.droppedAfterFinish++
            return false
        }
        const {type, ...rest} = event || {}
        if (!type) return false
        return await writeOne(type, JSON.stringify(rest))
    }

    /**
     * 段界：写 `__end__` + 定 TTL。此后 emit 丢弃（"结束后还在追加"的键不许存在）。
     * @param {String} outcome done/abort/error/await-input/...
     */
    async function finish({outcome = ''} = {}) {
        finished = true
        const ok = await writeOne('__end__', String(outcome || ''))
        return {outcome, ...stats, segmentClosed: ok}
    }

    return {emit, finish, stats: () => ({...stats, finished})}
}

/**
 * @description 回放/增量读：取 afterId 之后的事件（XRANGE (id + COUNT n）
 * @param {Object} p
 * @param {Function} p.getClient 专用客户端
 * @param {String} p.rootCode root
 * @param {String} [p.afterId] 游标（Stream id；'0' 或空=从头）
 * @param {Number} [p.count] 单次上限
 * @param {Object} [p.cfg] {keyPrefix}
 * @returns {Promise<Object>} {found, events:[{id,type,payload}], end, reason}
 *   reason ∈ ok / no-client / unreadable / missing / empty（窗口内没有新段）
 */
export async function readTaskEventLog({getClient, rootCode, afterId = '', count = 100, cfg = {}} = {}) {
    const key = taskEventKey(rootCode, cfg.keyPrefix)
    let raw
    try {
        const client = await getClient()
        if (!client) return {found: false, reason: 'no-client', events: [], end: null}
        const start = afterId && afterId !== '0' ? `(${afterId}` : '-'
        raw = await client.xrange(key, start, '+', 'COUNT', Math.max(1, Number(count) || 100))
    } catch (e) {
        const lg = (typeof llm !== 'undefined' && llm.logger) ? llm.logger : console
        lg.warn(`任务事件回放失败，按不可用处理: ${rootCode} ${String(e?.message || e).slice(0, 140)}`)
        return {found: false, reason: 'unreadable', events: [], end: null}
    }
    if (!raw?.length) {
        // afterId 有值时空窗=没有新事件（不是没这个键）；空键也走这里，用 EXISTS 分不开就不分——
        // 订阅端拿到 empty+lastId 原样回传即可，语义一致
        return {found: false, reason: 'empty', events: [], end: null}
    }
    const events = []
    let end = null
    for (const [id, flat] of raw) {
        const o = {}
        for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]
        if (o.type === '__end__') {
            end = {id, outcome: o.data || ''}
            break // 段界即终点：__end__ 之后的条目属于下一段，本响应不带
        }
        let payload = null
        try { payload = JSON.parse(o.data || '{}') } catch { payload = {raw: o.data} }
        events.push({id, type: o.type, payload})
    }
    return {found: true, reason: 'ok', events, end}
}

export default {TASK_EVENT_KEY_PREFIX, taskEventKey, createTaskEventMirror, readTaskEventLog}
