import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/**
 * §3/§6 附件安全红线（B-2，2026-11-19）：child（`agent:` 隔离会话）不得拿到用户附件——
 * 现状 llm.api 对 attachments **只存档不解析**（无内容消费面），但 fileCode 若随 execChat
 * 落进隔离会话档案，就是给未来"任意 fileCode 可读"留了第二条落库路径。
 * 封堵点在唯一入口 agentChat（childTurn 的通用能力保留：turnRunner 忠实重放跑在**用户
 * 自己的会话**=同归属，不经此入口、不受此限）。真要用文件走二期显式通道：
 * fileCode 绑定发起 userCode + messageScope 同款归属校验。守卫只钉源码位——删注释可以，
 * 把透传加回来不行。
 */
describe('附件红线：agentChat 不透传 attachments（源码位守卫）', () => {
    const src = fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), '../../../..') + '/services/agent/handler/agentChat.js', 'utf8')
        .replace(/\r/g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l.trim())).join('\n')
    test('agentChat 不再把 attachments 交给 buildChildExecOptions（fileCode 不进 agent: 会话档案）', () => {
        assert.ok(!/attachments:\s*p\.attachments/.test(src), 'agentChat 把用户附件透传给了隔离会话 child——红线违例')
    })
    test('封堵点旁必须留着历史注（防后来者当冗余参数"顺手补上"）', () => {
        const raw = fs.readFileSync(path.resolve(fileURLToPath(import.meta.url), '../../../..') + '/services/agent/handler/agentChat.js', 'utf8')
        assert.ok(raw.includes('附件安全红线'), '红线注释被删——下一双眼睛就会把透传加回来')
    })
})
