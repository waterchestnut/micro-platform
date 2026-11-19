import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import * as T from '../../../../services/core/session/taskEvents.js'

/**
 * 任务事件词表构造用例（M7）。核心测"每个事件都带得走真话所需字段"，不测发送时机（那是接线方）。
 */
describe('taskEvents 词表', () => {
    test('九个事件类型齐、命名与设计稿 §2.7 一致', () => {
        assert.deepEqual(T.TASK_EVENT_TYPES, [
            'task_queued', 'task_started', 'subtask_spawned', 'subtask_done', 'subtask_failed',
            'synthesizing', 'synthesized', 'budget_degraded', 'arbitration',
        ])
    })

    test('task_queued 带排队位次（前端如实显示"排队中第 N 位"，缺位次=null 不编 0）', () => {
        assert.deepEqual(T.taskQueued({ rootCode: 'r', queuePosition: 3 }), { type: 'task_queued', rootCode: 'r', queuePosition: 3 })
        assert.equal(T.taskQueued({ rootCode: 'r' }).queuePosition, null)
    })

    test('subtask_done：handleStatus=2 不等于 usable——usable 缺省 false，summary 不编造', () => {
        const e = T.subtaskDone({ rootCode: 'r', agentCode: 'a' })
        assert.equal(e.usable, false)
        assert.equal(e.summary, '')
    })

    test('subtask_failed 带 reason + retryable（区分自旋重试与到此为止）', () => {
        const e = T.subtaskFailed({ rootCode: 'r', agentCode: 'a', reason: 'child-aborted', retryable: true })
        assert.equal(e.reason, 'child-aborted')
        assert.equal(e.retryable, true)
    })

    test('budget_degraded 必带降到哪档 + 允许子数（不静默降级）', () => {
        const e = T.budgetDegraded({ rootCode: 'r', degrade: 'single-agent', reason: 'over-ceiling', allowedSubtasks: 1 })
        assert.equal(e.degrade, 'single-agent')
        assert.equal(e.allowedSubtasks, 1)
    })

    test('arbitration 与裁决决策同源字段（action/retryAgents/reason）', () => {
        const e = T.arbitrationEvent({ rootCode: 'r', action: 'retry', retryAgents: ['a1'], reason: 'retryable' })
        assert.equal(e.action, 'retry')
        assert.deepEqual(e.retryAgents, ['a1'])
    })

    test('subtasks_spawned 只带里程碑（agentCode/title），不逐帧回灌 child 细流', () => {
        const e = T.subtasksSpawned({ rootCode: 'r', subtasks: [{ agentCode: 'a', title: 'A' }, { agentCode: 'b' }] })
        assert.deepEqual(e.subtasks, [{ agentCode: 'a', title: 'A' }, { agentCode: 'b', title: '' }])
    })

    test('synthesized 带成功/可用/失败计数（部分成果可见）', () => {
        const e = T.synthesized({ rootCode: 'r', successCount: 3, usableCount: 2, failedCount: 1 })
        assert.equal(e.usableCount, 2)
        assert.equal(e.failedCount, 1)
    })
})
