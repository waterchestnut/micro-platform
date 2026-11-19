import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import { parsePlannerOutput } from '../../../services/agent/fanOutIntake.js'

/**
 * planner 输出解析（M4b c1a）。性格测试：一切模糊向"不扇"收——
 * 漏判退化成普通回答（无损），误判把用户一句话拆成树（事故）。
 */
const two = '{"needFanOut":true,"reason":"两部分独立","subtasks":[{"title":"A","query":"做A"},{"title":"B","query":"做B"}]}'

describe('parsePlannerOutput 格式容错（模型的口癖）', () => {
    test('裸 JSON ⇒ 收两子任务', () => {
        const r = parsePlannerOutput(two)
        assert.equal(r.ok, true)
        assert.equal(r.needFanOut, true)
        assert.equal(r.subtasks.length, 2)
    })

    test('markdown 围栏包裹 ⇒ 照样解析', () => {
        assert.equal(parsePlannerOutput('```json\n' + two + '\n```').needFanOut, true)
        assert.equal(parsePlannerOutput('```\n' + two + '\n```').needFanOut, true)
    })

    test('前后带废话 ⇒ 抠第一个 { 到最后一个 }', () => {
        assert.equal(parsePlannerOutput('好的，我的判断如下：' + two + ' 以上。').needFanOut, true)
    })

    test('title 缺失用 query 前缀兜底；query 空白项被滤掉', () => {
        const r = parsePlannerOutput('{"needFanOut":true,"subtasks":[{"query":"甲"},{"title":"T","query":"  "},{"query":"乙"}]}')
        assert.equal(r.subtasks.length, 2)
        assert.equal(r.subtasks[0].title, '甲')
    })
})

describe('parsePlannerOutput 语义严判（模型的承诺）', () => {
    test('非 JSON/无大括号/空 ⇒ ok:false 且 needFanOut:false（失败一律收成不扇）', () => {
        for (const t of ['', '   ', '我觉得不用拆', '{broken json', '{"needFanOut":true,,}']) {
            const r = parsePlannerOutput(t)
            assert.equal(r.ok, false, t)
            assert.equal(r.needFanOut, false, t)
            assert.deepEqual(r.subtasks, [], t)
        }
    })

    test('needFanOut 必须严格布尔 true："true"/1/"yes" 都不算（没按契约=契约失败）', () => {
        for (const v of ['"true"', '1', '"yes"']) {
            const r = parsePlannerOutput(`{"needFanOut":${v},"subtasks":[{"query":"甲"},{"query":"乙"}]}`)
            assert.equal(r.needFanOut, false, v)
        }
    })

    test('needFanOut:false ⇒ ok:true 但不扇，reason 用模型给的', () => {
        const r = parsePlannerOutput('{"needFanOut":false,"reason":"单一问题"}')
        assert.equal(r.ok, true)
        assert.equal(r.needFanOut, false)
        assert.equal(r.reason, '单一问题')
    })

    test('有效子任务不足 2 ⇒ single-or-empty（一个子任务＝普通回答，别伪装并行）', () => {
        assert.equal(parsePlannerOutput('{"needFanOut":true,"subtasks":[{"query":"只一个"}]}').reason, 'single-or-empty')
        assert.equal(parsePlannerOutput('{"needFanOut":true,"subtasks":[]}').reason, 'single-or-empty')
        assert.equal(parsePlannerOutput('{"needFanOut":true}').reason, 'single-or-empty')
    })

    test('超量输出先按 maxInput 截（防跑飞灌下游；预算闸在 normalizeFanOutPlan 不在此重造）', () => {
        const many = { needFanOut: true, subtasks: Array.from({ length: 12 }, (_, i) => ({ query: 'q' + i })) }
        const r = parsePlannerOutput(JSON.stringify(many), { maxInput: 8 })
        assert.equal(r.subtasks.length, 8)
    })

    test('顶层数组(无花括号可抠) ⇒ no-json-object，不猜', () => {
        assert.equal(parsePlannerOutput('[1,2]').reason, 'no-json-object')
    })

    test('脏输入不炸（null/数字/对象直传）', () => {
        for (const t of [null, undefined, 42, {}]) {
            const r = parsePlannerOutput(t)
            assert.equal(r.needFanOut, false)
        }
    })
})
