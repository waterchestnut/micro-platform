import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {taskPhase, buildTaskDetailView} from '../../../../services/core/session/taskDetail.js'

/**
 * 任务详情视图判据（§5-3）。性格：相位是"给 UI 的一句真话"——收尾中≠完成、被取消≠失败、
 * 摘要≠全文（truncated 必须如实）；orchestration/synthesis 一律透传，本件不许重算。
 */
const kid = (agentCode, handleStatus, over = {}) => ({agentCode, handleStatus, title: agentCode, params: {}, ...over})

describe('taskPhase 映射表', () => {
    test('cancelled 最优先（用户意志不被旧裁决掩盖）', () => {
        assert.equal(taskPhase({handleStatus: 2, handleRet: {orchestration: {cancelled: true, action: 'synthesize'}}}), 'cancelled')
    })
    test('root=0 ⇒ queued；root=1 或有未终局 child ⇒ running', () => {
        assert.equal(taskPhase({handleStatus: 0, subAgents: [kid('a', 0)]}), 'queued')
        assert.equal(taskPhase({handleStatus: 1, subAgents: [kid('a', 1)]}), 'running')
        assert.equal(taskPhase({handleStatus: -1, subAgents: [kid('a', 2), kid('b', 1)]}), 'running', '有在途 child 就是 running，即使 root 行被谁写过')
    })
    test('§7-1 action=await-input ⇒ awaiting_input，抢在 running 前（在等人不是没在跑就是跑完了）', () => {
        // handleStatus=1 若无 await 标会落 running（:31 条件）——await 检查必须在那之前
        assert.equal(taskPhase({handleStatus: 1, subAgents: [kid('a', 2)], handleRet: {orchestration: {action: 'await-input'}}}), 'awaiting_input')
        assert.equal(taskPhase({handleStatus: 1, subAgents: [kid('a', 1)], handleRet: {orchestration: {action: 'await-input'}}}), 'awaiting_input')
        // cancelled 仍然压过 await（用户意志第一优先级不动摇）
        assert.equal(taskPhase({handleStatus: 1, handleRet: {orchestration: {cancelled: true, action: 'await-input'}}}), 'cancelled')
    })
    test('children 全终、finalize 未落 ⇒ synthesizing（收尾中，不混 running 不装 synthesized）', () => {
        assert.equal(taskPhase({handleStatus: 2, subAgents: [kid('a', 2)]}), 'synthesizing')
        assert.equal(taskPhase({handleStatus: 3, subAgents: [kid('a', 2), kid('b', -1)]}), 'synthesizing')
    })
    test('action=synthesize：回执 usable ⇒ synthesized；未落/空 ⇒ synthesizing（绝不提前宣布）', () => {
        const base = {handleStatus: 2, subAgents: [kid('a', 2)]}
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'synthesize'}, synthesis: {usable: true}}}), 'synthesized')
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'synthesize'}, synthesis: {usable: false}}}), 'synthesizing')
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'synthesize'}}}), 'synthesizing')
    })
    test('report ⇒ 按 usable 二值 partial/failed；终态上挂 retry/replan 边角也不装 running', () => {
        const base = {handleStatus: 3, subAgents: [kid('a', 2), kid('b', -1)]}
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'report', counts: {usable: 1}}}}), 'partial')
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'report', counts: {usable: 0}}}}), 'failed')
        assert.equal(taskPhase({...base, handleRet: {orchestration: {action: 'retry', counts: {usable: 0}}}}), 'failed',
            'root 已是终态 3，retry 悬置的边角按事实二值，不谎称在跑')
    })
})

describe('buildTaskDetailView 装配', () => {
    const root = {
        agentCode: 'r1', handleStatus: 3, title: '树', conversationCode: 'c1',
        insertTime: new Date(1000), updateTime: new Date(2000),
        subAgents: [{agentCode: 'a', handleStatus: 2}, {agentCode: 'b', handleStatus: -1}],
        handleRet: {
            orchestration: {action: 'report', counts: {usable: 1, failed: 1}, credits: {totalCredits: 42}, dispatch: {needRetry: false}, follow: {spawned: 0}},
            synthesis: null,
        },
    }
    const rows = [
        root,
        kid('a', 2, {handleRet: {content: '结'.repeat(200), usable: true, credits: 42}}),
        kid('b', -1, {handleRet: null}),
    ]

    test('透传不重算：orchestration/credits/dispatch/follow 原样；subtasks 不吞行', () => {
        const v = buildTaskDetailView({root, rows})
        assert.equal(v.phase, 'partial')
        assert.deepEqual(v.orchestration.credits, {totalCredits: 42})
        assert.equal(v.orchestration.counts.usable, 1)
        assert.equal(v.subtasks.length, 2)
    })

    test('摘要截断如实：preview 120 + previewTruncated:true；空正文 preview:null 不装"有内容"', () => {
        const v = buildTaskDetailView({root, rows})
        const a = v.subtasks.find((s) => s.agentCode === 'a')
        const b = v.subtasks.find((s) => s.agentCode === 'b')
        assert.equal(a.preview.length, 120)
        assert.equal(a.previewTruncated, true)
        assert.equal(b.preview, null)
        assert.equal(b.phase, 'failed')
        assert.equal(b.credits, null, '缺就 null，不补 0')
    })

    test('§7-1 clarify 视图透传：hold 有内容才给对象；无挂起=null（不造空数组冒充"已答完"）', () => {
        const v0 = buildTaskDetailView({root, rows})
        assert.equal(v0.clarify, null)
        const heldRoot = {...root, params: {clarifyHold: {requests: [{agentCode: 'a', question: '选哪个？', options: ['A', 'B']}], capped: [], sealedAt: 't'}}}
        const v = buildTaskDetailView({root: heldRoot, rows})
        assert.deepEqual(v.clarify, {requests: [{agentCode: 'a', question: '选哪个？', options: ['A', 'B']}], capped: [], sealedAt: 't'})
        const cappedOnly = {...root, params: {clarifyHold: {requests: [], capped: [{agentCode: 'a', question: 'q'}], sealedAt: 't'}}}
        assert.equal(buildTaskDetailView({root: cappedOnly, rows}).clarify.capped.length, 1, 'cap 用尽的如实可见')
    })

    test('槽位口径与 fanOutFollow 同源：retry 后旧尝试 active:false 但仍陈列（历史可见）', () => {
        const rows2 = [
            kid('b0', -1, {handleRet: null}),
            kid('b1', 2, {params: {retryOf: 'b0', followRound: 1}, handleRet: {content: 'ok', usable: true}}),
        ]
        const r2 = {...root, subAgents: [{agentCode: 'b0', handleStatus: -1}, {agentCode: 'b1', handleStatus: 2}]}
        const v = buildTaskDetailView({root: r2, rows: [r2, ...rows2]})
        const byCode = Object.fromEntries(v.subtasks.map((s) => [s.agentCode, s]))
        assert.equal(byCode.b1.active, true)
        assert.equal(byCode.b0.active, false)
        assert.equal(byCode.b1.slot, 'b0')
        assert.equal(byCode.b1.followRound, 1)
    })
})
