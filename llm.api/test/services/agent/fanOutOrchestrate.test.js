import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import { decideFanOutNext } from '../../../services/agent/fanOutOrchestrate.js'
import { reduceFanIn } from '../../../services/agent/fanIn.js'

/**
 * fan-in 编排决策+备料接缝件用例（PR-任务编排 C/M3）。
 * 钉三条红线：① 计数与 fanIn/arbitrate 同源（本件不另起统计）；② usable:0 也照实陈列、不假装综合有料；
 * ③ 永不 synthesize 掩盖失败（partial/exhausted/not-settled 一律 report）。
 */
const ok = (agentCode, content = '正文', over = {}) => ({
    agentCode, title: agentCode, handleStatus: 2, handleRet: { content, usable: content.trim().length > 0 }, ...over,
})
const fail = (agentCode, retryable = false) => ({
    agentCode, title: agentCode, handleStatus: -1, handleRet: { content: '', usable: false, retryable },
})

describe('decideFanOutNext 动作分支', () => {
    test('全成功有正文 ⇒ synthesize，counts 如实，sectionsText 含各节', () => {
        const r = decideFanOutNext({ children: [ok('a', '甲'), ok('b', '乙')] })
        assert.equal(r.action, 'synthesize')
        assert.deepEqual({ s: r.counts.success, u: r.counts.usable, f: r.counts.failed }, { s: 2, u: 2, f: 0 })
        assert.match(r.input.sectionsText, /甲/)
        assert.match(r.input.sectionsText, /乙/)
    })

    test('全成功但有空正文(usable:false) ⇒ 仍 synthesize(按 handleStatus)，counts.usable 如实少计，空节仍陈列', () => {
        const r = decideFanOutNext({ children: [ok('a', '甲'), ok('b', '   ')] })
        assert.equal(r.action, 'synthesize')
        assert.equal(r.counts.usable, 1, '空正文不算可用——不粉饰')
        assert.equal(r.input.sections.length, 2, '空正文那节照样在，不被静默删（少了会被读成本来只有 1 块）')
        assert.match(r.input.sectionsText, /未完成/)
    })

    test('有可重试失败且预算未用尽 ⇒ retry，retryAgents 带待重跑，不 spawn（交编排层）', () => {
        const r = decideFanOutNext({ children: [ok('a'), fail('b', true)], retryCount: 0 })
        assert.equal(r.action, 'retry')
        assert.deepEqual(r.retryAgents, ['b'])
    })

    test('失败不可重试 + 部分成功 ⇒ report(partial)，带失败标注，绝不 synthesize 掩盖', () => {
        const r = decideFanOutNext({ children: [ok('a'), fail('b', false)] })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'partial-report')
        assert.match(r.input.sectionsText, /未完成/)
    })

    test('全失败 + 有换方案预算 ⇒ replan，只报失败项、不自改计划', () => {
        const r = decideFanOutNext({ children: [fail('a'), fail('b')], replanCount: 0 })
        assert.equal(r.action, 'replan')
        assert.ok(Array.isArray(r.input.failedSections) && r.input.failedSections.length === 2)
    })

    test('全失败 + 换方案也用尽 ⇒ report(exhausted)，终局如实', () => {
        const r = decideFanOutNext({ children: [fail('a')], retryCount: 2, replanCount: 1 })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'exhausted-report')
    })
})

describe('decideFanOutNext 终局与诚实边界', () => {
    test('有未终局子任务(0/1) ⇒ report(not-settled) 且 settled:false（编排层据此不综合/不再 spawn）', () => {
        const r = decideFanOutNext({
            children: [ok('a'), { agentCode: 'b', handleStatus: 1, handleRet: {} }],
        })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'not-settled')
        assert.equal(r.settled, false)
    })

    test('空 children ⇒ report(no-subtasks)，counts 全 0，绝不默认 synthesize 造"综合完成"', () => {
        const r = decideFanOutNext({ children: [] })
        assert.equal(r.action, 'report')
        assert.equal(r.reason, 'no-subtasks')
        assert.equal(r.settled, true, '没有未终局项，视为已定（但没东西可做）')
        assert.deepEqual(r.counts, { success: 0, usable: 0, failed: 0, total: 0 })
    })

    test('脏 children(null 元素)不炸，按有效项裁决', () => {
        const r = decideFanOutNext({ children: [null, ok('a')] })
        assert.equal(r.counts.total, 1)
        assert.equal(r.action, 'synthesize')
    })
})

describe('decideFanOutNext 与 fanIn 计数同源', () => {
    test('counts 直接等于 reduceFanIn 的产物（不是本件重算）', () => {
        const children = [ok('a'), ok('b', ''), fail('c', false)]
        const reduced = reduceFanIn(children)
        const r = decideFanOutNext({ children })
        assert.equal(r.counts.success, reduced.successCount)
        assert.equal(r.counts.usable, reduced.usableCount)
        assert.equal(r.counts.failed, reduced.failedCount)
        assert.equal(r.counts.total, reduced.total)
        assert.deepEqual(r.input.sections, reduced.sections)
        assert.deepEqual(r.credits, reduced.credits)
    })
})
