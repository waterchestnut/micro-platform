import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {decideOverlap, overlapNote, OVERLAP_REJECT_CODE, DEFAULT_OVERLAP_WINDOW_MS} from '../../../../services/core/session/runOverlap.js'

/**
 * P5 的判据：同一会话已有未终态 run 时，什么时候拒绝、什么时候只记录。
 *
 * 起因是实测（2026-11-12）：两条并发流打同一个 `conversationCode`，两轮都 `finish`、都落库，
 * 而后一轮的上下文里**没有**前一轮——界面挡住了这种情况，API 没有，而且没有任何地方说出来。
 * 用户拿到的症状是"它怎么不记得我上一句"。
 */

const NOW = 1700000000000
/**
 * @description 造一个账本未终态行
 * @param {Number} ageMs 已经跑了多久
 * @returns {Object} prev
 */
function prev(ageMs, code = 'prev-1') {
    return {messageCode: code, insertTime: NOW - ageMs}
}

describe('decideOverlap：秒级重复才拒', () => {
    test('没有未终态行 ⇒ 放行且无可记录内容', () => {
        const d = decideOverlap({prev: null, now: NOW})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'no-prev')
        assert.equal(overlapNote(d), null)
    })

    test('窗口内的重复 ⇒ 拒，并给出可重试时间与专属错误码', () => {
        const d = decideOverlap({prev: prev(300), now: NOW})
        assert.equal(d.admit, false)
        assert.equal(d.reason, 'same-conversation-duplicate')
        assert.equal(d.code, OVERLAP_REJECT_CODE)
        assert.equal(d.prevMessageCode, 'prev-1')
        assert.equal(d.ageMs, 300)
        assert.ok(d.retryAfterMs >= 300, `重试时间不得小于 300ms，实际 ${d.retryAfterMs}`)
        assert.ok(d.retryAfterMs <= DEFAULT_OVERLAP_WINDOW_MS, `重试时间不该超过窗口，实际 ${d.retryAfterMs}`)
    })

    test('刚好到窗口边界 ⇒ 不再算重复（窗口是开区间，边界放行）', () => {
        const d = decideOverlap({prev: prev(DEFAULT_OVERLAP_WINDOW_MS), now: NOW})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'stale-open-run')
    })

    test('过了窗口只记录不拒绝：僵尸行不许永久锁死一个会话', () => {
        const d = decideOverlap({prev: prev(9 * 60 * 1000), now: NOW})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'stale-open-run')
        assert.equal(d.code, 0)
        const note = overlapNote(d)
        assert.equal(note.contextMissing, true, '上一轮未终态 ⇒ 本轮上下文确实不含它，这句必须写下来')
        assert.equal(note.prevMessageCode, 'prev-1')
    })

    test('窗口配 0 ⇒ 退化成只记录（与并发闸"0=关"的口径一致）', () => {
        const d = decideOverlap({prev: prev(10), now: NOW, windowMs: 0})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'note-only')
        assert.equal(overlapNote(d).reason, 'note-only')
    })

    test('reject=false（灰度/排障档）⇒ 同样只记录', () => {
        const d = decideOverlap({prev: prev(10), now: NOW, reject: false})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'note-only')
    })

    test('窗口配成脏值（NaN/负数/字符串/null）一律视作关，不因此全拒', () => {
        for (const bad of ['abc', -5, NaN, null]) {
            const d = decideOverlap({prev: prev(10), now: NOW, windowMs: bad})
            assert.equal(d.admit, true, `${String(bad)} 应当放行`)
            assert.equal(d.reason, 'note-only', `${String(bad)} 应落到只记录`)
        }
    })

    test('不传窗口 ≠ 关窗：undefined 走默认窗口，秒级重复照样拒（配置漏填不该变成不设防）', () => {
        assert.equal(decideOverlap({prev: prev(10), now: NOW, windowMs: undefined}).admit, false)
        assert.equal(decideOverlap({prev: prev(10), now: NOW}).admit, false)
        assert.equal(decideOverlap({prev: prev(10), now: NOW, windowMs: 0}).admit, true, '显式 0 才是只记录')
    })

    test('时间读不出来 ⇒ 放行并说明，绝不把"我读不懂"变成"你不能问"', () => {
        for (const bad of [undefined, null, NaN, 'not-a-date', {}, []]) {
            const d = decideOverlap({prev: {messageCode: 'p', insertTime: bad}, now: NOW})
            assert.equal(d.admit, true, `${JSON.stringify(bad)} 必须放行`)
            assert.equal(d.reason, 'unreadable-time')
            assert.equal(d.ageMs, null)
        }
    })

    test('时钟倒挂（跨节点漂移）不算重复', () => {
        const d = decideOverlap({prev: prev(-2000), now: NOW})
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'clock-skew')
        assert.equal(d.ageMs, -2000)
    })

    test('prev 根本不是对象（字符串/数字/数组）⇒ 走 no-prev，不抛', () => {
        for (const bad of ['x', 42, [], true]) {
            const d = decideOverlap({prev: bad, now: NOW})
            assert.equal(d.admit, true)
            assert.equal(d.reason, 'no-prev')
        }
    })

    test('Date、毫秒数、ISO 字符串三种时间形状给出同一个判定', () => {
        const a = decideOverlap({prev: {messageCode: 'p', insertTime: new Date(NOW - 400)}, now: NOW})
        const b = decideOverlap({prev: {messageCode: 'p', insertTime: NOW - 400}, now: NOW})
        const c = decideOverlap({prev: {messageCode: 'p', insertTime: new Date(NOW - 400).toISOString()}, now: NOW})
        assert.deepEqual(a, b)
        assert.deepEqual(b, c)
        assert.equal(a.admit, false)
    })

    test('now 也可以传 Date；缺省用当前时间不抛', () => {
        assert.equal(decideOverlap({prev: prev(300), now: new Date(NOW)}).ageMs, 300)
        assert.ok(Number.isFinite(decideOverlap({prev: prev(100)}).ageMs))
    })

    test('没有 messageCode 的未终态行：可以拒绝，但档案里不能引用一个不存在的号', () => {
        const d = decideOverlap({prev: {messageCode: '', insertTime: NOW - 100}, now: NOW})
        assert.equal(d.admit, false)
        assert.equal(d.prevMessageCode, null)
        assert.equal(overlapNote(d), null, '引用不到上一轮就不写假字段')
    })
})

describe('overlapNote：写进档案的那句要能被界面直接说出来', () => {
    test('完整形状：上一轮号、年龄、上下文缺失标记、原因', () => {
        const d = decideOverlap({prev: prev(500), now: NOW})
        assert.deepEqual(overlapNote(d), {
            prevMessageCode: 'prev-1',
            prevAgeMs: 500,
            contextMissing: true,
            reason: 'same-conversation-duplicate',
        })
    })

    test('入参残缺（null/undefined/空对象/no-prev）一律 null', () => {
        for (const bad of [null, undefined, {}, {reason: 'no-prev', prevMessageCode: null}, {reason: 'x'}]) {
            assert.equal(overlapNote(bad), null)
        }
    })

    test('年龄取不到时写 null，不写 0（0 会被读成"同一毫秒"）', () => {
        const d = decideOverlap({prev: {messageCode: 'p', insertTime: 'bad'}, now: NOW})
        assert.equal(overlapNote(d).prevAgeMs, null)
    })
})
