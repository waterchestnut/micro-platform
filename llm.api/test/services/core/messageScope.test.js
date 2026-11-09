/**
 * @fileOverview 消息列表可见性收敛的离线单测
 * @module test/services/core/messageScope
 * @description
 * 覆盖 `/core/message/list` 的历史缺陷：`filter` 直接来自请求体、无任何归属注入，
 * 实测 `filter:{}` 可分页读到全站问答（§2E-4）。这里穷举判定分支，
 * 尤其锁死两条**fail-closed** 性质：没有身份必须拒绝；没有可见会话必须是"无结果"而不是"全部"。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {resolveMessageScope} from '../../../services/core/messageScope.js'

const ALLOWED = ['conv-a', 'conv-b']

test('没有 userCode 一律拒绝，绝不退化成不过滤', () => {
    for (const bad of [undefined, null, '', 0]) {
        const r = resolveMessageScope({channel: 'xxzx_common'}, bad, ALLOWED)
        assert.equal(r.ok, false, `应拒绝：${JSON.stringify(bad)}`)
        assert.equal(r.filter, null)
        assert.equal(r.reason, 'no-user')
    }
})

test('未指定会话时收敛到可见集合，而不是返回全部', () => {
    const r = resolveMessageScope({}, 'u1', ALLOWED)
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'scope-all')
    assert.deepEqual(r.filter.conversationCode, ALLOWED)
})

test('一个可见会话都没有时是空集合而不是缺省（关键 fail-closed）', () => {
    const r = resolveMessageScope({}, 'u1', [])
    assert.equal(r.ok, true)
    assert.deepEqual(r.filter.conversationCode, [], '空可见集必须映射成空 $in，而不是不带条件')
    assert.equal('conversationCode' in r.filter, true)
})

test('指定自己参与的会话放行，且原样保留该条件', () => {
    const r = resolveMessageScope({conversationCode: 'conv-a', channel: 'xxzx_common'}, 'u1', ALLOWED)
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'member')
    assert.equal(r.filter.conversationCode, 'conv-a')
    assert.equal(r.filter.channel, 'xxzx_common', '其它筛选条件不能被丢掉')
})

test('指定他人会话直接拒绝', () => {
    const r = resolveMessageScope({conversationCode: 'conv-victim'}, 'u1', ALLOWED)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'not-member')
    assert.equal(r.filter, null)
})

test('会话数组只保留交集，越权部分被丢掉', () => {
    const r = resolveMessageScope({conversationCode: ['conv-a', 'conv-x', 'conv-y']}, 'u1', ALLOWED)
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'intersect')
    assert.deepEqual(r.filter.conversationCode, ['conv-a'])
})

test('会话数组全部越权时得到空集合而不是放行', () => {
    const r = resolveMessageScope({conversationCode: ['conv-x']}, 'u1', ALLOWED)
    assert.equal(r.ok, true)
    assert.deepEqual(r.filter.conversationCode, [])
})

test('空字符串 conversationCode 视为未指定，走全量收敛', () => {
    const r = resolveMessageScope({conversationCode: ''}, 'u1', ALLOWED)
    assert.equal(r.reason, 'scope-all')
    assert.deepEqual(r.filter.conversationCode, ALLOWED)
})

test('conversationCode 被伪造成对象时拒绝（不接受查询操作符注入）', () => {
    for (const evil of [{conversationCode: {$ne: null}}, {conversationCode: {$in: ['conv-a', 'conv-z']}}]) {
        const r = resolveMessageScope(evil, 'u1', ALLOWED)
        assert.equal(r.ok, false, `应拒绝查询操作符形态：${JSON.stringify(evil)}`)
    }
})

test('调用方塞入 operator/userCode 试图绕过，范围条件仍被强制覆盖', () => {
    const r = resolveMessageScope({operator: {userCode: 'admin'}, userCode: 'admin'}, 'u1', ALLOWED)
    assert.equal(r.ok, true)
    assert.deepEqual(r.filter.conversationCode, ALLOWED, '无论 filter 里写了什么身份字段，会话范围仍以可见集合为准')
})

test('allowedCodes 为 null/undefined 时不崩，等价于无可见会话', () => {
    for (const bad of [undefined, null]) {
        const r = resolveMessageScope({}, 'u1', bad)
        assert.equal(r.ok, true)
        assert.deepEqual(r.filter.conversationCode, [])
    }
})
