/**
 * @fileOverview fanOutPlanGraph 分层判据穷举（§8 自适应编排 c1）
 * @module test/services/agent/fanOutPlanGraph.test
 * @description
 * 三条红线在用例里钉死：①兼容面——无 deps 输入=单层直通（现网拆解器零行为变化）；
 * ②严判面——环/悬空引用/自依赖/坏形状/层超**一律整案 reject**（绝不修剪硬凑，
 * 修出来的不是模型承诺的图）；③分层形状——Kahn 批次正确（同层并行、跨层先后）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { layerFanOutPlan, planTotals } from '../../../services/agent/fanOutPlanGraph.js'

const S = (id, deps) => ({ id, title: `T-${id}`, query: `q-${id}`, ...(deps ? { deps } : {}) })

describe('layerFanOutPlan：兼容面（无 deps=今天）', () => {
    test('全无 deps ⇒ 单层直通，reason=flat，项对象原样（不注 id/deps 键）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b'), S('c')] })
        assert.equal(r.ok, true)
        assert.equal(r.reason, 'flat')
        assert.equal(r.layers.length, 1)
        assert.deepEqual(r.layers[0].map((s) => s.id), ['a', 'b', 'c'])
        assert.deepEqual(r.layers[0][0], S('a'), '项逐字原样（透传不改造）')
    })
    test('空/坏输入 ⇒ no-subtasks reject', () => {
        assert.equal(layerFanOutPlan({}).reason, 'no-subtasks')
        assert.equal(layerFanOutPlan({ subtasks: [null] }).reason, 'no-subtasks')
    })
    test('deps 全空数组的显式声明 ⇒ 仍单层（layered 只在真跨层时出现）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a', []), S('b')] })
        assert.equal(r.ok, true); assert.equal(r.layers.length, 1); assert.equal(r.reason, 'flat')
    })
})

describe('layerFanOutPlan：分层形状', () => {
    test('a→b 依赖 ⇒ 两层（a 先行 b 候）', () => {
        const r = layerFanOutPlan({ subtasks: [S('b', ['a']), S('a')] })
        assert.equal(r.ok, true)
        assert.deepEqual(r.layers.map((L) => L.map((s) => s.id)), [['a'], ['b']])
        assert.equal(r.reason, 'layered')
    })
    test('同层并行：c 依赖 a,b ⇒ [[a,b],[c]]', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b'), S('c', ['a', 'b'])] })
        assert.deepEqual(r.layers.map((L) => L.map((s) => s.id)), [['a', 'b'], ['c']])
    })
    test('菱形 a→(b,c)→d ⇒ 三层且层内同序于输入', () => {
        const r = layerFanOutPlan({ subtasks: [S('d', ['b', 'c']), S('b', ['a']), S('c', ['a']), S('a')] })
        assert.deepEqual(r.layers.map((L) => L.map((s) => s.id)), [['a'], ['b', 'c'], ['d']])
    })
    test('层数上限：4 层链 > maxLayers(3) ⇒ layer-limit reject（深链=sequential 伪装扇出）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b', ['a']), S('c', ['b']), S('d', ['c'])] })
        assert.equal(r.ok, false); assert.equal(r.reason, 'layer-limit')
    })
    test('maxLayers 注入放宽 ⇒ 同题 4 层可过（上限是参数不是教条）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b', ['a']), S('c', ['b']), S('d', ['c'])], maxLayers: 4 })
        assert.equal(r.ok, true); assert.equal(r.layers.length, 4)
    })
    test('maxLayers 坏值(0/负/NaN) ⇒ 回退默认 3 而不是全案误杀', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b', ['a']), S('c', ['b'])], maxLayers: 0 })
        assert.equal(r.ok, true)
    })
})

describe('layerFanOutPlan：reject 面（严判不修剪）', () => {
    test('环引用 ⇒ cycle + 残余 id 如实列出（不拆环硬跑）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a', ['b']), S('b', ['a']), S('c')] })
        assert.equal(r.ok, false); assert.equal(r.reason, 'cycle')
        assert.deepEqual(r.cyclic.sort(), ['a', 'b'], 'c 不在环上、已先行排层——cyclic 只含环残余')
    })
    test('deps 引用不存在的 id ⇒ unknown-dep（模型没按契约点名）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a'), S('b', ['zz'])] })
        assert.equal(r.ok, false); assert.equal(r.reason, 'unknown-dep'); assert.deepEqual(r.cyclic, ['zz'])
    })
    test('自依赖 ⇒ self-dep（单列 reason：与悬空引用是两种错法）', () => {
        const r = layerFanOutPlan({ subtasks: [S('a', ['a'])] })
        assert.equal(r.ok, false); assert.equal(r.reason, 'self-dep')
    })
    test('带 deps 但有项缺显式 id ⇒ unknown-dep reject（隐式键混用=引用漂移）', () => {
        const noId = { title: 'x', query: 'q', deps: ['a'] }
        const r = layerFanOutPlan({ subtasks: [S('a'), noId] })
        assert.equal(r.ok, false); assert.equal(r.reason, 'unknown-dep')
    })
    test('deps 形状脏（字符串/含空项/非字符串元素）⇒ deps-malformed（语义是承诺不是口癖）', () => {
        assert.equal(layerFanOutPlan({ subtasks: [S('a'), { ...S('b'), deps: 'a' }] }).reason, 'deps-malformed')
        assert.equal(layerFanOutPlan({ subtasks: [S('a'), { ...S('b'), deps: ['a', ''] }] }).reason, 'deps-malformed')
        assert.equal(layerFanOutPlan({ subtasks: [S('a'), { ...S('b'), deps: [1] }] }).reason, 'deps-malformed')
    })
    test('重复 id ⇒ duplicate-id', () => {
        assert.equal(layerFanOutPlan({ subtasks: [S('a'), S('a', [])] }).reason, 'duplicate-id')
    })
})

describe('planTotals：预算吃总量不是 layer0', () => {
    test('三层计划 total=全项、firstBatch=层0、layers=层数', () => {
        const { layers } = layerFanOutPlan({ subtasks: [S('a'), S('b'), S('c', ['a', 'b'])] })
        assert.deepEqual(planTotals(layers), { total: 3, firstBatch: 2, layers: 2 })
    })
    test('空/坏输入全 0（不炸也不补形状）', () => {
        assert.deepEqual(planTotals([]), { total: 0, firstBatch: 0, layers: 0 })
        assert.deepEqual(planTotals(null), { total: 0, firstBatch: 0, layers: 0 })
    })
})
