import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import { normalizeFanOutPlan, DEFAULT_CHILD_HANDLER } from '../../../services/agent/fanOutPlanner.js'
import { buildRootTask } from '../../../services/core/session/taskQueueComposer.js'

/**
 * 扇出规划归一用例（PR-任务编排 M4）。钉的是"来源无关的公共裁剪 + 如实汇报"：
 * 能开几个交 taskBudget（不重造阈值）、开不动收回单智能体、削掉的进 dropped 不假装全开、child handler 有默认。
 */
const st = (over = {}) => ({ title: 'T', query: 'do', ...over })

describe('normalizeFanOutPlan 基本形状', () => {
    test('非数组入参 ⇒ 视作空清单，mode single-agent、no-subtasks（不炸）', () => {
        const r = normalizeFanOutPlan({ subtasks: undefined })
        assert.equal(r.mode, 'single-agent')
        assert.equal(r.reason, 'no-subtasks')
        assert.deepEqual(r.subtasks, [])
    })

    test('全是不可运行项（无 query）⇒ 全 dropped，requested 0 ⇒ single-agent', () => {
        const r = normalizeFanOutPlan({ subtasks: [{ title: 'only-title' }, null, { params: {} }] })
        assert.equal(r.requested, 0)
        assert.equal(r.subtasks.length, 0)
        assert.deepEqual(r.dropped.map(d => d.reason).filter(x => x === 'no-query').length >= 1, true)
    })

    test('正常扇出：默认 child handler=agentChat，每项带可入队形状（query/title/handler/agentType/errorMode）', () => {
        const r = normalizeFanOutPlan({ subtasks: [st({ query: '查 A' }), st({ query: '算 B' })] })
        assert.equal(r.mode, 'fan-out')
        assert.equal(r.ok, true)
        assert.equal(r.subtasks.length, 2)
        assert.equal(r.subtasks[0].handler, DEFAULT_CHILD_HANDLER)
        assert.equal(r.subtasks[0].agentType, 'local')
        assert.equal(r.subtasks[0].errorMode, 'break')
        assert.equal(r.subtasks[0].params.query, '查 A')
    })

    test('query 缺 title 时回落取 query 前缀作标题（不空标题）', () => {
        const r = normalizeFanOutPlan({ subtasks: [{ query: '这是一段比较长的问题描述用于标题回落测试abcdefg' }] })
        assert.ok(r.subtasks[0].title && r.subtasks[0].title.length <= 30)
    })

    test('调用方显式 handler 不被默认覆盖；childHandler 可注入', () => {
        const r = normalizeFanOutPlan({
            subtasks: [st({ handler: 'customChild' }), st()],
            childHandler: 'otherChild',
        })
        assert.equal(r.subtasks[0].handler, 'customChild', '给了就用给的')
        assert.equal(r.subtasks[1].handler, 'otherChild', '没给用注入的默认')
    })

    test('deps 原样透传（本器不做依赖调度，别假装排序）', () => {
        const r = normalizeFanOutPlan({ subtasks: [st({ deps: [0] })] })
        assert.deepEqual(r.subtasks[0].deps, [0])
    })
})

describe('normalizeFanOutPlan 预算/并行度裁剪', () => {
    test('超过子任务上限 ⇒ 削到上限，被削的进 dropped(cap)，mode 仍 fan-out', () => {
        const six = [1, 2, 3, 4, 5, 6].map((i) => st({ query: 'q' + i }))
        const r = normalizeFanOutPlan({ subtasks: six, subtaskCeiling: 4 })
        assert.equal(r.mode, 'fan-out')
        assert.equal(r.allowedSubtasks, 4)
        assert.equal(r.subtasks.length, 4)
        assert.equal(r.subtasks[3].query, 'q4', '按顺序保留前 4')
        assert.equal(r.dropped.filter(d => String(d.reason).startsWith('cap:')).length, 2)
    })

    test('预算已破天花板 ⇒ ok:false，收回 single-agent，一个都不扇，dropped 记 budget 原因', () => {
        const r = normalizeFanOutPlan({ subtasks: [st(), st()], rootTokensUsed: 1_000_001 })
        assert.equal(r.mode, 'single-agent')
        assert.equal(r.ok, false)
        assert.equal(r.subtasks.length, 0)
        assert.ok(r.dropped.some(d => String(d.reason).startsWith('budget:')))
    })

    test('逼近天花板(默认 0.85)无预估 ⇒ single-agent 且 allowedSubtasks 1（仍算开不动，不 fan-out）', () => {
        const r = normalizeFanOutPlan({ subtasks: [st(), st(), st()], rootTokensUsed: 900_000 })
        // checkBudget near-ceiling 返回 ok:true allowed 1 degrade single-agent；本器对 single-agent 收回不扇
        assert.equal(r.mode, 'single-agent')
        assert.equal(r.subtasks.length, 0)
    })

    test('给了单娃预估但只剩 0 余量 ⇒ no-headroom ⇒ single-agent（不被比例短路成还能单发）', () => {
        const r = normalizeFanOutPlan({
            subtasks: [st(), st()], rootTokensUsed: 900_000, perSubtaskTokenEstimate: 200_000,
        })
        assert.equal(r.mode, 'single-agent')
        assert.equal(r.reason, 'no-headroom')
    })

    test('预算充裕 ⇒ degrade none、全部保留', () => {
        const r = normalizeFanOutPlan({ subtasks: [st(), st()], subtaskCeiling: 4 })
        assert.equal(r.degrade, 'none')
        assert.equal(r.allowedSubtasks, 2)
    })
})

describe('normalizeFanOutPlan 与 buildRootTask 接缝', () => {
    test('planner 产出的 subtasks 可直接喂 buildRootTask，展开成 subAgents 骨架', () => {
        const plan = normalizeFanOutPlan({ subtasks: [st({ query: 'A' }), st({ query: 'B' })] })
        const root = buildRootTask({
            conversationCode: 'c1', agentType: 'parallel', handler: 'parallelDispatch',
            subtasks: plan.subtasks,
        })
        assert.equal(root.subAgents.length, 2)
        assert.equal(root.subAgents[0].handler, DEFAULT_CHILD_HANDLER, 'child handler 一路带到 subAgents')
        assert.ok(root.subAgents.every(s => s.agentType === 'local'))
    })
})
