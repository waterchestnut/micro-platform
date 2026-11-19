/**
 * @fileOverview 综合宽限窗判据的穷举用例（纯函数，§7-2）
 * @module test/services/core/session/synthScheduling.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
    SYNTH_TIMER_ROLE, decideSynthTiming, buildSynthTimerTaskSpec, isSynthTimerDue,
} from '../../../../services/core/session/synthScheduling.js'

describe('decideSynthTiming 判据表（穷举）', () => {
    const T0 = 1_000_000
    test('档 1 grace-off（<=0/非数）⇒ 立即综合，逐字现状', () => {
        for (const g of [0, -1, NaN, undefined, '0']) {
            assert.deepEqual(decideSynthTiming({graceMs: g, now: T0, treeDoneAt: T0}),
                {act: 'synthesize', reason: 'grace-off'}, `grace=${String(g)}`)
        }
    })
    test('档 2 window-open：树完成未满窗 ⇒ schedule 到 dueAt=treeDoneAt+grace', () => {
        const d = decideSynthTiming({graceMs: 60000, now: T0 + 5000, treeDoneAt: T0})
        assert.deepEqual(d, {act: 'schedule', reason: 'window-open', dueAt: T0 + 60000})
    })
    test('满窗零动作 ⇒ synthesize(window-quiet)——边界 now==treeDoneAt+grace 算满窗', () => {
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 60000, treeDoneAt: T0}),
            {act: 'synthesize', reason: 'window-quiet'})
    })
    test('档 3 user-active：窗内有新消息 ⇒ 从新消息重设倒计时（不是从"现在"——起点必须钉在动作上）', () => {
        const d = decideSynthTiming({graceMs: 60000, now: T0 + 70000, treeDoneAt: T0, lastUserMsgAt: T0 + 65000, round: 0})
        assert.deepEqual(d, {act: 'schedule', reason: 'user-active', dueAt: T0 + 65000 + 60000})
    })
    test('档 4 postpone-exhausted：推迟到顶 ⇒ 综合且 reason 如实（用户一直聊≠成品永远不来）', () => {
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 70000, treeDoneAt: T0, lastUserMsgAt: T0 + 65000, round: 3, maxPostpone: 3}),
            {act: 'synthesize', reason: 'postpone-exhausted'})
        // round<cap 仍 defer 一档
        assert.equal(decideSynthTiming({graceMs: 60000, now: T0 + 70000, treeDoneAt: T0, lastUserMsgAt: T0 + 65000, round: 2, maxPostpone: 3}).act, 'schedule')
    })
    test('早于树完成的"新消息"不算活性（发起轮自己的 query 就是这一类）', () => {
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 61000, treeDoneAt: T0, lastUserMsgAt: T0 - 500}),
            {act: 'synthesize', reason: 'window-quiet'})
    })
    test('lastUserMsgAt=null/0 ⇒ 无动作（缺读数≠有动作）', () => {
        for (const v of [null, 0, undefined]) {
            assert.equal(decideSynthTiming({graceMs: 60000, now: T0 + 61000, treeDoneAt: T0, lastUserMsgAt: v}).reason, 'window-quiet')
        }
    })
    test('maxPostpone 非正数按默认语义禁用（round>=0 恒成立 ⇒ 立刻 exhausted 不合理——cap<=0 视作 1 轮都不许推）', () => {
        // cap=0：第一次遇到 user-active 就 exhausted（配置说"不推迟"就该不推迟，判据不许自作聪明多等一轮）
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 70000, treeDoneAt: T0, lastUserMsgAt: T0 + 65000, round: 0, maxPostpone: 0}),
            {act: 'synthesize', reason: 'postpone-exhausted'})
    })
    test('收敛口 quiet-since-last：最后动作距今已超窗 ⇒ 综合（e2e 实锤——不许排一个过去的 dueAt 空转）', () => {
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 70000, treeDoneAt: T0, lastUserMsgAt: T0 + 5000, round: 0}),
            {act: 'synthesize', reason: 'quiet-since-last'})
        // 边界：msg+grace 恰等于 now ⇒ 满窗，综合
        assert.deepEqual(decideSynthTiming({graceMs: 60000, now: T0 + 65000, treeDoneAt: T0, lastUserMsgAt: T0 + 5000, round: 1}),
            {act: 'synthesize', reason: 'quiet-since-last'})
        // 动作就在眼前（msg+grace 在未来）且没到 cap ⇒ 照常 user-active 顺延
        assert.equal(decideSynthTiming({graceMs: 60000, now: T0 + 61000, treeDoneAt: T0, lastUserMsgAt: T0 + 60500, round: 1}).reason, 'user-active')
    })
})

describe('isSynthTimerDue（泵的比较判据）', () => {
    test('dueAt<=now 到点；dueAt 缺失/0 视为已到期?——不是：0=坏行不许派', () => {
        assert.equal(isSynthTimerDue({dueAt: 100, now: 100}), true, '恰好到点=到期')
        assert.equal(isSynthTimerDue({dueAt: 99, now: 100}), true)
        assert.equal(isSynthTimerDue({dueAt: 101, now: 100}), false)
        assert.equal(isSynthTimerDue({dueAt: 0, now: 100}), false, '缺 dueAt 的闹钟永不 ringing=宁不派不乱派')
        assert.equal(isSynthTimerDue({dueAt: undefined, now: 100}), false)
    })
})

describe('buildSynthTimerTaskSpec（等待行形状单源）', () => {
    test('关键字段：manual（不投 Kafka）、无 parentCode（不挂子树）、dueAt/round/rootCode 随行', () => {
        const t = buildSynthTimerTaskSpec({
            rootCode: 'r1', dueAt: 999, treeDoneAt: 500, round: 2,
            finParams: {originalQuery: 'q', channel: 'xx', protocol: 2},
            operator: {userCode: 'u'}, conversationCode: 'c1',
        })
        assert.equal(t.handleMode, 'manual')
        assert.equal(t.agentRole, SYNTH_TIMER_ROLE)
        assert.equal(t.handler, 'fanOutFinalizeTask')
        assert.equal(t.parentCode, undefined, '挂上 parentCode 就会混进 detail 的 subtasks 清单')
        assert.equal(t.params.dueAt, 999)
        assert.equal(t.params.synthRound, 2)
        assert.equal(t.params.treeDoneAt, 500)
        assert.equal(t.params.rootCode, 'r1')
        assert.equal(t.params.synthTimer, true)
    })
    test('缺 rootCode 直接抛（没归属的闹钟会把 finalize 带进猜的游戏）', () => {
        assert.throws(() => buildSynthTimerTaskSpec({dueAt: 1}), /rootCode/)
    })
})
