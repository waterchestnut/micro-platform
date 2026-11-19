import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    reduceFanIn,
    renderSections,
    toArbitrationInput,
} from '../../../services/agent/fanIn.js'

/**
 * fan-in 归约穷举（PR-任务编排 M3 承重件）。
 * 风险是"静默删失败块 ⇒ 少两块被读成本来两块"，所以不粉饰是主测点。
 */
const OK = (n, content) => ({ agentCode: `a${n}`, title: `子${n}`, handleStatus: 2, handleRet: { content, usable: true } })
const EMPTY = (n) => ({ agentCode: `e${n}`, title: `空${n}`, handleStatus: 2, handleRet: { content: '', usable: false, note: 'empty-answer' } })
const FAIL = (n) => ({ agentCode: `f${n}`, title: `败${n}`, handleStatus: -1, handleRet: { retryable: true, reason: 'child-aborted' } })

describe('reduceFanIn', () => {
    test('计数分列：success/usable/failed/total 各不混', () => {
        const r = reduceFanIn([OK(1, '结论A'), EMPTY(2), FAIL(3)])
        assert.equal(r.total, 3)
        assert.equal(r.successCount, 2) // 2 个 handleStatus=2（含一个空正文）
        assert.equal(r.usableCount, 1)   // 只有真正有内容的算 usable
        assert.equal(r.failedCount, 1)
    })

    test('usable 需 usable:true 且 content 非空——usable 标志造假也拦', () => {
        const r = reduceFanIn([{ agentCode: 'x', handleStatus: 2, handleRet: { content: '  ', usable: true } }])
        assert.equal(r.usableCount, 0, 'trim 后空 ⇒ 不算可用')
    })

    test('失败/空子任务保留 section 且带 note，不静默删（少两块≠本来两块）', () => {
        const r = reduceFanIn([OK(1, 'a'), FAIL(2)])
        assert.equal(r.sections.length, 2)
        assert.equal(r.sections[1].usable, false)
        assert.ok(r.sections[1].note)
    })

    test('credits rollup 复用 creditMeter（有 credits 才计入）', () => {
        const r = reduceFanIn([
            { agentCode: 'a', handleStatus: 2, handleRet: { content: 'x', usable: true, credits: 10 } },
            { agentCode: 'b', handleStatus: 2, handleRet: { content: 'y', usable: true, credits: 5 } },
        ])
        assert.equal(r.credits.totalCredits, 15)
    })

    test('脏数组/ null 元素不炸', () => {
        const r = reduceFanIn([null, OK(1, 'x')])
        assert.equal(r.total, 1)
    })
})

describe('renderSections', () => {
    test('可用成节、失败带"未完成"标注，绝不让失败消失', () => {
        const md = renderSections(reduceFanIn([OK(1, '结论'), FAIL(2)]))
        assert.match(md, /### 子1/)
        assert.match(md, /结论/)
        assert.match(md, /未完成/)
        assert.match(md, /败2/)
    })

    test('全是失败也产出正文（不返回空串假装无事发生）', () => {
        const md = renderSections(reduceFanIn([FAIL(1), FAIL(2)]))
        assert.ok(md.length > 0)
        assert.equal((md.match(/未完成/g) || []).length, 2)
    })

    test('withHeader:false 只出分节不出总标题', () => {
        const md = renderSections(reduceFanIn([OK(1, 'a')]), { withHeader: false })
        assert.doesNotMatch(md, /## 子任务过程/)
    })
})

describe('toArbitrationInput', () => {
    test('产出 arbitrate 需要的 {agentCode,handleStatus,retryable}，aborted(-1) 默认 retryable', () => {
        const input = toArbitrationInput([OK(1, 'a'), FAIL(2)])
        assert.deepEqual(
            input.find((i) => i.handleStatus === -1),
            { agentCode: 'f2', handleStatus: -1, retryable: true },
        )
    })

    test('retryable:false 显式覆盖（不可重试失败不再被 retry 分支捞起）', () => {
        const input = toArbitrationInput([{ agentCode: 'z', handleStatus: -1, handleRet: { retryable: false } }])
        assert.equal(input[0].retryable, false)
    })

    test('可直接喂给 arbitrate（接缝对齐，不是各写一套形状）', async () => {
        const { arbitrate } = await import('../../../services/agent/arbitrationPolicy.js')
        const out = arbitrate({ subtasks: toArbitrationInput([FAIL(1), FAIL(2)]), retryCount: 0 })
        assert.equal(out.action, 'retry') // 由 arbitrationPolicy 真正消费，证明形状兼容
    })
})
