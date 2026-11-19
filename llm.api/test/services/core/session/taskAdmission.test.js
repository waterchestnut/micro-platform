import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    decideTaskAdmission,
    rejectQueueFull,
    QUEUE_FULL_REJECT_CODE,
} from '../../../../services/core/session/taskAdmission.js'
import {decideQueueOnOverlap} from '../../../../services/core/session/turnScheduler.js'

/**
 * 会话任务准入判定的穷举（PR-任务编排 M1-a）。
 * 这一族判错要么"整站任务全排队不放"，要么"该排的没排、直接撞并发上限丢单"，
 * 所以每层容量、排队与拒绝的边界、关闸、脏值都要有用例，包括看着简单的那条。
 */
describe('decideTaskAdmission', () => {
    test('全不限（默认关）⇒ proceed：读数不因功能没开就消失', () => {
        const d = decideTaskAdmission({ globalActive: 999, conversationActive: 999 })
        assert.equal(d.action, 'proceed')
        assert.equal(d.admit, true)
        assert.equal(d.reason, 'ok')
    })

    test('任一层吃满 ⇒ queue（不是 reject）——有队列之后超容量默认排队', () => {
        const d = decideTaskAdmission({ conversationActive: 8, conversationLimit: 8 })
        assert.equal(d.action, 'queue')
        assert.equal(d.admit, false)
        assert.equal(d.code, 0, '排队不是拒绝，不给拒绝码')
        assert.equal(d.reason, 'capacity:conversation')
        assert.equal(d.limitedBy, 'conversation')
    })

    test('subtask 层：单 root 并行子任务到顶即排队（属主拍板默认 4）', () => {
        assert.equal(decideTaskAdmission({ subtaskActive: 3, subtaskLimit: 4 }).action, 'proceed')
        const d = decideTaskAdmission({ subtaskActive: 4, subtaskLimit: 4 })
        assert.equal(d.limitedBy, 'subtask')
        assert.equal(d.reason, 'capacity:subtask')
    })

    test('顺序：subtask > conversation > user > global——先判最贴近这次 fan-out 的闸', () => {
        const d = decideTaskAdmission({
            subtaskActive: 4, subtaskLimit: 4,
            conversationActive: 8, conversationLimit: 8,
            globalActive: 100, globalLimit: 100,
        })
        assert.equal(d.limitedBy, 'subtask', '多层同时满时报最内层')
    })

    test('用户/全局公平层各自命中', () => {
        assert.equal(decideTaskAdmission({ userActive: 2, userLimit: 2, conversationActive: 0, conversationLimit: 8 }).limitedBy, 'user')
        assert.equal(decideTaskAdmission({ globalActive: 10, globalLimit: 10 }).limitedBy, 'global')
    })

    test('队列满才 reject：容量满 + queueDepth 顶到 maxQueue ⇒ reject(4292)', () => {
        const d = decideTaskAdmission({
            conversationActive: 8, conversationLimit: 8,
            queueDepth: 20, maxQueue: 20,
        })
        assert.equal(d.action, 'reject')
        assert.equal(d.code, QUEUE_FULL_REJECT_CODE)
        assert.equal(d.reason, 'queue-full:conversation')
    })

    test('maxQueue<=0 ⇒ 排队不设上限，容量满也只 queue 不 reject', () => {
        const d = decideTaskAdmission({ conversationActive: 8, conversationLimit: 8, queueDepth: 99999, maxQueue: 0 })
        assert.equal(d.action, 'queue')
    })

    test('limit 脏值(NaN/负/字符串)当"这一层不限"，不是全拒（沿用 runGate 口径）', () => {
        assert.equal(decideTaskAdmission({ conversationActive: 5, conversationLimit: 'abc' }).action, 'proceed')
        assert.equal(decideTaskAdmission({ conversationActive: 5, conversationLimit: -1 }).action, 'proceed')
    })

    test('active 只数正数，缺省当 0', () => {
        assert.equal(decideTaskAdmission({ conversationActive: undefined, conversationLimit: 8 }).action, 'proceed')
        assert.equal(decideTaskAdmission({ conversationActive: 'NaN', conversationLimit: 2 }).action, 'proceed')
    })
})

describe('rejectQueueFull', () => {
    test('proceed/queue 不产生拒绝体（return null）', () => {
        assert.equal(rejectQueueFull(decideTaskAdmission({})), null)
        assert.equal(rejectQueueFull(decideTaskAdmission({ conversationActive: 8, conversationLimit: 8 })), null)
    })

    test('reject ⇒ HTTP 200 + success:false + 4292 + data 载荷（非 2xx 会让各端读不到拒绝体）', () => {
        const d = decideTaskAdmission({ conversationActive: 8, conversationLimit: 8, queueDepth: 20, maxQueue: 20 })
        const r = rejectQueueFull(d)
        assert.equal(r.httpStatus, 200)
        assert.equal(r.body.success, false)
        assert.equal(r.body.code, QUEUE_FULL_REJECT_CODE)
        assert.equal(r.body.data.limitedBy, 'conversation')
        assert.ok(r.body.data.reason, 'data.reason 缺席=前端分不开"队列满"与其它拒绝')
        assert.ok(r.headers['Retry-After'], 'reject 应带 Retry-After')
    })

    test('形状适配（路由接线的前提）：decideQueueOnOverlap 的 decision:reject 与 action 等价；话要对题', () => {
        const d = decideQueueOnOverlap({enabled: true, overlapAdmit: false, queueCount: 5, maxQueue: 5})
        assert.deepEqual({decision: d.decision, code: d.code, reason: d.reason}, {decision: 'reject', code: 4292, reason: 'queue-full'})
        const r = rejectQueueFull({...d, active: 5, limit: 5})
        assert.equal(r.body.code, 4292)
        assert.equal(r.body.data.active, 5)
        assert.equal(r.body.data.limit, 5)
        assert.match(r.body.message, /排队已满/, '话必须说"队列满"——"上一条还在处理中"是 4291 的另一句真话')
    })

    test('双键都不认（pass/queue/空对象）⇒ null，绝不因键名巧合把放行判定演成拒绝', () => {
        for (const junk of [{decision: 'queue'}, {decision: 'pass'}, {action: 'queue'}, {action: 'proceed'}, {}, null]) {
            assert.equal(rejectQueueFull(junk), null, `不该产出拒绝体：${JSON.stringify(junk)}`)
        }
    })
})
