import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    arbitrate,
    DEFAULT_MAX_RETRY,
    DEFAULT_MAX_REPLAN,
} from '../../../services/agent/arbitrationPolicy.js'

/**
 * fan-in 失败裁决矩阵穷举（PR-任务编排 M1-a）。
 * 核心红线：**永不 synthesize 掩盖失败**——有失败能重试就 retry，重试/换方案用尽一律 report，
 * 部分成功也必须 partial-report 带失败项，不伪装完整综合。
 */
const S = (n) => ({ handleStatus: 2, agentCode: `a${n}` })
const F = (n, extra = {}) => ({ handleStatus: -1, agentCode: `f${n}`, ...extra })

describe('arbitrate', () => {
    test('默认上限 retry≤2 / replan≤1（属主拍板值编码在此）', () => {
        assert.equal(DEFAULT_MAX_RETRY, 2)
        assert.equal(DEFAULT_MAX_REPLAN, 1)
    })

    test('全成 ⇒ synthesize', () => {
        const r = arbitrate({ subtasks: [S(1), S(2), S(3)] })
        assert.equal(r.action, 'synthesize')
        assert.equal(r.reason, 'all-success')
    })

    test('有可重试失败且预算未用尽 ⇒ retry，只带可重试的 agentCode', () => {
        const r = arbitrate({ subtasks: [S(1), F(1), F(2, { retryable: false })], retryCount: 0 })
        assert.equal(r.action, 'retry')
        assert.deepEqual(r.retryAgents, ['f1'])
        assert.equal(r.failedCount, 2)
    })

    test('重试耗尽 ⇒ 不再 retry；有成功则 partial-report（带失败项，不 synthesize）', () => {
        const r = arbitrate({ subtasks: [S(1), F(1)], retryCount: 2 })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'partial-report')
        assert.equal(r.failedCount, 1, '失败项如实带出，绝不当综合完成')
    })

    test('全失败且不可重试、换方案预算未用尽 ⇒ replan', () => {
        const r = arbitrate({ subtasks: [F(1, { retryable: false }), F(2, { retryable: false })], replanCount: 0 })
        assert.equal(r.action, 'replan')
        assert.equal(r.reason, 'all-failed-replan')
    })

    test('部分失败：全失败判据看 successCount——有一条成功就不 replan 而 report', () => {
        // 失败可重试但 retryCount 已尽，且有一条成功 → 走 partial-report，不是 all-failed
        const r = arbitrate({ subtasks: [S(1), F(1)], retryCount: 2, replanCount: 0 })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'partial-report')
    })

    test('全失败、重试与换方案都用尽 ⇒ exhausted-report', () => {
        const r = arbitrate({ subtasks: [F(1), F(2)], retryCount: 2, replanCount: 1 })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'exhausted-report')
    })

    test('还有在跑(0/1)的子任务 ⇒ not-settled（不做裁决，交回调度）', () => {
        const r = arbitrate({ subtasks: [S(1), { handleStatus: 1, agentCode: 'x' }] })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'not-settled')
    })

    test('空集合 ⇒ no-subtasks，绝不默认 synthesize 造"综合完成"', () => {
        const r = arbitrate({ subtasks: [] })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'no-subtasks')
    })

    test('脏 subtasks（null 元素/非数组）不炸，按有效元素裁决', () => {
        const r = arbitrate({ subtasks: [null, S(1)] })
        assert.equal(r.total, 1)
        assert.equal(r.action, 'synthesize')
    })

    test('全失败可重试优先 retry（先榨干重试再谈换方案）', () => {
        const r = arbitrate({ subtasks: [F(1), F(2)], retryCount: 1, replanCount: 0 })
        assert.equal(r.action, 'retry')
    })
})
