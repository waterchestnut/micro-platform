import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    decideTurnOnArrival,
    decideTurnStart,
    decideQueueOnOverlap,
    decideQueueOnStaleOpenRun,
} from '../../../../services/core/session/turnScheduler.js'

/**
 * 同会话串行调度判定穷举（PR-任务编排 M1-b 核心）。
 * 判错的代价是"上下文竞态"或"僵尸行永久锁死会话"或"该排的直接拒(丢单)"——三种都得有用例钉住。
 */
describe('decideTurnOnArrival', () => {
    test('会话空闲 ⇒ 立即 start，不 contextMissing', () => {
        const d = decideTurnOnArrival({ hasOpenRunOnConversation: false })
        assert.equal(d.action, 'start')
        assert.equal(d.contextMissing, false)
        assert.equal(d.reason, 'conversation-free')
    })

    test('前一轮活跃且未陈旧 ⇒ queue（排队，不是拒绝——区别于现状 4291 丢单）', () => {
        const d = decideTurnOnArrival({ hasOpenRunOnConversation: true, openRunAgeMs: 500, staleMs: 30000 })
        assert.equal(d.action, 'queue')
        assert.equal(d.reason, 'previous-turn-active')
    })

    test('僵尸 open run（超 staleMs 未终态）⇒ 放行 start 但 contextMissing:true（不锁死会话）', () => {
        const d = decideTurnOnArrival({ hasOpenRunOnConversation: true, openRunAgeMs: 31000, staleMs: 30000 })
        assert.equal(d.action, 'start')
        assert.equal(d.contextMissing, true)
        assert.equal(d.reason, 'stale-open-run')
    })

    test('staleMs<=0 ⇒ 不做陈旧判定（有 open run 就一直排队，交由调用方决定是否配僵尸阈值）', () => {
        const d = decideTurnOnArrival({ hasOpenRunOnConversation: true, openRunAgeMs: 9_999_999, staleMs: 0 })
        assert.equal(d.action, 'queue')
    })

    test('脏 age/stale 值不当"陈旧"（Number 守卫，防 NaN 误放行导致竞态）', () => {
        const d = decideTurnOnArrival({ hasOpenRunOnConversation: true, openRunAgeMs: 'abc', staleMs: 1000 })
        assert.equal(d.action, 'queue', '读不出年龄 ⇒ 保守排队，不赌它已完')
    })
})

describe('decideTurnStart（消费侧）', () => {
    test('与会话侧同规则：空闲 start / 活跃 wait / 僵尸 start+contextMissing', () => {
        assert.deepEqual(decideTurnStart({}), { start: true, reason: 'conversation-free', contextMissing: false })
        assert.equal(decideTurnStart({ hasOpenRunOnConversation: true, openRunAgeMs: 10, staleMs: 30000 }).start, false)
        const z = decideTurnStart({ hasOpenRunOnConversation: true, openRunAgeMs: 40000, staleMs: 30000 })
        assert.equal(z.start, true)
        assert.equal(z.contextMissing, true)
    })

    test('消费侧"等"≠丢弃：start:false 只是再等（不产生拒绝码），与 runOverlap 直接拒区分', () => {
        const r = decideTurnStart({ hasOpenRunOnConversation: true, openRunAgeMs: 100, staleMs: 30000 })
        assert.equal(r.start, false)
        assert.equal(r.reason, 'previous-turn-active')
        assert.ok(!('code' in r), '调度件不发拒绝码——拒绝是路由/闸的事')
    })
})

describe('decideQueueOnOverlap（路由侧：would-reject → queue/reject/pass）', () => {
    test('overlap 本就放行 ⇒ pass（队列逻辑绝不介入，与 enabled 无关——"关时逐字不变"的基础）', () => {
        for (const enabled of [true, false]) {
            const d = decideQueueOnOverlap({ enabled, overlapAdmit: true, overlapReason: 'stale-open-run' })
            assert.equal(d.decision, 'pass')
            assert.equal(d.code, 0)
        }
    })

    test('本应拒 + 队列关 ⇒ reject 4291（现网逐字不变）', () => {
        const d = decideQueueOnOverlap({ enabled: false, overlapAdmit: false, overlapReason: 'same-conversation-duplicate' })
        assert.deepEqual({ decision: d.decision, code: d.code, reason: d.reason },
            { decision: 'reject', code: 4291, reason: 'queue-disabled' })
    })

    test('本应拒 + 队列开 + 未满 ⇒ queue（带位次=已排+1，不是丢单）', () => {
        const d = decideQueueOnOverlap({ enabled: true, overlapAdmit: false, overlapReason: 'same-conversation-duplicate', queueCount: 2 })
        assert.equal(d.decision, 'queue')
        assert.equal(d.queuePosition, 3)
        assert.equal(d.code, 0)
    })

    test('每会话队列满 ⇒ reject 4292（新码，区别于 4291 的即时语义）', () => {
        const d = decideQueueOnOverlap({ enabled: true, overlapAdmit: false, queueCount: 5, maxQueue: 5 })
        assert.deepEqual({ decision: d.decision, code: d.code, reason: d.reason },
            { decision: 'reject', code: 4292, reason: 'queue-full' })
    })

    test('maxQueue<=0（未配）⇒ 不设本层每会话闸（全局容量另归 taskAdmission，不在此重复阈值）', () => {
        const d = decideQueueOnOverlap({ enabled: true, overlapAdmit: false, queueCount: 9999, maxQueue: 0 })
        assert.equal(d.decision, 'queue')
    })

    test('不擅自做陈旧判定：stale 情形 decideOverlap 已给 admit:true，本件只 pass（第二入口由 decideQueueOnStaleOpenRun 专职接管）', () => {
        assert.equal(decideQueueOnOverlap({ enabled: true, overlapAdmit: true, overlapReason: 'stale-open-run' }).decision, 'pass')
    })
})

describe('decideQueueOnStaleOpenRun（第二入口：overlap 放行但会话真忙 ⇒ 排队）', () => {
    test('开关关 ⇒ 恒 pass（现网逐字不变的地基）', () => {
        assert.equal(decideQueueOnStaleOpenRun({overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 5000}).decision, 'pass')
        assert.equal(decideQueueOnStaleOpenRun({enabled: false, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 1}).decision, 'pass')
    })

    test('只认 stale-open-run：其它放行原因一律不接管（no-prev/unreadable/clock-skew/note-only）', () => {
        for (const reason of ['no-prev', 'unreadable-time', 'clock-skew', 'note-only', '']) {
            assert.deepEqual(
                decideQueueOnStaleOpenRun({enabled: true, overlapReason: reason, prevHeartbeatAgeMs: 100}),
                {decision: 'pass', reason: 'not-stale-open-run', code: 0, queuePosition: null}, `reason=${reason} 不该被接管`)
        }
    })

    test('心跳三种"不确定"全 pass：读不到/负数/非数——"不知道忙不忙"不许拦用户', () => {
        for (const hb of [null, undefined, -5, 'x', NaN]) {
            assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: hb}).decision, 'pass')
        }
    })

    test('心跳超 staleMs ⇒ 僵尸行维持放行（与 runOverlap 的陈旧不锁死同取向）；恰好等于阈值按"旧"算', () => {
        assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 46000, staleMs: 45000}).reason, 'heartbeat-stale')
        assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 45000, staleMs: 45000}).reason, 'heartbeat-stale')
        assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 44999, staleMs: 45000}).decision, 'queue')
    })

    test('心跳新鲜 ⇒ queue 位次如实（queueCount+1）；队列满 ⇒ reject 4292（与第一入口同码同体）', () => {
        assert.deepEqual(
            decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 8000, queueCount: 2, maxQueue: 50}),
            {decision: 'queue', reason: 'previous-turn-active', code: 0, queuePosition: 3})
        const full = decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 8000, queueCount: 50, maxQueue: 50})
        assert.deepEqual({d: full.decision, c: full.code, r: full.reason}, {d: 'reject', c: 4292, r: 'queue-full'})
    })

    test('staleMs 脏值回退 45000（阈值单源坏数据不许变成"恒放行"或"恒拦截"）', () => {
        assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 40000, staleMs: 0}).decision, 'queue')
        assert.equal(decideQueueOnStaleOpenRun({enabled: true, overlapReason: 'stale-open-run', prevHeartbeatAgeMs: 46000, staleMs: -1}).reason, 'heartbeat-stale')
    })
})
