/**
 * @fileOverview execChat 主循环纯决策逻辑的离线单测
 * @module test/services/core/llmLoop
 * @description
 * 这张网是给 PR-A/B/C/D/E 用的：`execChat` 此前零单测（§2.10），
 * 而它要连续被改五轮。这里**钉住抽取前的现状**，包括看起来像 bug 但不打算在本刀改的行为
 * （例如"没有 index 的 tool_call 增量被丢弃"）。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {
    resolveProtocol,
    accumulateToolCalls,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    classifyToolCalls,
    buildToolNameIndex,
    clipTraceResult,
    detachAction,
    steerAction,
    RUN_PHASES,
} from '../../../services/core/llmLoop.js'

/* ========================= 协议协商 ========================= */

test('resolveProtocol：缺省走协议 1，不下发工具结果', () => {
    assert.deepEqual(resolveProtocol({}), {protocol: 1, emitToolResults: false})
    assert.deepEqual(resolveProtocol({protocol: 1}), {protocol: 1, emitToolResults: false})
})

test('resolveProtocol：协议 2 默认下发工具结果，字符串数字也认', () => {
    assert.deepEqual(resolveProtocol({protocol: 2}), {protocol: 2, emitToolResults: true})
    assert.deepEqual(resolveProtocol({protocol: '2'}), {protocol: 2, emitToolResults: true})
    assert.deepEqual(resolveProtocol({protocol: 3}), {protocol: 2, emitToolResults: true}, '高于 2 的按 2 处理')
})

test('resolveProtocol：协议 1 可用 streamToolResults 单独开启', () => {
    assert.equal(resolveProtocol({protocol: 1, streamToolResults: true}).emitToolResults, true)
    assert.equal(resolveProtocol({protocol: 1, streamToolResults: 1}).emitToolResults, true)
})

/* ========================= tool_calls 增量聚合 ========================= */

test('accumulateToolCalls：函数名与参数分多个 chunk 到达时逐段拼接', () => {
    let tc = []
    tc = accumulateToolCalls(tc, [{index: 0, id: 'call_1', function: {name: 'searxng_', arguments: ''}}]).toolCalls
    tc = accumulateToolCalls(tc, [{index: 0, function: {name: 'http/search', arguments: '{"qu'}}]).toolCalls
    tc = accumulateToolCalls(tc, [{index: 0, function: {arguments: 'ery":"a"}'}}]).toolCalls

    assert.equal(tc.length, 1)
    assert.equal(tc[0].id, 'call_1')
    assert.equal(tc[0].function.name, 'searxng_http/search')
    assert.equal(tc[0].function.arguments, '{"query":"a"}')
    assert.equal(tc[0].type, 'function')
})

test('accumulateToolCalls：index 乱序到达时补齐空位，不串号', () => {
    let tc = []
    tc = accumulateToolCalls(tc, [{index: 1, id: 'call_b', function: {name: 'b', arguments: '{}'}}]).toolCalls
    tc = accumulateToolCalls(tc, [{index: 0, id: 'call_a', function: {name: 'a', arguments: '{}'}}]).toolCalls

    assert.equal(tc.length, 2)
    assert.equal(tc[0].id, 'call_a', 'index 0 应落在 0 位')
    assert.equal(tc[1].id, 'call_b')
})

test('accumulateToolCalls：没有 index 的增量被丢弃（钉住现状）', () => {
    const before = []
    const {toolCalls, touched} = accumulateToolCalls(before, [{id: 'x', function: {name: 'y', arguments: '{}'}}])
    assert.equal(touched, true, '出现 tool_calls 字段就算 touched，与抽取前 receivedToolCall 语义一致')
    assert.deepEqual(toolCalls, [], '缺 index 时不新建条目')
})

test('accumulateToolCalls：无 tool_calls 的 chunk 返回 touched=false', () => {
    const {touched} = accumulateToolCalls([], undefined)
    assert.equal(touched, false)
})

test('accumulateToolCalls：id 只在首个增量出现一次，后续不覆盖', () => {
    let tc = []
    tc = accumulateToolCalls(tc, [{index: 0, id: 'call_keep', function: {name: 'n', arguments: ''}}]).toolCalls
    tc = accumulateToolCalls(tc, [{index: 0, function: {arguments: '{}'}}]).toolCalls
    assert.equal(tc[0].id, 'call_keep')
    assert.equal(tc[0].function.arguments, '{}')
})

test('pruneToolCalls：丢掉只有 name 没有 id、或只有 id 没有 name 的空壳', () => {
    const kept = pruneToolCalls([
        {id: 'a', function: {name: 'x'}},
        {id: '', function: {name: 'x'}},
        {id: 'b', function: {name: ''}},
        {id: 'c'},
        null,
    ])
    assert.equal(kept.length, 1)
    assert.equal(kept[0].id, 'a')
})

test('buildAssistantToolCallMessage：content 必须是显式 null', () => {
    const msg = buildAssistantToolCallMessage([{id: 'a', function: {name: 'x'}}])
    assert.equal(msg.role, 'assistant')
    assert.equal(msg.content, null)
    assert.ok('content' in msg, '不能省略 content 字段')
    assert.equal(msg.tool_calls.length, 1)
})

/* ========================= 工具分派分类 ========================= */

const PREDS = {
    isMemoryTool: (n) => String(n).startsWith('memory_'),
    isOverflowTool: (n) => n === 'read_tool_result',
    isCodeTool: (n) => n === 'run_code',
}

test('classifyToolCalls：四类互斥且并集完整', () => {
    const calls = [
        {id: '1', function: {name: 'memory_save'}},
        {id: '2', function: {name: 'memory_search'}},
        {id: '3', function: {name: 'read_tool_result'}},
        {id: '4', function: {name: 'run_code'}},
        {id: '5', function: {name: 'searxng_http/search'}},
    ]
    const r = classifyToolCalls(calls, PREDS)
    assert.equal(r.memoryCalls.length, 2)
    assert.equal(r.overflowCalls.length, 1)
    assert.equal(r.codeCalls.length, 1)
    assert.equal(r.otherCalls.length, 1)
    const total = r.memoryCalls.length + r.overflowCalls.length + r.codeCalls.length + r.otherCalls.length
    assert.equal(total, calls.length, '不能有调用被丢掉，也不能被算两次')
})

test('classifyToolCalls：谓词缺失时全部落到 otherCalls，不抛错', () => {
    const r = classifyToolCalls([{id: '1', function: {name: 'whatever'}}], {})
    assert.equal(r.otherCalls.length, 1)
    assert.equal(r.memoryCalls.length, 0)
})

test('classifyToolCalls：function 缺失的脏数据不炸', () => {
    const r = classifyToolCalls([{id: '1'}, {id: '2', function: {}}], PREDS)
    assert.equal(r.otherCalls.length, 2)
})

test('buildToolNameIndex：结果只收有 id 的项', () => {
    const idx = buildToolNameIndex([{id: 'a', function: {name: 'x'}}, {id: '', function: {name: 'y'}}, null])
    assert.deepEqual(idx, {a: 'x'})
})

/* ========================= trace 截断 ========================= */

test('clipTraceResult：字符串超长才截，并标注 truncated', () => {
    assert.equal(clipTraceResult('abc'), 'abc')
    assert.equal(clipTraceResult('abcdef', 3), 'abc...[truncated]')
    assert.equal(clipTraceResult('abc', 3), 'abc', '正好等于上限不截')
})

test('clipTraceResult：非字符串走序列化；null/undefined 产出 \'""\'（现状怪癖，先钉住）', () => {
    assert.equal(clipTraceResult({a: 1}), '{"a":1}')
    /**
     * 现状：`content ?? ''` 先把 null 折成空串，再 JSON.stringify ⇒ 得到带引号的 `'""'`，
     * 而不是空字符串或 'null'。trace 里会看到一个字面 `""`。
     * 本刀**不改行为**（§纪律 2：先钉住现状），PR-A 再决定是否折成空串——
     * 它只影响历史回放的观感，不影响判定，但改了就等于同时改了 574 条已落库数据的解释方式。
     */
    assert.equal(clipTraceResult(null), '""')
    assert.equal(clipTraceResult(undefined), '""')
})

/* ========================= 断开阶段策略（供 PR-C 用） ========================= */

test('detachAction：生成中立即停，工具中跑完本批再停', () => {
    assert.equal(detachAction('generating').stopStream, true)
    assert.equal(detachAction('tool_executing').stopStream, false, '不打断进行中的工具批次（D4）')
    assert.equal(detachAction('tool_executing').stopAfterBoundary, true)
})

test('detachAction：挂起状态零成本，不重复落库', () => {
    const a = detachAction('awaiting_input')
    assert.equal(a.persist, 'keep')
    assert.equal(a.stopAfterBoundary, false)
})

test('detachAction：未知阶段按最保守的生成中处理', () => {
    assert.deepEqual(detachAction('weird'), detachAction('generating'))
})

test('detachAction：每种阶段都有明确的续跑现场', () => {
    for (const p of RUN_PHASES) {
        assert.ok(['postTools', 'preCreate', 'awaitInput'].includes(detachAction(p).resumeFrom), `${p} 缺续跑现场`)
    }
})

/* ========================= 插话注入点 ========================= */

test('steerAction：soft 一律边界注入、不打断当前流', () => {
    for (const p of RUN_PHASES) {
        const a = steerAction('soft', p)
        assert.equal(a.abortCurrentStream, false)
        assert.equal(a.injectAt, 'boundary')
    }
})

test('steerAction：hard 在生成阶段立即打断，在工具阶段退化为边界注入', () => {
    const gen = steerAction('hard', 'generating')
    assert.equal(gen.abortCurrentStream, true)
    assert.equal(gen.injectAt, 'immediate')

    const tool = steerAction('hard', 'tool_executing')
    assert.equal(tool.abortCurrentStream, false, '工具执行中不得被 hard 打断（D4 副作用优先）')
    assert.equal(tool.injectAt, 'postTools')
})
