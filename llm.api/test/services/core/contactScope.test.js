/**
 * @fileOverview u2u 成员资格判定的离线单测
 * @module test/services/core/contactScope
 * @description
 * 钉住 D53（双向可联系集合包含）与 D54/D61（服务端强制 + fail-closed）两条口径。
 * 重点锁死**降级方向**：拿不到关系数据时必须拒绝，而不是放行。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {decideContact, assertContact} from '../../../services/core/contactScope.js'

const BASE = {
    currentUserCode: 'teacher-001',
    targetUserCode: 'student-001',
    myStudentCodes: ['student-001', 'student-002'],
    myTeacherCodes: ['teacher-009'],
}

test('decideContact：目标在我的学生列表里即放行', () => {
    assert.deepEqual(decideContact(BASE), {allowed: true, reason: 'is-my-student'})
})

test('decideContact：目标在我的导师列表里即放行（双向）', () => {
    assert.deepEqual(
        decideContact({...BASE, targetUserCode: 'teacher-009', myStudentCodes: []}),
        {allowed: true, reason: 'is-my-teacher'}
    )
})

test('decideContact：无身份直接拒绝，绝不退化成不过滤', () => {
    for (const bad of [undefined, null, '', 0]) {
        const r = decideContact({...BASE, currentUserCode: bad})
        assert.equal(r.allowed, false, `应拒绝：${JSON.stringify(bad)}`)
        assert.equal(r.reason, 'no-user')
    }
})

test('decideContact：无目标用户拒绝（而不是"跟谁都能聊"）', () => {
    for (const bad of [undefined, null, '']) {
        assert.deepEqual(decideContact({...BASE, targetUserCode: bad}), {allowed: false, reason: 'no-target'})
    }
})

test('decideContact：ucenter 不可达时 fail-closed', () => {
    const r = decideContact({...BASE, upstreamOk: false})
    assert.equal(r.allowed, false, '关系数据取不到时必须拒绝')
    assert.equal(r.reason, 'upstream-error')
})

test('decideContact：无关系即拒绝，空列表与不传列表同义', () => {
    assert.deepEqual(decideContact({...BASE, targetUserCode: 'stranger'}), {allowed: false, reason: 'no-relation'})
    assert.deepEqual(
        decideContact({currentUserCode: 'a', targetUserCode: 'b'}),
        {allowed: false, reason: 'no-relation'}
    )
})

test('decideContact：自己与自己默认拒绝', () => {
    assert.deepEqual(
        decideContact({...BASE, targetUserCode: BASE.currentUserCode}),
        {allowed: false, reason: 'self-not-allowed'}
    )
    assert.deepEqual(
        decideContact({...BASE, targetUserCode: BASE.currentUserCode, allowSelf: true}),
        {allowed: true, reason: 'self'}
    )
})

test('decideContact：脏列表（null/空串/非数组）不炸也不放行', () => {
    assert.deepEqual(
        decideContact({...BASE, myStudentCodes: [null, '', undefined], myTeacherCodes: undefined}),
        {allowed: false, reason: 'no-relation'}
    )
})

test('decideContact：工号区分大小写与空格，不做任何归一化', () => {
    /** 关系数据来自 ucenter，工号就是主键；这里偷偷归一化会造成"看着像同一个人"的越权 */
    assert.equal(decideContact({...BASE, targetUserCode: 'STUDENT-001'}).allowed, false)
    assert.equal(decideContact({...BASE, targetUserCode: ' student-001'}).allowed, false)
})

test('assertContact：放行时不抛错', () => {
    assert.doesNotThrow(() => assertContact(decideContact(BASE)))
})

test('assertContact：拒绝必须给 4xx 而不是 500（越权探测不能被记成服务异常）', () => {
    const cases = [
        [{...BASE, currentUserCode: ''}, 401, 'no-user'],
        [{...BASE, targetUserCode: ''}, 403, 'no-target'],
        [{...BASE, upstreamOk: false}, 403, 'upstream-error'],
        [{...BASE, targetUserCode: 'stranger'}, 403, 'no-relation'],
        [{...BASE, targetUserCode: BASE.currentUserCode}, 403, 'self-not-allowed'],
    ]
    for (const [state, status, reason] of cases) {
        assert.throws(
            () => assertContact(decideContact(state)),
            (err) => {
                assert.equal(err.statusCode, status, `${reason} 应是 ${status}，实际 ${err.statusCode}`)
                assert.equal(err.contactReason, reason)
                assert.ok(err.message.length > 0, '必须带可读文案')
                return true
            }
        )
    }
})

test('assertContact：入参畸形时保守拒绝而不是崩溃', () => {
    assert.throws(() => assertContact(undefined), /无权与该用户建立会话/)
    assert.throws(() => assertContact({}), /无权与该用户建立会话/)
})
