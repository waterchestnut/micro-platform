import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    buildChildExecOptions,
    mapChildOutcome,
    reduceChildResult,
} from '../../../services/agent/childTurn.js'

/**
 * 子智能体 child run 契约穷举（PR-任务编排 M2 承重件）。
 * 判错就毁整棵 fan-in 树，所以每条"不该带什么、不该把什么记成什么"都要有用例。
 */
describe('buildChildExecOptions', () => {
    test('缺 messageCode 或 conversationCode ⇒ 抛（读回与隔离都依赖这俩）', () => {
        assert.throws(() => buildChildExecOptions({ conversationCode: 'c' }), /messageCode/)
        assert.throws(() => buildChildExecOptions({ messageCode: 'm' }), /conversationCode/)
    })

    test('核心红线：绝不带 answerRouter/runMailbox/hardSteer ⇒ execChat 不注册 ask、child 不会挂起等人', () => {
        const o = buildChildExecOptions({ messageCode: 'm', conversationCode: 'c:r1' })
        assert.equal(o.answerRouter, undefined)
        assert.equal(o.runMailbox, undefined)
        assert.equal(o.hardSteer, undefined)
        assert.equal(o.runOverlap, undefined, 'child 独立会话不继承 root 的 overlap')
    })

    test('memory 恒关（各子独立，本刀不开 workspace 分区）', () => {
        assert.deepEqual(buildChildExecOptions({ messageCode: 'm', conversationCode: 'c' }).memory, { enabled: false })
    })

    test('messageCode 是注入的（不是现生成）——fan-in 后按它读回 child 档案', () => {
        const o = buildChildExecOptions({ messageCode: 'fixed-123', conversationCode: 'c' })
        assert.equal(o.messageCode, 'fixed-123')
    })

    test('attachments 空/缺省不进 options；非空才带', () => {
        assert.equal(buildChildExecOptions({ messageCode: 'm', conversationCode: 'c', attachments: [] }).attachments, undefined)
        assert.deepEqual(
            buildChildExecOptions({ messageCode: 'm', conversationCode: 'c', attachments: [{ fileCode: 'f' }] }).attachments,
            [{ fileCode: 'f' }],
        )
    })

    test('reqId/parentTraceId 透传成日志可接的 reqId/inboundTraceId；不给则不出现', () => {
        const o = buildChildExecOptions({ messageCode: 'm', conversationCode: 'c', reqId: 'R', parentTraceId: 'T' })
        assert.equal(o.reqId, 'R')
        assert.equal(o.inboundTraceId, 'T')
        const o2 = buildChildExecOptions({ messageCode: 'm', conversationCode: 'c' })
        assert.equal(o2.reqId, undefined)
    })

    test('signal/streamCallback 仅在给定时挂上（无 SSE 的 child 通常传有界收集器）', () => {
        const cb = () => {}
        const o = buildChildExecOptions({ messageCode: 'm', conversationCode: 'c', streamCallback: cb })
        assert.equal(o.streamCallback, cb)
        assert.equal(o.signal, undefined)
    })
})

describe('mapChildOutcome', () => {
    test("execChat 返回 'aborted' ⇒ handleStatus -1 且 retryable（交裁决重试，绝不当完成）", () => {
        const r = mapChildOutcome({ ret: 'aborted' })
        assert.equal(r.handleStatus, -1)
        assert.equal(r.retryable, true)
    })

    test('handler 侧信号已 abort（超时/取消）同样 -1/retryable，即便 ret 不是 aborted', () => {
        const r = mapChildOutcome({ ret: 'done', aborted: true })
        assert.equal(r.handleStatus, -1)
        assert.equal(r.retryable, true)
    })

    test('正常 done ⇒ 2', () => {
        const r = mapChildOutcome({ ret: 'done' })
        assert.equal(r.handleStatus, 2)
        assert.equal(r.retryable, false)
    })

    test('未知非 aborted 串按 done（execChat 只在打断时返回 aborted）', () => {
        assert.equal(mapChildOutcome({ ret: 'whatever' }).handleStatus, 2)
    })
})

describe('reduceChildResult', () => {
    test('有正文 ⇒ usable:true，带出 messageCode/answer/progress', () => {
        const r = reduceChildResult({ messageCode: 'm', answer: '结论是……', progress: 'finish' })
        assert.equal(r.usable, true)
        assert.equal(r.content, '结论是……')
        assert.equal(r.messageCode, 'm')
        assert.equal(r.progress, 'finish')
        assert.equal(r.note, null)
    })

    test('progress=finish 但 answer 空 ⇒ usable:false/empty-answer（空正文不当可用成果）', () => {
        const r = reduceChildResult({ messageCode: 'm', answer: '', progress: 'finish' })
        assert.equal(r.usable, false)
        assert.equal(r.note, 'empty-answer')
    })

    test('view 缺失/null（读档失败）⇒ usable:false，绝不编 content 顶替', () => {
        const r = reduceChildResult(null)
        assert.equal(r.usable, false)
        assert.equal(r.content, '')
        assert.equal(r.messageCode, null)
    })

    test('全空格正文也不 usable（trim 判定，防"看起来有其实空"）', () => {
        assert.equal(reduceChildResult({ answer: '   ' }).usable, false)
    })
})
