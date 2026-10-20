/**
 * @fileOverview 进程内 LRU 与 redis 组成的两级缓存
 * @module daos/cache/l2Cache
 * @description 聊天关键路径上有几处"每次请求都回源"的读（频道技能清单、抽取去重锁）。
 * 这里统一提供：先查进程内 LRU，未命中查 redis，再未命中回源并回填。
 *
 * 三条约定：
 * 1. **redis 不可用一律 fail-open**：缓存是优化，不能变成故障源；取不到就当未命中，写失败只记日志。
 * 2. **redis 客户端延迟加载**：`redisClient.js` 在模块加载时就建立连接，测试与纯函数模块不能被它拖住。
 * 3. **缓存值必须可 JSON 序列化**：Date 会变成 ISO 字符串，调用方不得依赖返回值的类型保真。
 */

import {createLRU} from './lruCache.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

const lruRegistry = new Map()

/**
 * @description 按命名空间取（并复用）一个 LRU
 * @author xianyang
 * @param {String} space 命名空间
 * @param {Object} [options] 选项，见 createLRU
 * @returns {Object} LRU 实例
 */
export function getLRU(space, options = {}) {
    const key = space || 'default'
    if (!lruRegistry.has(key)) {
        lruRegistry.set(key, createLRU(options))
    }
    return lruRegistry.get(key)
}

async function redisOrNull() {
    try {
        return (await import('./redisClient.js')).default
    } catch (e) {
        logger().warn(`redis 客户端不可用，本次按未命中处理: ${e.message}`)
        return null
    }
}

/**
 * @description 读缓存
 * @author xianyang
 * @param {String} key redis 键（同时用作 LRU 键）
 * @param {String} [space] LRU 命名空间
 * @returns {Promise<{hit:Boolean, source:String, value:*}>} 命中情况
 */
export async function cacheGet(key, space = 'default') {
    const lru = getLRU(space)
    const local = lru.get(key)
    if (local !== undefined) {
        return {hit: true, source: 'lru', value: local}
    }
    const redis = await redisOrNull()
    if (!redis) {
        return {hit: false, source: 'none', value: undefined}
    }
    try {
        const remote = await redis.getValue(key)
        if (remote !== null && remote !== undefined) {
            lru.set(key, remote)
            return {hit: true, source: 'redis', value: remote}
        }
    } catch (e) {
        logger().warn(`缓存读取失败(${key})，按未命中处理: ${e.message}`)
    }
    return {hit: false, source: 'none', value: undefined}
}

/**
 * @description 写缓存
 * @author xianyang
 * @param {String} key redis 键
 * @param {*} value 值（须可序列化）
 * @param {Object} [options] 选项
 * @param {Number} [options.ttlSeconds] redis 过期秒数
 * @param {String} [options.space] LRU 命名空间
 * @returns {Promise<Boolean>} redis 是否写入成功（LRU 一定已写入）
 */
export async function cacheSet(key, value, options = {}) {
    getLRU(options.space || 'default').set(key, value)
    const redis = await redisOrNull()
    if (!redis) {
        return false
    }
    try {
        await redis.setValue(key, value, options.ttlSeconds || 60)
        return true
    } catch (e) {
        logger().warn(`缓存写入失败(${key}): ${e.message}`)
        return false
    }
}

/**
 * @description 删缓存，支持精确键与前缀通配
 * @author xianyang
 * @param {String} key 键或含 * 的模式
 * @param {String} [space] 需要一并清掉的 LRU 命名空间
 * @returns {Promise<Number>} redis 删除的键数
 */
export async function cacheDel(key, space) {
    if (space) {
        getLRU(space).clear()
    }
    const redis = await redisOrNull()
    if (!redis) {
        return 0
    }
    try {
        if (String(key).includes('*')) {
            const keys = await redis.getKeys(key)
            for (const k of keys || []) {
                await redis.delValue(k)
            }
            return (keys || []).length
        }
        return await redis.delValue(key) || 0
    } catch (e) {
        logger().warn(`缓存删除失败(${key}): ${e.message}`)
        return 0
    }
}

/**
 * @description 读缓存，未命中则回源并回填
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.key 缓存键
 * @param {Function} params.loader 回源函数
 * @param {Object} [params.options] ttlSeconds / space
 * @returns {Promise<{value:*, source:String}>} 结果与来源
 */
export async function remember(params = {}) {
    const {key, loader, options = {}} = params
    if (!key || typeof loader !== 'function') {
        const value = loader ? await loader() : null
        return {value, source: 'uncached'}
    }
    const found = await cacheGet(key, options.space || 'default')
    if (found.hit) {
        return {value: found.value, source: found.source}
    }
    const value = await loader()
    await cacheSet(key, value, {ttlSeconds: options.ttlSeconds, space: options.space || 'default'})
    return {value, source: 'origin'}
}

/**
 * @description 抢一次性令牌（SETNX 语义），用于抑制重复投递/重复执行
 * @author xianyang
 * @param {String} key 锁键
 * @param {Number} [seconds] 窗口秒数
 * @returns {Promise<Boolean>} 是否抢到；redis 不可用时返回 true（**放行优先于去重**）
 */
export async function acquireOnce(key, seconds = 60) {
    if (!key) {
        return true
    }
    const redis = await redisOrNull()
    if (!redis) {
        return true
    }
    try {
        const ret = await redis.setIfAbsent(key, '1', seconds)
        return Boolean(ret)
    } catch (e) {
        logger().warn(`去重锁不可用(${key})，放行: ${e.message}`)
        return true
    }
}

export default {getLRU, cacheGet, cacheSet, cacheDel, remember, acquireOnce}
