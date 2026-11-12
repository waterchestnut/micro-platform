/**
 * @fileOverview 工具**入参**进 trace/视图的离线单测（PR-H H1）
 * @module test/services/core/llmTraceArgs
 * @description
 * H1 立的字据只有一条：**档案与流里第一次看得见模型传了什么参数**（此前实测 148/148 条调用记录没有入参）。
 * 但"看得见"必须是**可信的看得见**，所以这些用例钉的是三件事：
 * 1. `argsChars` 永远是未截断的真实字符数——不能像 `clipTraceResult` 那样把 `...[truncated]` 拼进正文，
 *    那会让"截了"与"截到多少"塌成一个尾巴，读者无从判断少了什么；
 * 2. `argsChars: 0`（模型确实传了空参数）与**没有这个字段**（存量行未记录）是两件事，
 *    前者是事实、后者必须渲染成"未记录"，混起来就是"用空参数冒充没传参"；
 * 3. 视图必须**原样透传**这三个字段。`toProcessSummary` 里 `toolCalls` 是一句 `info.toolCalls || []`，
 *    看着像不用测——但"不用改"与"不会漏"只有测过才分得清（那个函数搬出来之前，契约面从来没有一条测试）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    buildToolNameIndex,
    buildToolArgsIndex,
    clipTraceArgs,
    clipTraceResult,
    DEFAULT_TRACE_ARGS_CHARS,
} from '../../../services/core/llmLoop.js'
import {toProcessSummary, toMessageView} from '../../../services/core/messageView.js'

describe('clipTraceArgs：正文/原长/是否截断，三者各说各的', () => {
    test('预算内原样给，argsTruncated=false', () => {
        const r = clipTraceArgs('{"q":"abc"}', 100)
        assert.equal(r.args, '{"q":"abc"}')
        assert.equal(r.argsChars, 11, '{"q":"abc"}」的实际长度（上一版我写 9，是自己数错了）')
        assert.equal(r.argsTruncated, false)
    })

    test('正好等于预算不算截断（与 clipTraceResult 同口径）', () => {
        const s = 'x'.repeat(8)
        const r = clipTraceArgs(s, 8)
        assert.equal(r.args.length, 8)
        assert.equal(r.argsTruncated, false, '等于上限就截，会把"贴边"说成"越界"')
    })

    test('超预算时 args 截到上限，但 argsChars 仍是**原文**长度', () => {
        const raw = JSON.stringify({url: 'https://example.com/' + 'a'.repeat(500)})
        const r = clipTraceArgs(raw, 50)
        assert.equal(r.args.length, 50)
        assert.equal(r.argsChars, raw.length, '原长被截断值污染 ⇒ 前端就说不清少了多少')
        assert.equal(r.argsTruncated, true)
        assert.ok(!r.args.includes('[truncated]'), '截断标记不许拼进正文：那会让 args 不再是合法 JSON 的前缀')
    })

    test('对象入参走序列化；String(obj) 会得到 [object Object] 那种没用的东西', () => {
        const r = clipTraceArgs({a: 1, b: [2]}, 100)
        assert.equal(r.args, '{"a":1,"b":[2]}')
        /**
         * 长度断言用 `r.args.length` 而不是我手数的数字——同一次提交里我已经把两个手数的长度数错了
         * （9 与 13，实际都是 11 与 15）。手数的期望值本身就是这个测试要防的那类错误。
         */
        assert.equal(r.argsChars, r.args.length)
        assert.equal(r.argsChars, 15)
    })

    test('空入参是"0 字"这个事实，与"没有该字段"不同', () => {
        for (const v of [undefined, null, '']) {
            const r = clipTraceArgs(v, 100)
            assert.equal(r.args, '')
            assert.equal(r.argsChars, 0, '空参数必须报 0，让前端能说"模型确实没传参"')
            assert.equal(r.argsTruncated, false)
        }
    })

    test('limit 不可用时回落到默认预算，不静默变"全留"', () => {
        const long = 'y'.repeat(DEFAULT_TRACE_ARGS_CHARS + 10)
        for (const bad of [0, -1, NaN, undefined, '']) {
            const r = clipTraceArgs(long, bad)
            assert.equal(r.args.length, DEFAULT_TRACE_ARGS_CHARS, `limit=${String(bad)} 应当落到默认预算`)
            assert.equal(r.argsTruncated, true)
        }
    })

    test('与 clipTraceResult 的差异是刻意的：那边截断标记进正文，这边不进', () => {
        const raw = 'z'.repeat(20)
        assert.ok(clipTraceResult(raw, 10).endsWith('...[truncated]'),
            '既有行为（钉住，不改）：result 的截断标记在字符串里')
        assert.equal(clipTraceArgs(raw, 10).args.includes('[truncated]'), false,
            '新增行为：args 的可信度靠独立字段，不靠污染正文')
    })
})

describe('buildToolArgsIndex：按 tool_call_id 反查入参', () => {
    test('id -> arguments 原样给（OpenAI 形态是 JSON 字符串，这里不解析）', () => {
        const calls = [
            {id: 'a1', function: {name: 'search', arguments: '{"q":"x"}'}},
            {id: 'a2', function: {name: 'code', arguments: '{"code":"print(1)"}'}},
        ]
        assert.deepEqual(buildToolArgsIndex(calls), {
            a1: '{"q":"x"}',
            a2: '{"code":"print(1)"}',
        })
    })

    test('没有 id 的调用跳过（与 buildToolNameIndex 同规矩）', () => {
        const calls = [{function: {name: 'x', arguments: '{}'}}, {id: 'b1', function: {name: 'y', arguments: '{"k":1}'}}]
        assert.deepEqual(Object.keys(buildToolArgsIndex(calls)), ['b1'])
    })

    test('function 缺失时给 undefined 而不是抛错：工具名与入参两条索引都不能因为半个调用记录打挂整轮', () => {
        const idx = buildToolArgsIndex([{id: 'c1'}])
        assert.equal(idx.c1, undefined)
        assert.deepEqual(buildToolNameIndex([{id: 'c1'}]), {c1: undefined})
    })

    test('不传参时返回空对象而不是 undefined', () => {
        assert.deepEqual(buildToolArgsIndex(), {})
    })
})

describe('视图必须把 args 三字段原样带到前端（"不用改视图"只有测过才算结论）', () => {
    const doc = {
        messageCode: 'm1',
        answer: '好了',
        progress: 'finish',
        extInfo: {
            iterationCount: 2,
            toolCalls: [
                {id: 'a1', name: 'search', result: '3 条', args: '{"q":"x"}', argsChars: 9, argsTruncated: false},
                {id: 'a2', name: 'code', result: 'ok', args: '', argsChars: 0, argsTruncated: false},
                /** 存量行：整个入参维度缺失，前端要能把它与 argsChars=0 区分开 */
                {id: 'a3', name: 'legacy', result: '旧数据'},
            ],
        },
    }

    test('toProcessSummary 不吞字段也不加字段', () => {
        const p = toProcessSummary(doc.extInfo)
        assert.equal(p.toolCalls.length, 3)
        assert.deepEqual(Object.keys(p.toolCalls[0]), ['id', 'name', 'result', 'args', 'argsChars', 'argsTruncated'])
        assert.equal(p.toolCalls[1].argsChars, 0, '空参数是事实，不能被归一成 undefined')
        assert.equal('args' in p.toolCalls[2], false, '存量行的"未记录"必须保持缺失，不能被补成空串')
    })

    test('toMessageView 走同一份摘要（前端只从 process 里读）', () => {
        const v = toMessageView(doc)
        assert.equal(v.process.toolCalls[0].args, '{"q":"x"}')
        assert.equal(v.process.toolCalls[0].argsChars, 9)
    })
})
