/**
 * @fileOverview 「这一轮允不允许用答案缓存」的落档归一（纯函数，零依赖）
 * @module services/core/session/cacheIntent
 * @description
 * 为什么需要这一层：`cache` 与 `channelCacheKey` 是请求体里的合法字段（`schemas/chatStreamSchema.js`），
 * 但**它们从来不落档**——2026-11-13 实测 dev 库 `message` 全库 1490 行里，顶层有 `cache` 键 0 行、
 * `extInfo.cache` 0 行、`extInfo.channelCacheKey` 0 行（9 条重跑行与 400 条对照行也都是 0）。
 * 原因是 `saveMessage` 的 extInfo 是**显式白名单装配**（`llmChat.js:1765` 原话"这份装配清单才是 extInfo 的唯一出口"），
 * 没列进去的字段就静悄悄地不存在。
 *
 * 后果是排查口径缺一块：今天想知道"这一轮当时到底给没给缓存键"，只能反推顶层 `answerFromCache`
 * 与账本 `modelCalls`，而那只能说明"命中没命中"，说明不了"当时允不允许命中、按什么键分组"。
 *
 * 所以这里做两件容易写错的事：
 * 1. **`0` 与"没传"不是同一个事实**。请求体允许 boolean 或 0/1，归一成 `true`/`false`；
 *    没传、传错类型、传 `2` 这种越界值，一律 `null`——表示"确认没有这个信息"，
 *    绝不把"没传"写成 `true`（那会把"前端没表态"读成"前端允许缓存"）。
 * 2. **键本身要能安全落档**：`channelCacheKey` 是调用方给的字符串，可能很长或不是字符串，
 *    落档只保留可比较的短字符串形态，其余按 `null`（与 `normalizeRegeneratedFrom` 同一个道理：
 *    宽容接收、严格归一，别让前端多传一个对象就把这一轮变成脏数据）。
 *
 * 刻意**不做**的事：不猜缓存会不会命中。命中与否由 `allowsAnswerCache` 与答案缓存查询自己决定，
 * 这里只如实记录"这一轮被允许/不被允许用缓存"这个表态本身。
 */

/** 与 messageCode 同量级的上限：库里那一列就是这个形状 */
const MAX_KEY_LEN = 128

/**
 * @description 归一"这一轮允不允许读写答案缓存"
 * @param {Object} v `options.cache`（schema 允许 boolean 与 number）
 * @returns {Boolean|null} true/false 是明确表态；null 是"没有可核对的表态"
 */
export function normalizeCacheIntent(v) {
    if (typeof v === 'boolean') {
        return v
    }
    /** 数字只认 0 / 1：其它值（2、-1、NaN、小数）是调用方写错了，不许替它猜一个方向 */
    if (typeof v === 'number') {
        if (v === 1) return true
        if (v === 0) return false
        return null
    }
    return null
}

/**
 * @description 归一缓存分组键
 * @param {Object} v `options.channelCacheKey`
 * @returns {String|null} 结果
 */
export function normalizeCacheKey(v) {
    if (typeof v !== 'string') {
        return null
    }
    const s = v.trim()
    if (!s || s.length > MAX_KEY_LEN) {
        return null
    }
    return s
}

/**
 * @description 落档用的两个字段一次算完（避免两处各写一遍、以后各改一半）
 * @param {Object} [options] 请求 options（只读 cache / channelCacheKey）
 * @returns {Object} {cache, channelCacheKey}，都是可核对形态
 */
export function cacheIntentForArchive(options = {}) {
    return {
        cache: normalizeCacheIntent(options?.cache),
        channelCacheKey: normalizeCacheKey(options?.channelCacheKey),
    }
}
