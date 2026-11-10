import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    resolveDrainBudget,
    createDrainController,
    DEFAULT_DRAIN_BUDGET_MS,
    DRAIN_RESERVE_MS,
    DRAIN_MIN_MS,
} from '../../../../daos/core/policy/drainPolicy.js'

/**
 * kafka 消费者停机排空的决策测试。
 * 写这些用例的直接动因：`Consumer#close()` 实测**不等在途 callback**，
 * 而现有 SIGTERM 处理器 close 完就 `process.exit(0)`。
 * 今天没出事只因为 PID 1 是 bash、信号送不进来 —— 翻入口会把这个处理器真正激活，
 * 所以必须先有"等不等在途"的判据，而不是先翻入口再看看会发生什么。
 */

describe('resolveDrainBudget', () => {
    test('env 必须是数字出来（FASTIFY_CLOSE_GRACE_DELAY 那个字符串坑不允许在这里复现）', () => {
        const r = resolveDrainBudget({envValue: '20000'})
        assert.equal(typeof r.budgetMs, 'number')
        assert.equal(r.budgetMs, 20000)
        assert.equal(r.applied, true)
        assert.equal(r.reason, 'from-env')
    })

    test('没 env ⇒ 默认值，且说清是默认', () => {
        const r = resolveDrainBudget({})
        assert.equal(r.budgetMs, DEFAULT_DRAIN_BUDGET_MS)
        assert.equal(r.reason, 'default')
        assert.equal(r.applied, true)
    })

    test('env 写错（非纯数字）⇒ 退回默认并 applied=false，不许静默当成没写', () => {
        const r = resolveDrainBudget({envValue: '30s'})
        assert.equal(r.budgetMs, DEFAULT_DRAIN_BUDGET_MS)
        assert.equal(r.applied, false)
        assert.match(r.reason, /不是正整数/)
    })

    test('env=0 ⇒ applied=false（0 等于"完全不等"，那不是本意，得让读数看出来）', () => {
        const r = resolveDrainBudget({envValue: '0'})
        assert.equal(r.applied, false)
        assert.equal(r.budgetMs, DEFAULT_DRAIN_BUDGET_MS)
    })

    test('预算被 grace 钳住：grace 60s ⇒ 上限 60000−余量，超了要说明是 clamped', () => {
        const r = resolveDrainBudget({envValue: '120000', terminationGraceSeconds: 60})
        assert.equal(r.budgetMs, 60000 - DRAIN_RESERVE_MS)
        assert.match(r.reason, /clamped/)
    })

    test('preStop 也要从 grace 里扣（清单里有 sleep 5，不扣就是拿不存在的 5 秒做预算）', () => {
        const r = resolveDrainBudget({envValue: '120000', terminationGraceSeconds: 60, preStopSeconds: 5})
        assert.equal(r.budgetMs, 60000 - DRAIN_RESERVE_MS - 5000)
    })

    test('grace 小到算出负数时兜下限，不返回 0 —— 返回 0 就等于这个开关失效', () => {
        const r = resolveDrainBudget({envValue: '120000', terminationGraceSeconds: 2})
        assert.equal(r.budgetMs, DRAIN_MIN_MS)
    })
})

describe('createDrainController', () => {
    test('start/finish 计数正确，且 finish 未知 ref 不会把计数打成负数', () => {
        const c = createDrainController()
        assert.equal(c.start('t/0/1'), true)
        assert.equal(c.start('t/1/2'), true)
        assert.equal(c.inFlight, 2)
        c.finish('t/0/1')
        c.finish('t/不存在的')
        assert.equal(c.inFlight, 1)
        c.finish('t/1/2')
        assert.equal(c.inFlight, 0)
    })

    test('置停机位之后 start 必须拒绝 —— 调用方据此"不处理也不提交"，把消息留给别的 pod', () => {
        const c = createDrainController()
        const snap = c.beginDraining()
        assert.equal(snap.wasInFlight, 0)
        assert.equal(c.draining, true)
        assert.equal(c.start('t/0/9'), false)
        assert.equal(c.inFlight, 0, '被拒绝的消息不能算在途')
        assert.deepEqual(c.pendingRefs(), [])
    })

    test('没有在途时 waitForDrain 立刻返回 drained=true（不能让人等一个空预算）', async () => {
        const c = createDrainController()
        c.beginDraining()
        const r = await c.waitForDrain(5000)
        assert.equal(r.drained, true)
        assert.equal(r.waitedMs, 0)
    })

    test('最后一条 finish 才唤醒等待者：中途 finish 一条不能提前放行', async () => {
        const c = createDrainController()
        c.start('t/0/1')
        c.start('t/1/2')
        c.beginDraining()
        let settled = false
        const p = c.waitForDrain(5000).then(r => {
            settled = true
            return r
        })
        c.finish('t/0/1')
        await new Promise(r => setImmediate(r))
        assert.equal(settled, false, '还剩一条在途，等待者不能被唤醒')
        c.finish('t/1/2')
        const r = await p
        assert.equal(r.drained, true)
        assert.equal(r.inFlight, 0)
    })

    test('超时必须报出"卡在哪几条"：否则日志里只看得见退出，看不见有几条会被重跑', async () => {
        const c = createDrainController()
        c.start('t/0/1')
        c.beginDraining()
        const r = await c.waitForDrain(20)
        assert.equal(r.drained, false)
        assert.equal(r.timedOut, true)
        assert.deepEqual(r.pending, ['t/0/1'])
        assert.equal(r.inFlight, 1)
    })

    test('超时之后再 finish 不得再唤醒（避免 Promise 重复 settle 把等待逻辑搅乱）', async () => {
        const c = createDrainController()
        c.start('t/0/1')
        c.beginDraining()
        const r = await c.waitForDrain(20)
        assert.equal(r.timedOut, true)
        assert.doesNotThrow(() => c.finish('t/0/1'))
        assert.equal(c.inFlight, 0)
    })

    test('beginDraining 时的现场要能直接写进日志（有几条、分别是谁）', () => {
        const c = createDrainController()
        c.start('t/0/1')
        c.start('t/2/3')
        const snap = c.beginDraining()
        assert.equal(snap.wasInFlight, 2)
        assert.deepEqual(snap.pending.sort(), ['t/0/1', 't/2/3'])
    })
})
