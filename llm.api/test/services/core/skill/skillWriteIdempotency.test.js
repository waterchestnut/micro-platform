/**
 * @fileOverview skill 写面幂等判据的穷举用例（纯函数，无 IO）
 * @module test/services/core/skill/skillWriteIdempotency.test
 * @description
 * 判据先行刀的地基：决策表每一档、白名单每一种形状、键的每种缺失形态都要有断言。
 * GATE_REASONS 词表做封闭集核对——新理由进表不进测试会红（"结论只能来自读数"在测试层的同构）。
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
    GATE_REASONS, WRITE_STARTED_MSG,
    buildSkillWriteKey, matchWriteTool, decideSkillWriteGate, clipSnapshot,
} from '../../../../services/core/skill/skillWriteIdempotency.js'

describe('buildSkillWriteKey（§7 line 741 口径）', () => {
    test('两段齐 ⇒ runCode:toolCallId', () => {
        assert.equal(buildSkillWriteKey({runCode: 'msg-1', toolCallId: 'tc-9'}), 'msg-1:tc-9')
    })
    test('缺任一段 ⇒ null（豁免分支的输入，不许生成半截键）', () => {
        assert.equal(buildSkillWriteKey({runCode: '', toolCallId: 't'}), null)
        assert.equal(buildSkillWriteKey({runCode: 'r', toolCallId: ''}), null)
        assert.equal(buildSkillWriteKey({}), null)
        assert.equal(buildSkillWriteKey(), null)
    })
})

describe('matchWriteTool（运维白名单，不做启发式）', () => {
    test('精确名命中；不同名不中', () => {
        assert.equal(matchWriteTool('doc_api/upload', ['doc_api/upload']), true)
        assert.equal(matchWriteTool('doc_api/uploadA', ['doc_api/upload']), false)
    })
    test('前缀 `/*` 命中族，不命中隔壁前缀', () => {
        assert.equal(matchWriteTool('doc_api/upload', ['doc_api/*']), true)
        assert.equal(matchWriteTool('doc_api_x/y', ['doc_api/*']), false)
    })
    test('空名单/坏规则一律不中（闸开启但名单空=形同虚设，判据不许自己脑补写面）', () => {
        assert.equal(matchWriteTool('any/tool', []), false)
        assert.equal(matchWriteTool('any/tool', undefined), false)
        assert.equal(matchWriteTool('any/tool', ['', null]), false)
    })
    test('无工具名 ⇒ 不中（漂移形状宁可 passthrough，不许误拦）', () => {
        assert.equal(matchWriteTool('', ['doc_api/*']), false)
        assert.equal(matchWriteTool(undefined, ['a']), false)
    })
})

describe('decideSkillWriteGate 决策表（穷举）', () => {
    const W = ['doc_api/upload']
    const K = 'm1:t1'

    test('档位 1 gate-off：enabled 非显式 true ⇒ passthrough，且 existing 传了也不看', () => {
        for (const off of [false, undefined, null, 'true', 1]) {
            const d = decideSkillWriteGate({enabled: off, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: 'done', resultSnapshot: 'x'}})
            assert.deepEqual(d, {action: 'passthrough', reason: 'gate-off'}, `off=${String(off)}`)
        }
    })
    test('档位 2 not-write：开闸但名单外 ⇒ passthrough（读面不付账查询的钱）', () => {
        assert.deepEqual(decideSkillWriteGate({enabled: true, toolName: 'searxng/search', writeTools: W, key: K, existing: null}),
            {action: 'passthrough', reason: 'not-write'})
    })
    test('档位 3 no-key：写面命中但键缺 ⇒ passthrough（闸只加保险不减兼容）', () => {
        const d = decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: null, existing: null})
        assert.deepEqual(d, {action: 'passthrough', reason: 'no-key'})
    })
    test('档位 4 first-seen：写面有键无账 ⇒ execute（接线层先 claim）', () => {
        assert.deepEqual(decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: null}),
            {action: 'execute', reason: 'first-seen'})
    })
    test('档位 5 done-hit ⇒ replay 带快照（全闸的目的：不重执行、回原结果）', () => {
        const d = decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K,
            existing: {status: 'done', resultSnapshot: '{"success":true}', snapshotTruncated: true}})
        assert.deepEqual(d, {action: 'replay', reason: 'done-hit', snapshot: '{"success":true}', truncated: true})
    })
    test('done 行缺快照字段 ⇒ replay 空串（账坏成什么样都回放不出第二次的副作用）', () => {
        const d = decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: 'done'}})
        assert.equal(d.action, 'replay')
        assert.equal(d.snapshot, '')
    })
    test('档位 6 started-hit ⇒ refuse（"可能已发生"不许赌没发生——B-4 要防的正例）', () => {
        const d = decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: 'started'}})
        assert.deepEqual(d, {action: 'refuse', reason: 'started-hit'})
    })
    test('词表外状态 ⇒ refuse(unknown-status)："不知道"站危险面，不站省事面', () => {
        for (const st of ['weird', '', null, undefined, 'DONE']) {
            const d = decideSkillWriteGate({enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: st}})
            assert.deepEqual(d, {action: 'refuse', reason: 'unknown-status'}, `status=${String(st)}`)
        }
    })
    test('理由封闭集：决策表能产出的 reason 恰好 = GATE_REASONS（新档漏测即红）', () => {
        const produced = new Set()
        const cases = [
            {enabled: false}, {enabled: true, toolName: 'x'},
            {enabled: true, toolName: 'doc_api/upload', writeTools: W, key: null},
            {enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K},
            {enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: 'done', resultSnapshot: ''}},
            {enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: 'started'}},
            {enabled: true, toolName: 'doc_api/upload', writeTools: W, key: K, existing: {status: '?'}},
        ]
        for (const c of cases) {
            produced.add(decideSkillWriteGate({...c, writeTools: c.writeTools || W}).reason)
        }
        assert.deepEqual([...produced].sort(), [...GATE_REASONS].sort())
    })
    test('WRITE_STARTED_MSG 是完整的一句话（回给模型的话不能是代号）', () => {
        assert.match(WRITE_STARTED_MSG, /未重复执行/)
        assert.match(WRITE_STARTED_MSG, /新的调用/)
    })
})

describe('clipSnapshot（钳制如实打标）', () => {
    test('未超限原样，不钳标', () => {
        assert.deepEqual(clipSnapshot('abc', 5), {text: 'abc', truncated: false})
        assert.deepEqual(clipSnapshot('abcde', 5), {text: 'abcde', truncated: false}, '恰好等于上限=没钳')
    })
    test('超限截断带标', () => {
        assert.deepEqual(clipSnapshot('abcdefg', 4), {text: 'abcd', truncated: true})
    })
    test('max<=0/非数 ⇒ 不钳（配置漂移宁可全存，不许静默丢内容）', () => {
        assert.deepEqual(clipSnapshot('abcdef', 0), {text: 'abcdef', truncated: false})
        assert.deepEqual(clipSnapshot('abcdef', NaN), {text: 'abcdef', truncated: false})
        assert.deepEqual(clipSnapshot('abcdef', 'x'), {text: 'abcdef', truncated: false})
    })
    test('非串输入转串（tool content 理论上必是串，形状漂移不炸闸）', () => {
        assert.deepEqual(clipSnapshot(null, 10), {text: '', truncated: false})
        assert.equal(clipSnapshot(undefined, 10).text, '')
        assert.equal(clipSnapshot({a: 1}, 100).text, '[object Object]')
    })
})
