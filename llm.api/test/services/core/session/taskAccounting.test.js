import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {extractTaskFields, budgetAllowsFollow, reduceDailyTotals, USAGE_AGENT_ROLES} from '../../../../services/core/session/taskAccounting.js'

/**
 * 任务×账本口径（§5-4）。这两列面都会进对账查询，白名单是安全面不是修饰：
 * extractTaskFields——非串/超长/未知 role 一律**不写键**（"缺席"与"空串/裁剪值"在查询里是三种事实）；
 * budgetAllowsFollow——阈值单源在 taskBudget，本件只组合，用例盯组合语义（planned=0 不拦、
 * 逼近天花板不追、槽位装不下不追）。
 */
describe('extractTaskFields 白名单', () => {
    test('三字段齐 ⇒ 原样平铺', () => {
        assert.deepEqual(
            extractTaskFields({taskContext: {rootCode: 'r1', agentCode: 'a1', agentRole: 'child'}}),
            {rootCode: 'r1', agentCode: 'a1', agentRole: 'child'},
        )
    })
    test('无 taskContext / 非对象 ⇒ 空对象（普通聊天行三列缺席，不写空串）', () => {
        assert.deepEqual(extractTaskFields({}), {})
        assert.deepEqual(extractTaskFields({taskContext: null}), {})
        assert.deepEqual(extractTaskFields({taskContext: 'r1'}), {})
    })
    test('非字符串/超长/空串 ⇒ 该键丢弃（超长拒收不裁剪——裁半的键对账会查出一半假账）', () => {
        assert.deepEqual(extractTaskFields({taskContext: {rootCode: 42, agentCode: 'a1', agentRole: 'child'}}),
            {agentCode: 'a1', agentRole: 'child'})
        assert.equal(extractTaskFields({taskContext: {rootCode: 'x'.repeat(129)}}).rootCode, undefined)
        assert.equal(extractTaskFields({taskContext: {rootCode: ''}}).rootCode, undefined)
    })
    test('agentRole 只认枚举（设计稿的 worker/planner 不在实现口径，写错值不入库）', () => {
        assert.equal(extractTaskFields({taskContext: {agentRole: 'worker'}}).agentRole, undefined)
        assert.equal(extractTaskFields({taskContext: {agentRole: 'synthesis'}}).agentRole, 'synthesis')
        assert.deepEqual(USAGE_AGENT_ROLES, ['root', 'serialized-turn', 'child', 'synthesis'], '枚举=写入方现实：finalize 是派发逻辑不跑 execChat（花费记在 synthesis 行），虚位已从枚举收掉')
        assert.equal(extractTaskFields({taskContext: {agentRole: 'finalize'}}).agentRole, undefined)
    })
})

describe('reduceDailyTotals 三值语义', () => {
    test('全部明确计价且无未计价 ⇒ true；存在未计价 ⇒ false（一条混入即整日不算钱）', () => {
        assert.equal(reduceDailyTotals({runs: 3, credits: 12, creditsUnpriced: 0, creditsPricedTrue: 3}).creditsPriced, true)
        assert.equal(reduceDailyTotals({runs: 3, credits: 12, creditsUnpriced: 1, creditsPricedTrue: 2}).creditsPriced, false)
    })
    test('未知计价态(历史行无列) ⇒ null——"无法判定"不许演成 false 装"免费"，也不许演成 true', () => {
        assert.equal(reduceDailyTotals({runs: 5, credits: 0, creditsUnpriced: 0, creditsPricedTrue: 0}).creditsPriced, null)
        assert.equal(reduceDailyTotals({}).creditsPriced, null, '空日同样是"无事实"，两种都不造')
    })
    test('credits 保留 6 位小数舍入（与 computeCredits 同口径），runs 数字化脏值', () => {
        const r = reduceDailyTotals({runs: '4', credits: 1.23456789, creditsUnpriced: 1, creditsPricedTrue: 3})
        assert.equal(r.runs, 4)
        assert.equal(r.credits, 1.234568)
        assert.equal(r.creditsPriced, false)
    })
})

describe('budgetAllowsFollow 组合语义', () => {
    test('planned=0 ⇒ 放行（没东西可 spawn 不拦，也不该被 ceiling 逻辑误伤）', () => {
        assert.equal(budgetAllowsFollow({tokensUsed: 10 ** 9, planned: 0}).allow, true)
    })
    test('预算充裕 ⇒ 放行', () => {
        const r = budgetAllowsFollow({tokensUsed: 1000, planned: 2})
        assert.equal(r.allow, true)
        assert.equal(r.degrade, 'none')
    })
    test('逼近天花板（0.85）⇒ single-agent ⇒ 不追，reason 用 taskBudget 原话不粉饰', () => {
        const r = budgetAllowsFollow({tokensUsed: 900_000, planned: 2})
        assert.equal(r.allow, false)
        assert.equal(r.degrade, 'single-agent')
        assert.equal(r.reason, 'near-ceiling')
    })
    test('已破天花板 ⇒ 不追（over-ceiling）', () => {
        const r = budgetAllowsFollow({tokensUsed: 1_000_001, planned: 1})
        assert.equal(r.allow, false)
        assert.equal(r.reason, 'over-ceiling')
    })
    test('ceiling<=0 ⇒ 不限预算只看槽位：超上限照样不追（cap 与预算分职）', () => {
        const r = budgetAllowsFollow({tokensUsed: 10 ** 9, planned: 5, rootTokenCeiling: 0, subtaskCeiling: 4})
        assert.equal(r.allow, false)
        assert.equal(r.reason, 'subtask-ceiling')
        const ok2 = budgetAllowsFollow({tokensUsed: 10 ** 9, planned: 4, rootTokenCeiling: 0, subtaskCeiling: 4})
        assert.equal(ok2.allow, true, '不限预算时槽位恰好放得下 ⇒ 放行')
    })
})
