import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    reduceParentStatus,
    shouldDispatchNext,
    shouldTriggerFinalize,
} from '../../../../services/core/session/parentAggregate.js'

/**
 * 父任务锁内聚合判据基线（PR-任务编排 C/B0）。
 * 这张表是**现网 updateParentAgentTaskWithLock(agentTask.js:59-92) 行为的忠实快照**——B1 接线前后都必须全绿，
 * 它就是"建课等 fan-out 汇聚逐字不变"的可执行保证（此前该热路径零用例，recoverCandidate 同款病）。
 */
const sub = (agentCode, handleStatus) => ({ agentCode, handleStatus })

describe('reduceParentStatus：现网基线（isDone→2/3；break→3；toParentOutputKey 汇聚）', () => {
    test('全部子成功 ⇒ 父 2', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', 2), sub('b', 2)],
            curAgentTaskInfo: { agentCode: 'b', errorMode: 'break' },
            curRet: { handleStatus: 2, handleRet: { x: 1 } },
        })
        assert.deepEqual(r.toUpdate, { handleStatus: 2 })
        assert.equal(r.newStatus, 2)
    })

    test('有子失败(-1) ⇒ 父 3（完成含错），不是 2', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', -1), sub('b', 2)],
            curAgentTaskInfo: { agentCode: 'b', errorMode: 'break' },
            curRet: { handleStatus: 2, handleRet: null },
        })
        assert.equal(r.toUpdate.handleStatus, 3)
    })

    test('库内冗余仍是旧态、本次 child 的 curRet 覆盖判定（读旧写新不丢）', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', 2), sub('b', 0)],   // b 库里还是 0
            curAgentTaskInfo: { agentCode: 'b', errorMode: 'break' },
            curRet: { handleStatus: 2 },             // 但本次 b 成功 ⇒ 视为全 2 ⇒ 父 2
        })
        assert.equal(r.toUpdate.handleStatus, 2)
    })

    test('cur=-1 + break：即便还有子未终局也立刻判 3（break 的本义＝失败即断，不等兄弟）', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', -1), sub('b', 1), sub('c', 0)],
            curAgentTaskInfo: { agentCode: 'a', errorMode: 'break' },
            curRet: { handleStatus: -1 },
        })
        assert.equal(r.toUpdate.handleStatus, 3)
    })

    test('有子未终局 + 本次 cur=-1 且 errorMode=break ⇒ 父立刻 3（break 不等其它分支）', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', -1), sub('b', 0)],
            curAgentTaskInfo: { agentCode: 'a', errorMode: 'break' },
            curRet: { handleStatus: -1 },
        })
        assert.equal(r.toUpdate.handleStatus, 3)
    })

    test('errorMode=continue 的失败不提前判死（等全部终局再算）', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', -1), sub('b', 0)],
            curAgentTaskInfo: { agentCode: 'a', errorMode: 'continue' },
            curRet: { handleStatus: -1 },
        })
        assert.equal(r.toUpdate.handleStatus, undefined)
    })

    test('toParentOutputKey ⇒ handleRet 只挂在该键下（现网形状）', () => {
        const r = reduceParentStatus({
            subAgents: [sub('a', 2)],
            curAgentTaskInfo: { agentCode: 'a', errorMode: 'break', toParentOutputKey: 'k1' },
            curRet: { handleStatus: 2, handleRet: { v: 9 } },
        })
        assert.deepEqual(r.toUpdate.handleRet, { k1: { v: 9 } })
    })

    test('空 subAgents 的退化形态：isDone 真值 ⇒ 2（照抄现状，别顺手加护栏——B0 只建基线）', () => {
        const r = reduceParentStatus({ subAgents: [], curAgentTaskInfo: { agentCode: 'x' }, curRet: { handleStatus: 2 } })
        assert.equal(r.toUpdate.handleStatus, 2)
    })

    test('缺 handleStatus 的元素不炸（undefined 既非终也非错 ⇒ isDone 保持，照现状）', () => {
        const r = reduceParentStatus({ subAgents: [{ agentCode: 'a' }], curAgentTaskInfo: { agentCode: 'a' }, curRet: { handleStatus: 2 } })
        assert.equal(r.toUpdate.handleStatus, 2)
    })
})

describe('shouldDispatchNext：现网基线（agentTask.js:89-92 逐条件）', () => {
    const OK = { newStatus: 2, prevStatus: 0, handleMode: 'queue', nextAgentCode: 'n1' }
    test('首次成功 + 非 manual + 有后继 ⇒ 派发', () => assert.equal(shouldDispatchNext(OK), true))
    test('已是终态(2 或 3)再来一次 ⇒ 不派（防重复推进链）', () => {
        assert.equal(shouldDispatchNext({ ...OK, prevStatus: 2 }), false)
        assert.equal(shouldDispatchNext({ ...OK, prevStatus: 3 }), false)
    })
    test('newStatus=3 不派发（现状只在成功时推链）', () => assert.equal(shouldDispatchNext({ ...OK, newStatus: 3 }), false))
    test('manual 不派发（人工触发链自己管自己）', () => assert.equal(shouldDispatchNext({ ...OK, handleMode: 'manual' }), false))
    test('无 nextAgentCode 不派发', () => assert.equal(shouldDispatchNext({ ...OK, nextAgentCode: '' }), false))
})

describe('shouldTriggerFinalize：B1 新闸的每侧条件（防循环三态 + 别碰建课）', () => {
    const OK = { newStatus: 2, prevStatus: 0, agentRole: 'root', orchestrated: true, enabled: true }
    test('总开关关 ⇒ 恒 false（现网逐字不变的判据根基）', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, enabled: false }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, enabled: undefined }), false)
    })
    test('非编排 root（建课普通父/agentRole 缺失）⇒ false', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, orchestrated: false }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, agentRole: undefined }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, agentRole: 'child' }), false)
    })
    test('只在本层首次写入终态；非终态/已终态再来 ⇒ false', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, newStatus: null }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, newStatus: 1 }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, prevStatus: 2 }), false)
        assert.equal(shouldTriggerFinalize({ ...OK, prevStatus: 3 }), false)
    })
    test('newStatus=3（完成含错）也触发——report/partial 正是 finalize 要如实交代的', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, newStatus: 3 }), true)
    })
    test('幂等：handleRet.orchestration 已存在 ⇒ 绝不二次触发（finalize 写回 root 再进汇聚不循环）', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, alreadyFinalized: true }), false)
    })
    test('自递归识别：上报给父自己 ⇒ false（防 root 给自己触发 finalize）', () => {
        assert.equal(shouldTriggerFinalize({ ...OK, isSelfRecursion: true }), false)
    })
})
