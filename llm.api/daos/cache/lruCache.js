/**
 * @fileOverview 进程内 LRU + TTL 缓存
 * @module daos/cache/lruCache
 * @description 纯内存实现，不依赖 redis 与任何全局，便于单测与跨模块复用。
 * 定位是"redis 之下的第一层"：热点数据（技能清单、MCP 工具清单）先在进程内命中，
 * 未命中再回源或落到 redis，避免每个请求都打一次数据库或远端。
 */

/**
 * @description 创建一个 LRU + TTL 缓存
 * @author xianyang
 * @param {Object} [options] 选项
 * @param {Number} [options.max] 最多保留多少条，超出按最近使用淘汰
 * @param {Number} [options.ttlMs] 存活毫秒数，<=0 表示不过期
 * @returns {Object} {get,set,has,delete,clear,peek,size,stats}
 */
export function createLRU(options = {}) {
    const max = Number(options.max) > 0 ? Number(options.max) : 128
    const ttlMs = Number(options.ttlMs) >= 0 ? Number(options.ttlMs) : 0
    /** Map 的插入顺序即访问顺序，命中后重插即为 LRU */
    const map = new Map()
    let hits = 0
    let misses = 0
    let evictions = 0
    let expirations = 0

    const expired = (entry) => ttlMs > 0 && (Date.now() - entry.at) > ttlMs

    /**
     * @description 读取，过期视作未命中
     * @param {String} key 键
     * @returns {*} 值或 undefined
     */
    function get(key) {
        const entry = map.get(key)
        if (!entry) {
            misses++
            return undefined
        }
        if (expired(entry)) {
            map.delete(key)
            expirations++
            misses++
            return undefined
        }
        map.delete(key)
        map.set(key, entry)
        hits++
        return entry.value
    }

    /**
     * @description 写入并按 max 淘汰最久未用
     * @param {String} key 键
     * @param {*} value 值
     * @returns {void}
     */
    function set(key, value) {
        if (map.has(key)) {
            map.delete(key)
        }
        map.set(key, {value, at: Date.now()})
        while (map.size > max) {
            const oldest = map.keys().next().value
            map.delete(oldest)
            evictions++
        }
    }

    return {
        get,
        set,
        has: (key) => get(key) !== undefined,
        delete: (key) => map.delete(key),
        clear: () => map.clear(),
        /** 只读不刷新 LRU 顺序，用于调试与断言 */
        peek: (key) => map.get(key)?.value,
        size: () => map.size,
        stats: () => ({size: map.size, max, ttlMs, hits, misses, evictions, expirations}),
    }
}

export default {createLRU}
