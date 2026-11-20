import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    computeCredits,
    rollupCredits,
    buildUsageCreditsFields,
    normalizeCreditWeights,
} from '../../../../services/core/session/creditMeter.js'

/**
 * credits 消耗判定穷举（PR-任务编排 M1-a）。
 * 这一族的风险是"把没配价的东西说成钱"——所以 priced 的归约比数值更要命。
 */
describe('computeCredits', () => {
    test('无权重 ⇒ 退化纯 token 计数，priced:false（绝不谎称已计价）', () => {
        const r = computeCredits({ promptTokens: 100, completionTokens: 50 })
        assert.equal(r.credits, 150)
        assert.equal(r.priced, false)
    })

    test('给了 input/output 权重 ⇒ 折算且 priced:true', () => {
        const r = computeCredits({
            promptTokens: 100, completionTokens: 50,
            weights: { inputWeight: 1, outputWeight: 4 },
        })
        assert.equal(r.credits, 100 * 1 + 50 * 4)
        assert.equal(r.priced, true)
    })

    test('modelTier 命中 tierWeights ⇒ 用档权重覆盖默认', () => {
        const r = computeCredits({
            promptTokens: 100, completionTokens: 100, modelTier: 'qwen_vl',
            weights: { inputWeight: 1, outputWeight: 1, tierWeights: { qwen_vl: { input: 2, output: 8 } } },
        })
        assert.equal(r.credits, 100 * 2 + 100 * 8)
    })

    test('未给价但给了 toolCallCost/sandboxSecondCost ⇒ 计附加项，priced:true', () => {
        const r = computeCredits({
            promptTokens: 10, completionTokens: 10, toolCalls: 3, sandboxSeconds: 5,
            weights: { toolCallCost: 2, sandboxSecondCost: 1 },
        })
        assert.equal(r.credits, 20 + 3 * 2 + 5 * 1)
        assert.equal(r.priced, true)
    })

    test('附加项无 cost 配置 ⇒ 不贡献 credits（不凭空算钱）', () => {
        const r = computeCredits({ promptTokens: 10, completionTokens: 10, toolCalls: 99, sandboxSeconds: 99 })
        assert.equal(r.credits, 20)
        assert.equal(r.priced, false)
    })

    test('负/脏值视作 0，不把消耗算成负', () => {
        const r = computeCredits({ promptTokens: -5, completionTokens: 'abc' })
        assert.equal(r.credits, 0)
    })

    test('零输入 ⇒ credits 0', () => {
        assert.equal(computeCredits({}).credits, 0)
    })
})

describe('normalizeCreditWeights（坏项剔除，配错不装计价）', () => {
    test('干净表原样通过；0 是合法语义（该项不计）不是坏值', () => {
        const r = normalizeCreditWeights({inputWeight: 1, outputWeight: 4, toolCallCost: 0,
            tierWeights: {qwen: {input: 0.8, output: 3}}})
        assert.deepEqual(r.issues, [])
        assert.equal(r.weights.outputWeight, 4)
        assert.equal(r.weights.toolCallCost, 0)
        assert.equal(r.weights.tierWeights.qwen.input, 0.8)
    })
    test('负数/NaN/字符串逐项剔除并点名；好项保留', () => {
        const r = normalizeCreditWeights({inputWeight: -2, outputWeight: 'x', toolCallCost: 2})
        assert.equal(r.weights.inputWeight, undefined)
        assert.equal(r.weights.outputWeight, undefined)
        assert.equal(r.weights.toolCallCost, 2)
        assert.equal(r.issues.length, 2)
    })
    test('坏档剔档不连坐好档；tierWeights 非对象记 issue', () => {
        const r = normalizeCreditWeights({tierWeights: {good: {input: 1, output: 2}, bad: {input: -1}}})
        assert.ok(r.weights.tierWeights.good)
        assert.ok(!r.weights.tierWeights.bad)
        assert.match(r.issues.join(), /tierWeights\.bad/)
        assert.equal(normalizeCreditWeights({tierWeights: 'junk'}).weights, null)
    })
    test('非对象/坏 JSON 串 ⇒ weights=null（退化计数，不炸不猜）', () => {
        assert.equal(normalizeCreditWeights(undefined).weights, null)
        assert.equal(normalizeCreditWeights('[1,2]').weights, null)
        assert.equal(normalizeCreditWeights('{"a":').weights, null)
        assert.deepEqual(normalizeCreditWeights(undefined).issues, [])
    })
    test('computeCredits 吃坏权重：坏项不参与、priced 只认真生效的项（负 outputWeight 不许点亮计价）', () => {
        const r = computeCredits({promptTokens: 10, completionTokens: 5, weights: {outputWeight: -3}})
        assert.equal(r.priced, false, '剔完只剩退化权重 ⇒ 未计价')
        assert.equal(r.credits, 15)
        const r2 = computeCredits({promptTokens: 10, completionTokens: 5, weights: {outputWeight: -3, toolCallCost: 2}})
        assert.equal(r2.priced, true, 'toolCallCost 是合法项 ⇒ 计价生效')
    })
})

describe('rollupCredits', () => {
    test('逐条相加，root+children 归一到会话', () => {
        const r = rollupCredits([
            computeCredits({ promptTokens: 100, completionTokens: 100 }),
            computeCredits({ promptTokens: 50, completionTokens: 50 }),
        ])
        assert.equal(r.totalCredits, 300)
        assert.equal(r.count, 2)
    })

    test('任一未计价 ⇒ 整体 priced:false（诚实：混合来源不能谎称全计费了）', () => {
        const r = rollupCredits([
            { credits: 10, priced: true },
            { credits: 5, priced: false },
        ])
        assert.equal(r.totalCredits, 15)
        assert.equal(r.priced, false)
    })

    test('全计价 ⇒ priced:true', () => {
        const r = rollupCredits([
            { credits: 10, priced: true },
            { credits: 5, priced: true },
        ])
        assert.equal(r.priced, true)
    })

    test('空数组 ⇒ 0 且 priced:true 无意义时不谎报（length0 ⇒ priced:false）', () => {
        const r = rollupCredits([])
        assert.equal(r.totalCredits, 0)
        assert.equal(r.count, 0)
        assert.equal(r.priced, false)
    })

    test('兼容直接喂原始计数（内部逐条 computeCredits）', () => {
        const r = rollupCredits([{ promptTokens: 30, completionTokens: 20 }])
        assert.equal(r.totalCredits, 50)
    })
})

describe('buildUsageCreditsFields（M6 落账点唯一构造器）', () => {
    test('无权重 ⇒ 未计价退化为 prompt+completion（本期默认形态：credits 是计数不是钱）', () => {
        const f = buildUsageCreditsFields({
            promptTokens: 1200, completionTokens: 340,
            model: {family: 'common'}, weights: undefined,
        })
        assert.deepEqual(f, {credits: 1540, creditsPriced: false})
    })

    test('给权重 ⇒ priced:true；模型族命中 tierWeights 时按族单价', () => {
        const f = buildUsageCreditsFields({
            promptTokens: 100, completionTokens: 50,
            model: {family: 'qwen'},
            weights: {inputWeight: 1, outputWeight: 1, tierWeights: {qwen: {input: 2, output: 4}}},
        })
        assert.equal(f.creditsPriced, true)
        assert.equal(f.credits, 100 * 2 + 50 * 4)
    })

    test('model 缺失/无 family ⇒ 不猜档，仍按全局/退化权重，绝不编 tier', () => {
        assert.deepEqual(buildUsageCreditsFields({promptTokens: 10, completionTokens: 5}),
            {credits: 15, creditsPriced: false})
        assert.deepEqual(buildUsageCreditsFields({promptTokens: 10, completionTokens: 5, model: null}),
            {credits: 15, creditsPriced: false})
    })
})
