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
import fs from 'node:fs'
import {
    buildToolNameIndex,
    buildToolArgsIndex,
    buildToolCallTraceEntry,
    findTraceShapeGaps,
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

/**
 * 这一组是给"底座现网出现了一条只有 {id,name,result} 三键的记录"准备的取证。
 * 如果构造器本身永远给六键，那么那条记录就不是这段代码写的；
 * 判不到这一点，就说明形状仍然散在调用方手里——所以先把它收进函数，再在这里钉死。
 */
describe('buildToolCallTraceEntry：trace 形状的唯一来源（两处出口共用）', () => {
    test('六键顺序固定，入参反查落空也照样给全三个入参字段', () => {
        const e = buildToolCallTraceEntry('c1', 'search_web', '结果正文', {argsById: {}})
        assert.deepEqual(Object.keys(e), ['id', 'name', 'result', 'args', 'argsChars', 'argsTruncated'])
        assert.equal(e.args, '', '索引里没有这条 id：正文是空串，但键必须在')
        assert.equal(e.argsChars, 0)
        assert.equal(e.argsTruncated, false)
    })

    test('name 反查不到时给 null 而不是省略（前端按名字分组，缺名字要看得见）', () => {
        const e = buildToolCallTraceEntry('c2', null, 'x', {argsById: {c2: '{"q":"y"}'}})
        assert.equal(e.name, null)
        assert.equal(e.args, '{"q":"y"}')
        assert.equal(e.argsChars, 9)
    })

    test('两个预算各自独立：结果被截不改变 argsChars 的真实长度', () => {
        const rawArgs = `{"url":"${'u'.repeat(30)}"}`
        const e = buildToolCallTraceEntry('c3', 'get_website', 'z'.repeat(60), {
            argsById: {c3: rawArgs}, argsCap: 20, resultCap: 10,
        })
        assert.equal(e.result, `${'z'.repeat(10)}...[truncated]`)
        assert.equal(e.args.length, 20, '入参按自己的预算截')
        assert.equal(e.argsChars, rawArgs.length, '原长不许被截断后的长度污染')
        assert.equal(e.argsChars, 40)
        assert.equal(e.argsTruncated, true)
    })

    test('不传 opts 也不炸：漏配预算时走各自默认值', () => {
        const e = buildToolCallTraceEntry('c4', 'x', 'abc')
        assert.equal(e.result, 'abc')
        assert.equal(e.args, '')
        assert.equal(e.argsChars, 0)
    })

    test('非字符串结果按序列化进 trace（保持 clipTraceResult 的既有形状）', () => {
        const e = buildToolCallTraceEntry('c5', 'x', {a: 1}, {argsById: {}})
        assert.equal(e.result, '{"a":1}')
    })

    test('null 结果仍是那枚已知怪癖 ""（不是新行为，但形状来源换人后必须仍然一致）', () => {
        const e = buildToolCallTraceEntry('c6', 'x', null, {argsById: {}})
        assert.equal(e.result, '""')
    })
})

describe('llmChat 不许再自己内联拼这条 trace（源码级防漂移）', () => {
    const src = fs.readFileSync(new URL('../../../services/core/llmChat.js', import.meta.url), 'utf8').replace(/\r/g, '')

    test('两处出口都在，且都走同一个构造器', () => {
        const pushes = src.split('\n').filter((l) => l.includes('toolCallTrace.push('))
        assert.equal(pushes.length, 2, `出口数量变了：${pushes.length}`)
        assert.ok(pushes.every((l) => l.includes('buildToolCallTraceEntry(')),
            `仍有出口在自己拼字段：${pushes.map((l) => l.trim().slice(0, 70)).join(' | ')}`)
    })

    test('旧的"手拼展开"形状在 llmChat 里必须归零', () => {
        /**
         * 这个形状一旦回来，等于"两处各写一份"回来了：键的存在性与顺序会开始各自漂移，
         * 而现网那种"三键记录"就再也说不清是谁写的。
         */
        const inline = src.split('\n').filter((l) => /\.\.\.clipTraceArgs\(argsById\[/.test(l))
        assert.deepEqual(inline, [], `llmChat 里又出现内联展开：${inline.map((l) => l.trim().slice(0, 60)).join(' | ')}`)
    })

    test('探测器必须真的接在落库口上（写了函数不调用是这类改动最常见的失败形状）', () => {
        const lines = src.split('\n')
        const calls = lines.filter((l) => l.includes('findTraceShapeGaps('))
        assert.equal(calls.length, 1, `调用次数=${calls.length}，期望 1（在 saveMessage 里）`)

        /** 只报标识符与计数：这一条不允许把正文带进日志，所以要盖住整条告警语句，而不只是首行 */
        const at = lines.findIndex((l) => l.includes('trace 形状缺入参声明'))
        assert.ok(at > 0, '缺声明的告警语句必须在场')
        const stmt = lines.slice(at - 1, at + 3).join('\n')
        assert.ok(stmt.includes('messageCode') && stmt.includes('writtenBy'), '告警要能归因到写入路径')
        assert.equal(/answer|toolResult\.content|\.query|inputs\b/.test(stmt), false,
            '告警不得携带正文（与全文外泄边界同一条纪律）')
    })
})

describe('findTraceShapeGaps：只认"有没有可核对的入参声明"', () => {
    test('六键条目不算缺口', () => {
        const t = buildToolCallTraceEntry('a1', 'search_web', '正文', {argsById: {a1: '{"q":"x"}'}})
        assert.deepEqual(findTraceShapeGaps([t]), [])
    })

    test('三键形状（cw2pc 那条异常的样子）被报出来，并带上 id', () => {
        assert.deepEqual(findTraceShapeGaps([{id: 'a2', name: 'search_web', result: 'r'}]), ['a2'])
    })

    test('argsChars 是 undefined 也算缺口——键名存在但值不可用，BSON 落库后与"没写过"无法区分', () => {
        assert.deepEqual(findTraceShapeGaps([{id: 'a3', argsChars: undefined}]), ['a3'])
    })

    test('字符串数字与 NaN 都不接受（声明必须是可核对的数）', () => {
        assert.deepEqual(findTraceShapeGaps([{id: 'b', argsChars: '12'}]), ['b'])
        assert.deepEqual(findTraceShapeGaps([{id: 'c', argsChars: NaN}]), ['c'])
    })

    test('0 是合法声明（模型确实传了空参数），不许被当成缺口', () => {
        assert.deepEqual(findTraceShapeGaps([{id: 'd', argsChars: 0}]), [])
    })

    test('只报缺的那几条，顺序保持', () => {
        const list = [
            {id: 'ok1', argsChars: 48},
            {id: 'gap1'},
            {id: 'ok2', argsChars: 0},
            {id: 'gap2', argsChars: null},
        ]
        assert.deepEqual(findTraceShapeGaps(list), ['gap1', 'gap2'])
    })

    test('老形状条目可用 tool_call_id 归因（两处 id 键名都认，与 resolveToolRef 同一口径）', () => {
        assert.deepEqual(findTraceShapeGaps([{tool_call_id: 'legacy1'}]), ['legacy1'])
    })

    test('非数组与空值入参返回空数组而不是抛出', () => {
        assert.deepEqual(findTraceShapeGaps(undefined), [])
        assert.deepEqual(findTraceShapeGaps('x'), [])
        assert.deepEqual(findTraceShapeGaps([null, undefined]), [])
    })
})
