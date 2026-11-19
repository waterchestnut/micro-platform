import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import { finalizeFanOutRoot, buildSynthesisQuery } from '../../../services/agent/fanOutFinalize.js'
import { decideFanOutNext } from '../../../services/agent/fanOutOrchestrate.js'

/**
 * root 完成编排收尾件用例（PR-任务编排 C/M4）。钉：action→handleStatus/terminal/dispatch 的映射符合
 * "不掩盖失败(终态含错只给3,不给2)""未终局不收尾""转调不重算(counts/sectionsText 来自 decideFanOutNext)"。
 */
const ok = (agentCode, content = '正文') => ({
    agentCode, title: agentCode, handleStatus: 2, handleRet: { content, usable: content.trim().length > 0 },
})
const fail = (agentCode, retryable = false) => ({
    agentCode, title: agentCode, handleStatus: -1, handleRet: { content: '', usable: false, retryable },
})

describe('finalizeFanOutRoot 状态映射与派发指令', () => {
    test('全成功 ⇒ handleStatus 2(成功)、terminal、needSynthesis、synthesisInput 带分节正文与原请求', () => {
        const r = finalizeFanOutRoot({ children: [ok('a', '甲'), ok('b', '乙')], originalQuery: '做个对比' })
        assert.equal(r.handleStatus, 2)
        assert.equal(r.terminal, true)
        assert.equal(r.dispatch.needSynthesis, true)
        assert.equal(r.action, 'synthesize')
        assert.ok(r.synthesisInput && r.synthesisInput.sectionsText && r.synthesisInput.originalQuery === '做个对比')
    })

    test('部分失败(partial) ⇒ handleStatus 3(完成含错) 而非 2，terminal，不综合，正文带失败标注', () => {
        const r = finalizeFanOutRoot({ children: [ok('a', '甲'), fail('b', false)] })
        assert.equal(r.handleStatus, 3, '永不把"含失败"标成成功 2')
        assert.equal(r.action, 'report')
        assert.equal(r.terminal, true)
        assert.equal(r.dispatch.needSynthesis, false)
        assert.match(r.synthesisInput.sectionsText, /未完成/)
    })

    test('有可重试失败 ⇒ handleStatus 1(进行中,未终)、needRetry、retryAgents 带待重跑', () => {
        const r = finalizeFanOutRoot({ children: [ok('a'), fail('b', true)], retryCount: 0 })
        assert.equal(r.handleStatus, 1)
        assert.equal(r.terminal, false)
        assert.equal(r.dispatch.needRetry, true)
        assert.deepEqual(r.dispatch.retryAgents, ['b'])
    })

    test('全失败且有换方案预算 ⇒ handleStatus 1、needReplan、root 未终', () => {
        const r = finalizeFanOutRoot({ children: [fail('a'), fail('b')], replanCount: 0 })
        assert.equal(r.action, 'replan')
        assert.equal(r.handleStatus, 1)
        assert.equal(r.dispatch.needReplan, true)
        assert.equal(r.terminal, false)
    })

    test('有 child 未终局(0/1) ⇒ 不收尾：handleStatus 1、pending:true、不综合不重试', () => {
        const r = finalizeFanOutRoot({ children: [ok('a'), { agentCode: 'b', handleStatus: 1, handleRet: {} }] })
        assert.equal(r.settled, false)
        assert.equal(r.handleStatus, 1)
        assert.equal(r.dispatch.pending, true)
        assert.equal(r.dispatch.needSynthesis, false)
        assert.equal(r.terminal, false)
    })

    test('空 children ⇒ handleStatus 3(完成含错/没做成)、terminal、不 synth', () => {
        const r = finalizeFanOutRoot({ children: [] })
        assert.equal(r.action, 'report')
        assert.equal(r.handleStatus, 3)
        assert.equal(r.terminal, true)
        assert.equal(r.dispatch.needSynthesis, false)
    })
})

describe('buildSynthesisQuery 引导语（无固定输出模板，属主拍板）', () => {
    test('只交"原问题+分节事实+综合指令"，不规定输出格式', () => {
        const q = buildSynthesisQuery('调研 X', '## 子任务过程\n### A\n甲')
        assert.match(q, /原始问题：调研 X/)
        assert.match(q, /甲/)
        assert.doesNotMatch(q, /第一段|第二段|必须使用|模板|JSON/)   // 不套输出模板
    })
    test('空输入不炸，事实缺位如实标注', () => {
        assert.match(buildSynthesisQuery('', ''), /未给出/)
        assert.match(buildSynthesisQuery('', ''), /无产出/)
    })
})

describe('finalizeFanOutRoot 与 decideFanOutNext 同源 + credits 诚实', () => {
    test('counts/action/reason 逐项等于 decideFanOutNext（本件不另起裁决/统计）', () => {
        const children = [ok('a', '甲'), ok('b', ''), fail('c', false)]
        const next = decideFanOutNext({ children })
        const r = finalizeFanOutRoot({ children })
        assert.deepEqual(r.counts, next.counts)
        assert.equal(r.action, next.action)
        assert.equal(r.reason, next.reason)
        assert.deepEqual(r.credits, next.credits)
    })

    test('每子 credits 尚未进 handleRet 时 ⇒ credits 如实 totalCredits:0/priced:false，不假装算过（M6 前）', () => {
        const r = finalizeFanOutRoot({ children: [ok('a'), ok('b')] })
        assert.equal(r.credits.totalCredits, 0)
        assert.equal(r.credits.priced, false, '没价/没逐子 credits 就不能谎称已计价')
    })

    test('给了每子 credits 时随 rollup 透传（为 M6 就绪）', () => {
        const withC = (code, c) => ({ agentCode: code, title: code, handleStatus: 2, handleRet: { content: 'x', usable: true, credits: c, creditsPriced: true } })
        const r = finalizeFanOutRoot({ children: [withC('a', 3), withC('b', 4)] })
        assert.equal(r.credits.totalCredits, 7)
    })
})
