/**
 * @fileOverview 一轮 run 的 SSE 事件日志的 **Redis 承载**（PR-C 的跨副本续接）
 * @module services/core/session/runEventLogStore
 * @description
 * 为什么需要它：`runEventLog` 在进程内存里，dev/prod 都是多副本 ⇒ 续接请求落到别的副本
 * 只能拿到 `EVENT_LOG_UNAVAILABLE`（v1.68 已实测到这个读数，不是推测）。
 * D34 说断线重连是可用性下限，那"下限"在多副本下必须有个跨进程的说法。
 *
 * 三条纪律：
 * 1. **镜像失败绝不影响回答**（沿用 `l2Cache` 的 fail-open）：这是缓存层的加法，
 *    不能变成聊天关键路径上的新故障源。写失败只计数、只告警。
 * 2. **镜像丢帧必须变成可检出的 gap**：镜像是异步批量写的，中途丢几帧在物理上就可能发生。
 *    读侧因此**逐号检查连续性**，一旦有洞就报 gap——
 *    宁可让前端去走快照重建，也不给"看起来通顺但少了内容"的半截回答（§19 第 2 条的远程版）。
 * 3. **连接复用**：用的是 `redisClient.client` 那个单例 ioredis，**不新建连接**；
 *    客户端仍然**延迟加载**（`l2Cache` 约定 2：测试与纯函数模块不能被建连拖住）。
 *
 * 为什么用 Stream 而不是 List：`XADD ... MAXLEN ~` 把"追加 + 按容量截断"合成一次原子操作，
 * 用 List 就得自己维护"最早的号是多少"的偏移量，那份簿记正是会出错的地方。
 * seq 存在条目里（Stream 自己的 ID 是毫秒序，跟本轮游标体系无关）；
 * 一个 run 只被它的归属副本写，不存在多写者竞争。
 *
 * **`~` 是近似，这条有实测数字**（dev 隔离副本 `streamResume_redis_maxEvents=5`、一轮 67 帧）：
 * 留在 Stream 里的是 **37 条（seq 32..67）而不是 5 条**——Redis 按宏节点边界修剪，
 * 小流上几乎不裁。所以 `maxEvents` 的语义是**"约这个量级的内存上限"，不是硬条数**；
 * 要硬上限就去掉 `~`（精确修剪，代价是每次 XADD 更贵）。
 * 同轮实测键内存：27 帧 4776B、67 帧 9864B ⇒ 约 **150B/条目**，
 * 默认 2000 条上界≈300KB/轮，`ttlSec` 到点整体消失，不需要额外清理任务。
 * 另注：进程内的假 redis 实现的是**精确**截断，所以这个差别在离线用例里照不出来（v1.79 记了这件事）。
 */

/** 与 `runEventLog` 同一套机器可读码：前端只需要认一个码 */
export const GAP_CODE = 'EVENT_BUFFER_EXPIRED'

/** 默认键前缀。放在最外层是为了将来按环境隔离（dev/prod 共用一套 redis 时不至于串台） */
export const DEFAULT_KEY_PREFIX = 'llmrun:events'

/**
 * @description 取那个**已存在的** ioredis 单例（延迟加载，失败返回 null）
 * @returns {Promise<Object|null>} 客户端或 null
 *
 * 两条理由都来自本仓既有纪律：
 * - **不新建连接**：`daos/cache/redisClient.js` 里的 `client` 是全进程一个，
 *   续接若再开一个连接，D33 那套"按 1 pod × 2 worker 算 Redis 连接数"的账就要重算；
 * - **延迟 import**：`l2Cache` 约定 2——模块加载就建连会把纯函数测试与离线工具全拖住。
 */
export async function defaultGetClient() {
    try {
        const mod = await import('../../../daos/cache/redisClient.js')
        return mod?.default?.client || null
    } catch (e) {
        if (typeof llm !== 'undefined' && llm.logger) {
            llm.logger.warn(`redis 客户端不可用，事件镜像/跨副本续接按不可用处理: ${String(e?.message || e).slice(0, 140)}`)
        }
        return null
    }
}

/**
 * @description 拼出某一轮的 Stream 键
 * @param {String} messageCode 本轮标识
 * @param {String} [prefix] 键前缀
 * @returns {String} 键
 */
export function eventKey(messageCode, prefix = DEFAULT_KEY_PREFIX) {
    return `${prefix || DEFAULT_KEY_PREFIX}:{${messageCode}}`
}

/**
 * @description 建一个事件镜像（写侧）
 * @param {Object} deps 依赖
 * @param {Function} deps.getClient 返回 ioredis 客户端的异步函数（拿不到就返回 null ⇒ 全程静默降级）
 * @param {String} deps.messageCode 本轮标识
 * @param {Object} [deps.cfg] 配置
 * @returns {Object} {onEvent, finish, stats, flush}
 *
 * 攒批的理由：一轮实测 12~400+ 帧，逐帧 XADD 就是给聊天路径加同样次数的 Redis 往返。
 * 攒到 `flushEvery` 条或 `flushMs` 毫秒再发一次（一次 XADD 可以带多组条目吗？不能，
 * 所以用 pipeline 把多条 XADD 合成一次往返——**省的是往返，不是条数**，这点别说反了）。
 */
export function createRunEventMirror({getClient, messageCode, cfg = {}} = {}) {
    const key = eventKey(messageCode, cfg.keyPrefix)
    const maxEvents = Number(cfg.maxEvents) > 0 ? Number(cfg.maxEvents) : 2000
    const flushEvery = Number(cfg.flushEvery) > 0 ? Number(cfg.flushEvery) : 25
    const flushMs = Number(cfg.flushMs) > 0 ? Number(cfg.flushMs) : 200
    const ttlSec = Number(cfg.ttlSec) > 0 ? Number(cfg.ttlSec) : 120

    /** @type {Array<{seq:Number,event:String,data:String}>} */
    let buf = []
    let flushing = false
    let timer = null
    let finished = false
    let lastSeq = 0
    const stats = {queued: 0, written: 0, failed: 0, flushes: 0, droppedAfterFinish: 0, key}

    /**
     * @description 把缓冲区里的条目一次管道写出
     * @returns {Promise<Number>} 实际写出的条数
     */
    async function flush() {
        if (flushing || !buf.length) {
            return 0
        }
        flushing = true
        const batch = buf
        buf = []
        try {
            const client = await getClient()
            if (!client) {
                /** 拿不到客户端：丢弃并计数。镜像丢了只是让跨副本续接受限，不能拖累回答 */
                stats.failed += batch.length
                return 0
            }
            const pipe = client.pipeline()
            for (const it of batch) {
                pipe.xadd(key, 'MAXLEN', '~', maxEvents, '*',
                    'seq', String(it.seq), 'event', it.event, 'data', it.data)
            }
            /** 滚动期间一轮可能跑很久：每次写都续一次 TTL，否则半轮的键先过期 */
            pipe.expire(key, ttlSec)
            await pipe.exec()
            stats.written += batch.length
            stats.flushes++
        } catch (e) {
            stats.failed += batch.length
            if (typeof llm !== 'undefined' && llm.logger) {
                llm.logger.warn(`事件镜像写入失败（不影响回答，跨副本续接会缺这段）: ${messageCode} ${String(e?.message || e).slice(0, 140)}`)
            }
        } finally {
            flushing = false
        }
        return batch.length
    }

    /**
     * @description 记一帧（由 `sseChannel.onEmit` 调用，**同步返回、不 await**）
     * @param {Number} seq 号
     * @param {String} event 事件名
     * @param {String} data 载荷
     * @returns {void}
     */
    function onEvent(seq, event, data) {
        if (finished) {
            /** finish 之后还有帧进来说明收尾顺序错了：宁可丢弃也别写出一条"结束后还在追加"的键 */
            stats.droppedAfterFinish++
            return
        }
        lastSeq = Number(seq) || lastSeq
        buf.push({seq: Number(seq), event: event || 'delta', data: String(data ?? '')})
        stats.queued++
        if (buf.length >= flushEvery) {
            void flush()
            return
        }
        if (!timer && flushMs > 0) {
            timer = setTimeout(() => {
                timer = null
                void flush()
            }, flushMs)
            /** 定时器不能把进程钉住（停机时靠 finish 里的显式 flush 兜底） */
            timer.unref?.()
        }
    }

    /**
     * @description 收尾：把剩下的刷出去、写终结标记、定 TTL
     * @param {Object} [info] 终结信息
     * @param {Number} [info.finalSeq] 本轮最后一个号
     * @param {String} [info.outcome] done/abort/error
     * @returns {Promise<Object>} 刷写读数
     */
    async function finish({finalSeq = lastSeq, outcome = ''} = {}) {
        const n = await flush()
        finished = true
        if (timer) {
            clearTimeout(timer)
            timer = null
        }
        try {
            const client = await getClient()
            if (client) {
                await client.xadd(key, 'MAXLEN', '~', maxEvents, '*',
                    'seq', String(finalSeq || 0), 'event', '__end__', 'data', String(outcome || ''))
                await client.expire(key, ttlSec)
            }
        } catch (e) {
            stats.failed++
            if (typeof llm !== 'undefined' && llm.logger) {
                llm.logger.warn(`事件镜像收尾失败: ${messageCode} ${String(e?.message || e).slice(0, 140)}`)
            }
        }
        return {flushed: n, finalSeq, outcome, ...stats}
    }

    return {onEvent, finish, flush, stats: () => ({...stats, buffered: buf.length, lastSeq, finished})}
}

/**
 * @description 把 XRANGE 的返回摊平成条目数组
 * @param {Array} raw ioredis xrange 结果
 * @returns {Object[]} 条目
 */
function flatten(raw = []) {
    return (raw || []).map(([, flat]) => {
        const o = {}
        for (let i = 0; i < (flat || []).length; i += 2) {
            o[flat[i]] = flat[i + 1]
        }
        return {seq: Number(o.seq), event: o.event, data: o.data ?? ''}
    })
}

/**
 * @description 从 Redis 读某一轮游标之后的事件（读侧，跨副本续接用）
 * @param {Object} deps 依赖
 * @param {Function} deps.getClient ioredis 客户端取得函数
 * @param {String} deps.messageCode 本轮标识
 * @param {Number} deps.lastSeq 客户端游标
 * @param {Object} [deps.cfg] 配置
 * @returns {Promise<Object>} {found, events, gap, final, reason}
 *
 * 返回形状与 `runEventLog.since()` 对齐，这样路由层不必区分"本地日志"和"远程镜像"。
 * `reason` 是给 runStats/排障看的：missing（没这个键）/unreadable（redis 错）/partial（有洞）。
 */
export async function readRunEventLog({getClient, messageCode, lastSeq = 0, cfg = {}} = {}) {
    const key = eventKey(messageCode, cfg.keyPrefix)
    let raw
    try {
        const client = await getClient()
        if (!client) {
            return {found: false, reason: 'no-client', events: [], gap: null}
        }
        raw = await client.xrange(key, '-', '+')
    } catch (e) {
        if (typeof llm !== 'undefined' && llm.logger) {
            llm.logger.warn(`事件镜像读取失败，按不可用处理: ${messageCode} ${String(e?.message || e).slice(0, 140)}`)
        }
        return {found: false, reason: 'unreadable', events: [], gap: null}
    }

    const all = flatten(raw).filter(x => Number.isFinite(x.seq) && x.seq > 0)
    if (!all.length) {
        return {found: false, reason: 'missing', events: [], gap: null}
    }
    all.sort((a, b) => a.seq - b.seq)

    const end = all.find(x => x.event === '__end__') || null
    const body = all.filter(x => x.event !== '__end__')
    const latest = body.length ? body[body.length - 1].seq : (end ? end.seq : 0)
    const oldest = body.length ? body[0].seq : latest
    const from = Number(lastSeq) || 0

    /**
     * 逐号检查连续性。两种不连续都报 gap，不"有什么给什么"：
     * - 要的那号在保留窗之前（被 MAXLEN 挤掉了）；
     * - 保留窗内部有洞（异步镜像丢帧，物理上可能，别假设它不会）。
     */
    const events = []
    let want = from + 1
    let hole = null
    for (const it of body) {
        if (it.seq < want) {
            continue
        }
        if (it.seq > want) {
            /** 头部的洞（要的那号被 MAXLEN 挤掉）和中途的洞（镜像丢帧）在这里是同一种情况 */
            hole = want
            break
        }
        events.push(it)
        want++
    }

    if (hole !== null) {
        return {
            found: true,
            reason: 'partial',
            events: [],
            gap: {code: GAP_CODE, since: from, oldest, latest, missingFrom: hole},
            final: end ? {outcome: end.data, seq: end.seq} : null,
        }
    }
    return {
        found: true,
        reason: 'ok',
        events,
        gap: null,
        final: end ? {outcome: end.data, seq: end.seq} : null,
        oldest,
        latest,
    }
}

export default {createRunEventMirror, readRunEventLog, eventKey, DEFAULT_KEY_PREFIX, GAP_CODE}
