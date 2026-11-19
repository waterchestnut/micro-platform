import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    checkBudget,
    DEFAULT_SUBTASK_CEILING,
    DEFAULT_ROOT_TOKEN_CEILING,
} from '../../../../services/core/session/taskBudget.js'

/**
 * 预算/并行度降级判定穷举（PR-任务编排 M1-a）。
 * 多智能体是 token 乘法放大器，判错=成本裸奔；降级阶梯要"给出退路"而非二值拒。
 */
describe('checkBudget', () => {
    test('默认天花板/子上限就是属主拍板值（100 万 token / 4）', () => {
        assert.equal(DEFAULT_ROOT_TOKEN_CEILING, 1_000_000)
        assert.equal(DEFAULT_SUBTASK_CEILING, 4)
    })

    test('预算充裕、子数在上限内 ⇒ none', () => {
        const r = checkBudget({ rootTokensUsed: 1000, plannedSubtasks: 3 })
        assert.equal(r.degrade, 'none')
        assert.equal(r.allowedSubtasks, 3)
        assert.equal(r.ok, true)
    })

    test('子数超上限 ⇒ cap-subtasks 并削到 4', () => {
        const r = checkBudget({ rootTokensUsed: 0, plannedSubtasks: 10 })
        assert.equal(r.degrade, 'cap-subtasks')
        assert.equal(r.reason, 'subtask-ceiling')
        assert.equal(r.allowedSubtasks, 4)
    })

    test('逼近天花板（≥degradeRatio）⇒ 收回 single-agent，不再 fan-out', () => {
        const r = checkBudget({ rootTokensUsed: 900_000, plannedSubtasks: 3 }) // 0.9 > 0.85
        assert.equal(r.degrade, 'single-agent')
        assert.equal(r.reason, 'near-ceiling')
        assert.equal(r.allowedSubtasks, 1)
        assert.equal(r.ok, true, '还没真超，单智能体仍可收尾')
    })

    test('已破天花板 ⇒ single-agent 且 ok=false（连单发都该停）', () => {
        const r = checkBudget({ rootTokensUsed: 1_000_001, plannedSubtasks: 2 })
        assert.equal(r.degrade, 'single-agent')
        assert.equal(r.reason, 'over-ceiling')
        assert.equal(r.allowedSubtasks, 0)
        assert.equal(r.ok, false)
    })

    test('给了单娃预估 ⇒ 按余量能开几个算几个（budget-headroom 裁剪）', () => {
        // 用 50 万，剩 50 万，每娃 20 万 ⇒ 只付得起 2 个（且 ≤ 上限 4）
        const r = checkBudget({ rootTokensUsed: 500_000, plannedSubtasks: 4, perSubtaskTokenEstimate: 200_000 })
        assert.equal(r.degrade, 'cap-subtasks')
        assert.equal(r.reason, 'budget-headroom')
        assert.equal(r.allowedSubtasks, 2)
    })

    test('给了预估但一点余量都不够 ⇒ single-agent no-headroom', () => {
        const r = checkBudget({ rootTokensUsed: 999_000, plannedSubtasks: 2, perSubtaskTokenEstimate: 200_000 })
        assert.equal(r.degrade, 'single-agent')
        assert.equal(r.reason, 'no-headroom')
        assert.equal(r.ok, false)
    })

    test('ceiling<=0 = 预算不限，只看子上限（关闸口径）', () => {
        const r = checkBudget({ rootTokensUsed: 999_999_999, plannedSubtasks: 9, rootTokenCeiling: 0 })
        assert.equal(r.reason, 'subtask-ceiling', '预算关了但 want(9)>子上限(4)，报子数裁剪')
        assert.equal(r.allowedSubtasks, 4, '预算关了但子上限仍在')
    })

    test('脏值当缺省处理，绝不因脏值把预算判爆', () => {
        const r = checkBudget({ rootTokensUsed: 'abc', plannedSubtasks: null })
        assert.equal(r.degrade, 'none')
        assert.equal(r.allowedSubtasks, 0)
    })

    test('子上限<=0 = 不限子数（不是"一个都不许"）', () => {
        const r = checkBudget({ rootTokensUsed: 0, plannedSubtasks: 50, subtaskCeiling: 0 })
        assert.equal(r.degrade, 'none')
        assert.equal(r.allowedSubtasks, 50)
    })
})
