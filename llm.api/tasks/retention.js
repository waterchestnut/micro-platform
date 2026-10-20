/**
 * @fileOverview 数据留存与压实任务
 * @module tasks/retention
 * @description 缓存、检查点、记忆事件都在持续增长，只写不收会无声膨胀。
 * 记忆集合本身有 Mongo TTL（PR-4），这里负责 TTL 管不到的三件事：
 * 1. **answerCache 的容量上限**（TTL 只管时间不管量，热门频道能一直堆）；
 * 2. **老数据回填 expireAt**（TTL 索引是后加的，缺该字段的文档 Mongo 不会回收）；
 * 3. **memoryNamespace 计数纠偏**（并发写入与失败重试会让 atomCount 漂掉）。
 *
 * 两条纪律：整轮先抢 redis 锁（多副本只有一个跑）；**任何删除都必须带全部分组条件**，
 * 只按频道删会把别的分组一起删掉。
 */

import answerCacheDac from '../daos/core/dac/answerCacheDac.js'
import memoryNamespaceDac from '../daos/core/dac/memoryNamespaceDac.js'
import memoryAtomDac from '../daos/core/dac/memoryAtomDac.js'
import sessionCheckpointDac from '../daos/core/dac/sessionCheckpointDac.js'
import {acquireOnce} from '../daos/cache/l2Cache.js'

const config = llm.config
const logger = llm.logger

/** 单轮最多处理多少个分组/命名空间，避免一次任务把库压垮 */
const BATCH = 200

/**
 * @description 给缺 expireAt 的缓存记录回填过期时刻
 * @author xianyang
 * @param {Object} [params] 入参
 * @returns {Promise<Number>} 回填条数
 */
export async function backfillAnswerCacheExpiry(params = {}) {
    const ttlDays = Number(params.ttlDays ?? config.limits?.answerCacheTtlDays ?? 90)
    const limit = Number(params.limit ?? 5000)
    const filter = {noExpireAt: true}
    if (params.channel) {
        filter.complexFilter = [{channel: params.channel}]
    }
    const rows = await answerCacheDac.getTop(limit, filter, {insertTime: 1})
    if (!rows?.length) {
        return 0
    }
    let n = 0
    for (const row of rows) {
        /** 按各自写入时间折算，老数据不该被统一推到遥远的未来 */
        const base = row.insertTime ? new Date(row.insertTime).getTime() : Date.now()
        const expireAt = new Date(base + ttlDays * 24 * 3600 * 1000)
        const ret = await answerCacheDac.update({expireAt}, {answerCacheCode: row.answerCacheCode}).catch(() => null)
        if (ret) {
            n++
        }
    }
    logger.info(`answerCache 回填 expireAt ${n} 条`)
    return n
}

/**
 * @description 按频道+缓存键分组裁掉超出上限的最旧记录
 *
 * `params.channel` 必须支持：运维只想压一个频道时，不带频道条件会遍历全库分组，
 * 配合调小的 max 会误删其它频道的缓存（实测踩过）。
 * @author xianyang
 * @param {Object} [params] 入参
 * @param {String} [params.channel] 只处理该频道
 * @returns {Promise<Number>} 删除条数
 */
export async function capAnswerCachePerChannel(params = {}) {
    const max = Number(params.max ?? config.limits?.answerCacheMaxPerChannel ?? 5000)
    if (!(max > 0)) {
        return 0
    }
    const match = {status: {$ne: -1}}
    if (params.channel) {
        match.channel = params.channel
    }
    const agg = await answerCacheDac.aggregate([
        {$match: match},
        {$group: {_id: {channel: '$channel', channelCacheKey: '$channelCacheKey'}, n: {$sum: 1}}},
        {$sort: {n: -1}},
        {$limit: BATCH},
    ])
    const groups = agg?.rows || agg || []
    let deleted = 0
    for (const g of groups) {
        const over = (g.n || 0) - max
        if (over <= 0) {
            continue
        }
        const channel = g._id?.channel ?? null
        const channelCacheKey = g._id?.channelCacheKey ?? null
        /** 分组条件必须完整带上，channelCacheKey 为 null 时也要显式匹配 null */
        const rows = await answerCacheDac.getTop(over, {
            complexFilter: [{channel}, {channelCacheKey}],
        }, {insertTime: 1})
        const codes = (rows || []).map(r => r.answerCacheCode).filter(Boolean)
        if (!codes.length) {
            continue
        }
        await answerCacheDac.destroyByFilter({answerCacheCode: {$in: codes}})
        deleted += codes.length
    }
    if (deleted) {
        logger.info(`answerCache 超上限清理 ${deleted} 条（每组上限 ${max}）`)
    }
    return deleted
}

/**
 * @description 重算记忆命名空间的生效原子数
 * @author xianyang
 * @param {Object} [params] 入参
 * @returns {Promise<Number>} 修正的命名空间数
 */
export async function recountMemoryNamespaces(params = {}) {
    const limit = Number(params.limit ?? BATCH)
    const filter = {}
    if (params.userCode) {
        filter.userCode = params.userCode
    }
    if (params.channel) {
        filter.channel = params.channel
    }
    const list = await memoryNamespaceDac.getTop(limit, filter, {updateTime: 1})
    let fixed = 0
    for (const ns of list || []) {
        if (!ns.userCode || !ns.channel) {
            continue
        }
        const actual = await memoryAtomDac.getCount({
            userCode: ns.userCode,
            channel: ns.channel,
            workspaceId: ns.workspaceId || null,
            state: 'active',
        })
        if (actual !== ns.atomCount) {
            const ret = await memoryNamespaceDac.update({atomCount: actual}, {namespaceCode: ns.namespaceCode}).catch(() => null)
            if (ret) {
                fixed++
            }
        }
    }
    if (fixed) {
        logger.info(`memoryNamespace 计数纠偏 ${fixed} 个`)
    }
    return fixed
}

/**
 * @description 删除长期不动的会话检查点
 * TTL 已兜住绝大多数，这里清理"TTL 索引建立前的存量"
 * @author xianyang
 * @param {Object} [params] 入参
 * @returns {Promise<Number>} 删除条数
 */
export async function foldStaleCheckpoints(params = {}) {
    const days = Number(params.idleDays ?? config.memory?.retention?.idleRecycleDays ?? 180)
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
    const rows = await sessionCheckpointDac.getTop(1000, {beforeInsertTime: cutoff}, {insertTime: 1})
    const codes = (rows || []).map(r => r.checkpointCode).filter(Boolean)
    if (!codes.length) {
        return 0
    }
    await sessionCheckpointDac.destroyByFilter({checkpointCode: {$in: codes}})
    logger.info(`清理陈旧检查点 ${codes.length} 条（早于 ${cutoff.toISOString().slice(0, 10)}）`)
    return codes.length
}

/**
 * @description 把"权威库有、向量索引没有"的原子补写进索引
 *
 * 只有语义后端在用（`memory.store = 'rag'`）时才有意义：`syncToStore` 失败会留空 `indexedAt`，
 * 不补建的话这些原子**永远不会被语义召回命中**，而词法召回仍看得到它们——表现为"记忆时有时无"，
 * 是 PR-12 落地时明确要由压实兜住的一段。
 * @author xianyang
 * @param {Object} [params] 入参
 * @returns {Promise<Object>} {skipped|scanned,indexed,failed}
 */
export async function reindexMemoryAtoms(params = {}) {
    const storeName = (typeof llm !== 'undefined' ? llm.config?.memory?.store : '') || 'mongoLexical'
    if (storeName !== 'rag') {
        return {skipped: `store=${storeName} 无语义索引需求`}
    }
    const limit = Number(params.limit ?? 200)
    const filter = {state: 'active', noIndexedAt: true}
    if (params.channel) {
        filter.channel = params.channel
    }
    if (params.userCode) {
        filter.userCode = params.userCode
    }
    const rows = await memoryAtomDac.getTop(limit, filter, {insertTime: 1})
    if (!rows?.length) {
        return {scanned: 0, indexed: 0, failed: 0}
    }
    const {getMemoryStore} = await import('../services/core/memory/store/index.js')
    const store = await getMemoryStore()
    let indexed = 0
    let failed = 0
    for (const atom of rows) {
        try {
            await store.upsert({
                userCode: atom.userCode,
                channel: atom.channel,
                workspaceId: atom.workspaceId,
                operator: atom.operator,
                atoms: [{
                    atomCode: atom.atomCode,
                    content: atom.content,
                    headline: atom.headline || atom.content,
                    kind: atom.kind,
                    topic: atom.topic,
                    state: atom.state,
                    insertTime: atom.insertTime,
                }],
            })
            await memoryAtomDac.update({indexedAt: new Date()}, {atomCode: atom.atomCode}).catch(() => null)
            indexed++
        } catch (e) {
            failed++
        }
    }
    logger.info(`记忆向量补建 ${indexed} 条、失败 ${failed} 条（扫描 ${rows.length}）`)
    return {scanned: rows.length, indexed, failed}
}

/**
 * @description 一轮完整压实
 *
 * `params.force = true` 跳过抢锁直接执行，供手工触发与上线首跑用；
 * 常规（cron）路径必须抢锁，多副本只让一个真正动手。
 * @author xianyang
 * @param {Object} [params] 入参
 * @param {Boolean} [params.force] 忽略并发锁直接执行
 * @returns {Promise<Object>} 各项结果
 */
export async function runRetention(params = {}) {
    const lockKey = 'lock:retention'
    const lockTtl = Number(params.lockTtlSeconds ?? 10 * 60)
    const got = params.force ? true : await acquireOnce(lockKey, lockTtl)
    if (!got) {
        logger.info('压实任务已在别处运行，本次跳过')
        return {skipped: true}
    }
    const started = Date.now()
    const ret = {startedAt: new Date(started).toISOString()}
    try {
        ret.backfilled = await backfillAnswerCacheExpiry(params)
        ret.capped = await capAnswerCachePerChannel(params)
        ret.recounted = await recountMemoryNamespaces(params)
        ret.checkpoints = await foldStaleCheckpoints(params)
        ret.reindexed = await reindexMemoryAtoms(params)
    } catch (e) {
        logger.error(`压实任务异常: ${e.stack || e.message}`)
        ret.error = e.message
    } finally {
        /** 跑完就释放，锁的 TTL 只当崩溃兜底；否则手工重跑会被上一轮的锁白挡十分钟 */
        try {
            const redisClient = (await import('../daos/cache/redisClient.js')).default
            await redisClient.delValue(lockKey)
        } catch (e) {
            logger.warn(`压实锁释放失败(${e.message})，将由 TTL 自动过期`)
        }
    }
    ret.ms = Date.now() - started
    logger.info(`压实任务完成，用时 ${ret.ms}ms ${JSON.stringify(ret)}`)
    return ret
}

export default {runRetention, backfillAnswerCacheExpiry, capAnswerCachePerChannel, recountMemoryNamespaces, foldStaleCheckpoints, reindexMemoryAtoms}
