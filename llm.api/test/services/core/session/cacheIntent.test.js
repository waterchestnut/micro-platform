/**
 * @fileOverview cacheIntent 的穷举用例（落档归一，零依赖纯函数）
 * @module test/services/core/session/cacheIntent
 * @description
 * 这组用例守的是两件容易写错的事：
 * 1. "没传"不许被读成"允许"——`undefined`/越界值必须是 `null`，而不是 `true` 或 `false`；
 * 2. `0` 与缺键不是同一件事——`0` 是明确"不允许"，缺键是"没有可核对的表态"。
 * 之所以值得单独钉：这条链路上已经因为"缺键当成 0 读"翻过一次车（见 docs/session-run-plan.md 的 H1 教训）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {normalizeCacheIntent, normalizeCacheKey, cacheIntentForArchive} from '../../../../services/core/session/cacheIntent.js'

describe('normalizeCacheIntent：明确表态才给布尔，其余一律 null', () => {
    test('boolean 原样', () => {
        assert.equal(normalizeCacheIntent(true), true)
        assert.equal(normalizeCacheIntent(false), false)
    })
    test('数字只认 0/1，且 0 是"不允许"不是"没表态"', () => {
        assert.equal(normalizeCacheIntent(1), true)
        assert.equal(normalizeCacheIntent(0), false)
    })
    test('越界数字不许替调用方猜方向', () => {
        for (const v of [2, -1, 1.5, NaN, Infinity, -Infinity]) {
            assert.equal(normalizeCacheIntent(v), null, `越界值 ${String(v)} 应归一成 null`)
        }
    })
    test('字符串/对象/数组/null/undefined/缺参 都是 null', () => {
        for (const v of ['true', '1', '0', '', ' ', {}, [], [1], null, undefined]) {
            assert.equal(normalizeCacheIntent(v), null, `${JSON.stringify(v)} 不应被当成表态`)
        }
        assert.equal(normalizeCacheIntent(), null, '一个参数都不传也必须是 null，不许抛')
    })
})

describe('normalizeCacheKey：只保留可比较的短字符串', () => {
    test('普通键去空白', () => {
        assert.equal(normalizeCacheKey('res-1'), 'res-1')
        assert.equal(normalizeCacheKey('  res-1  '), 'res-1')
    })
    test('空串与全空白都是 null（不是空字符串）', () => {
        assert.equal(normalizeCacheKey(''), null)
        assert.equal(normalizeCacheKey('   '), null)
    })
    test('上限 128：等号边界保留、超出丢弃', () => {
        const at = 'a'.repeat(128)
        const over = 'a'.repeat(129)
        assert.equal(normalizeCacheKey(at), at)
        assert.equal(normalizeCacheKey(over), null, '超长键落档没有比较价值，还会把档案撑大')
    })
    test('非字符串一律 null，含对象与数字', () => {
        for (const v of [123, 0, {}, {a: 1}, [], null, undefined]) {
            assert.equal(normalizeCacheKey(v), null)
        }
        assert.equal(normalizeCacheKey(), null)
    })
})

describe('cacheIntentForArchive：两个字段一次算完，缺省不抛', () => {
    test('空对象给两个 null', () => {
        assert.deepEqual(cacheIntentForArchive({}), {cache: null, channelCacheKey: null})
    })
    test('不传参数也不抛（异常路径上调用它不许再造一个异常）', () => {
        assert.deepEqual(cacheIntentForArchive(), {cache: null, channelCacheKey: null})
        assert.deepEqual(cacheIntentForArchive(null), {cache: null, channelCacheKey: null})
    })
    test('两个字段互不影响：只给一个时另一个仍是 null', () => {
        assert.deepEqual(cacheIntentForArchive({cache: 0}), {cache: false, channelCacheKey: null})
        assert.deepEqual(cacheIntentForArchive({channelCacheKey: 'k1'}), {cache: null, channelCacheKey: 'k1'})
    })
    test('真实请求形态：cache:false + 键（四端重跑时发的那一份）', () => {
        assert.deepEqual(cacheIntentForArchive({cache: 0, channelCacheKey: 'res-9'}), {cache: false, channelCacheKey: 'res-9'})
    })
})
