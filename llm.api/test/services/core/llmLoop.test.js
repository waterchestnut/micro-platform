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
    describeError,
    createBudgetMeter,
    createEmptyUsage,
    normalizeUsage,
    addUsage,
    deriveUsageMetrics,
    usageCallAlert,
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

/* ========================= usage 归一与累加（§14 自有账本） ========================= */

test('normalizeUsage：按 OpenAI 兼容层的 details 取数，不反推', () => {
    const u = normalizeUsage({
        prompt_tokens: 3237, completion_tokens: 128, total_tokens: 3365,
        prompt_tokens_details: {cached_tokens: 3072},
        completion_tokens_details: {reasoning_tokens: 96},
    })
    assert.deepEqual(u, {promptTokens: 3237, completionTokens: 128, totalTokens: 3365, cachedTokens: 3072, reasoningTokens: 96, reported: true})
})

test('normalizeUsage：上游没回 usage 时 reported=false，绝不"猜 0 当成全命中"', () => {
    assert.equal(normalizeUsage(undefined).reported, false)
    assert.equal(normalizeUsage({}).cachedTokens, 0)
    const m = deriveUsageMetrics(normalizeUsage({}), 1)
    assert.equal(m.hasUsage, false)
    assert.equal(m.nonCachedRatio, null, '没有数据时比例必须是 null，不是 0')
})

test('normalizeUsage：负数与脏值按 0 计，snake_case 与 camel 两种字段名都认', () => {
    assert.equal(normalizeUsage({prompt_tokens: -5}).promptTokens, 0)
    assert.equal(normalizeUsage({input_tokens: 100, output_tokens: 20}).promptTokens, 100)
    assert.equal(normalizeUsage({cached_tokens: 64}).cachedTokens, 64, '少数网关把 cached 平铺在顶层')
    assert.equal(normalizeUsage({prompt_tokens: '123'}).promptTokens, 123)
})

test('addUsage：多轮累加（每 run 的量就是靠它合出来的）', () => {
    const a = normalizeUsage({prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: {cached_tokens: 512}})
    const b = normalizeUsage({prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, prompt_tokens_details: {cached_tokens: 1024}})
    const sum = addUsage(addUsage(createEmptyUsage(), a), b)
    assert.equal(sum.promptTokens, 2200)
    assert.equal(sum.cachedTokens, 1536)
    assert.equal(sum.totalTokens, 2330)
    assert.equal(sum.reasoningTokens, 0)
    assert.deepEqual(addUsage(null, null), {...createEmptyUsage(), reported: false}, '空值相加不炸')
})

test('deriveUsageMetrics：主指标是非缓存 token（D41），不是命中率', () => {
    const u = normalizeUsage({prompt_tokens: 3237, completion_tokens: 128, prompt_tokens_details: {cached_tokens: 3072}})
    const m = deriveUsageMetrics(u, 7)
    assert.equal(m.billablePromptTokens, 165)
    assert.equal(m.cacheReadTokens, 3072)
    assert.equal(m.nonCachedRatio, Number((165 / 3237).toFixed(4)))
    assert.equal(m.modelCalls, 7)
    assert.equal(m.hasUsage, true)
})

test('deriveUsageMetrics：cached 大于 prompt 的异常回传不折成负数', () => {
    const u = normalizeUsage({prompt_tokens: 100, prompt_tokens_details: {cached_tokens: 500}})
    assert.equal(deriveUsageMetrics(u, 1).billablePromptTokens, 0)
})

test('usageCallAlert：打满但正常收尾不该告警，超出上限才报', () => {
    /** 6 次调用 + 正常 break = "这轮活多"，不是"在打循环"。报它就是把告警做成噪声 */
    assert.equal(usageCallAlert({modelCalls: 6, maxIterations: 6}).level, 'ok')
    assert.equal(usageCallAlert({modelCalls: 7, maxIterations: 6}).level, 'warn', '需要额外补收尾（超出上限）才是信号')
    assert.equal(usageCallAlert({modelCalls: 8, maxIterations: 6, hardAt: 8}).level, 'critical')
    assert.equal(usageCallAlert({modelCalls: 3, maxIterations: 6}).level, 'ok')
    const t = usageCallAlert({modelCalls: 1, maxIterations: 6})
    assert.equal(t.warnAt, 6, '默认阈值就是上限，且要把阈值本身回传，日志里才说得清为什么没报')
    assert.equal(usageCallAlert({modelCalls: 3, maxIterations: 6, warnAt: 2}).overWarn, true, '阈值可显式压低')
})

/* ========================= createBudgetMeter（PR-K1 增量测量） ========================= */

test('createBudgetMeter：增量结果与全量重算严格相等（可加性是前提）', () => {
    /** measureOne 用与线上一致的口径：calcMessagesTokenCount 就是逐条 reduce，所以和必然等于整体 */
    const measureOne = (m) => 1 + String(m.content || '').length
    const messages = []
    const meter = createBudgetMeter({measureOne})

    let expect = 0
    for (let i = 0; i < 6; i++) {
        messages.push({role: i % 2 ? 'tool' : 'user', content: 'x'.repeat(i)})
        expect += measureOne(messages[i])
        assert.equal(meter.check(messages), expect, `第 ${i + 1} 次测量的总量`)
    }
    const full = messages.reduce((sum, m) => sum + measureOne(m), 0)
    assert.equal(meter.total(), full, '增量累计值必须等于全量重算，否则这条优化就是错的')
})

test('createBudgetMeter：只在首帧全量，后续都是增量（省掉的就是 O(n²)）', () => {
    const measureOne = (m) => String(m.content || '').length
    const messages = []
    const meter = createBudgetMeter({measureOne})
    for (let i = 0; i < 10; i++) {
        messages.push({role: 'tool', content: 'ab' + i})
        meter.check(messages)
    }
    const {fullPasses, deltaPasses} = meter.stats()
    assert.equal(fullPasses, 1, '只有第一次测量是全量')
    assert.equal(deltaPasses, 9, '剩下 9 次都只测新增的那一条')
    assert.equal(fullPasses + deltaPasses, 10, '10 次测量、1 次全量')
})

test('createBudgetMeter：invalidate 后强制全量重算（就地改写消息必须走这条路）', () => {
    const measureOne = (m) => String(m.content || '').length
    const messages = [{role: 'tool', content: 'aaaa'}, {role: 'tool', content: 'bbbb'}]
    const meter = createBudgetMeter({measureOne})
    assert.equal(meter.check(messages), 8)

    /** compactToBudget 式的就地改写：长度变了，但数组没增没减，增量看不到 */
    messages[0].content = 'x'
    meter.invalidate()
    assert.equal(meter.check(messages), 5, 'invalidate 之后要重算')
    assert.equal(meter.stats().fullPasses, 2)
})

test('createBudgetMeter：isRewritten 钩子能自动发现历史被改写', () => {
    const measureOne = (m) => String(m.content || '').length
    const messages = [{role: 'tool', content: 'aaaa'}]
    let seen = ''
    const meter = createBudgetMeter({
        measureOne,
        isRewritten: (list) => {
            const changed = list[0]?.content !== seen
            seen = list[0]?.content
            return changed
        },
    })
    meter.check(messages)
    messages[0].content = 'zz'
    meter.check(messages)
    assert.equal(meter.stats().fullPasses, 2, '改写触发了全量重算，而不是继续用脏的累计值')
})

test('createBudgetMeter：数组变短（重新装配或压缩丢弃）时回到全量', () => {
    const measureOne = (m) => String(m.content || '').length
    const messages = [{role: 'tool', content: 'aaaa'}, {role: 'tool', content: 'bbbb'}, {role: 'tool', content: 'cccc'}]
    const meter = createBudgetMeter({measureOne})
    meter.check(messages)
    messages.splice(1, 2)
    assert.equal(meter.check(messages), 4)
    assert.equal(meter.stats().fullPasses, 2)
})

test('createBudgetMeter：脏输入不炸，非数字测量按 0 计', () => {
    const meter = createBudgetMeter({measureOne: (m) => (m?.weird ? 5 : undefined)})
    assert.equal(meter.check(undefined), 0, '没有消息数组时给 0，不抛')
    assert.equal(meter.check([]), 0)
    assert.equal(meter.check([{weird: true}, {weird: true}]), 10, 'undefined 单条按 0 计，正常条目照常累加')
    assert.equal(meter.total(), 10)
})

test('createBudgetMeter 用真实 tokenizer 时也必须增量==全量（这条断了就说明可加性前提没了）', async () => {
    const {calcMessagesTokenCount} = await import('../../../services/openai/util.js')
    const measureOne = (m) => calcMessagesTokenCount([m], {})
    const messages = [{role: 'system', content: '你是助手'}, {role: 'user', content: '帮我查一下幂等性'}]
    const meter = createBudgetMeter({measureOne})
    assert.equal(meter.check(messages), calcMessagesTokenCount(messages, {}))

    for (let i = 0; i < 8; i++) {
        messages.push({role: 'assistant', content: null, tool_calls: [{id: `c${i}`, function: {name: 'search_web', arguments: '{"q":' + i + '}'}}]})
        messages.push({role: 'tool', tool_call_id: `c${i}`, content: `结果 ${i}：`.padEnd(60 + i * 37, '字')})
        /** 每一轮都拿全量重算当对照：只要有一次不等，就说明"逐条相加"的假设被破坏了 */
        assert.equal(meter.check(messages), calcMessagesTokenCount(messages, {}), `第 ${i + 1} 轮工具往返后`)
    }
    assert.equal(meter.stats().fullPasses, 1, '全程只该有一次全量')
})

/* ========================= describeError ========================= */

test('describeError：中断不是故障，但超时是故障', () => {
    const abort = Object.assign(new Error('The operation was aborted'), {name: 'AbortError'})
    assert.deepEqual(describeError(abort), {kind: 'abort', message: 'The operation was aborted', status: null})
    /** undici/fetch 与 SDK 的中断文本形态不一，但语义相同：连接被取消 */
    for (const msg of ['This connection was aborted', 'req aborted by client', 'The user turned the connection off']) {
        assert.equal(describeError(new Error(msg)).kind, 'abort', msg)
    }
    /** 超时必须归为故障：把它当 abort 会让"relay 挂了"看起来像"用户主动打断" */
    assert.equal(describeError(new Error('body timeout')).kind, 'api')
    assert.equal(describeError(Object.assign(new Error('timeout'), {name: 'TimeoutError'})).kind, 'api')
})

test('describeError：上游错误归到 api 并带 status', () => {
    const api = Object.assign(new Error('Request to relay failed'), {name: 'APIError', status: 500})
    assert.deepEqual(describeError(api), {kind: 'api', message: 'Request to relay failed', status: 500})
    assert.equal(describeError(Object.assign(new Error('no route'), {statusCode: 404})).status, 404)
    assert.equal(describeError(new TypeError('Cannot read properties of undefined')).kind, 'api')
})

test('describeError：非 Error 与空值不炸', () => {
    assert.equal(describeError('boom').kind, 'unknown')
    assert.equal(describeError('boom').message, 'boom')
    assert.equal(describeError(null).message, '未知错误')
    assert.equal(describeError(undefined).kind, 'unknown')
    assert.equal(describeError({}).kind, 'unknown', '既不是 Error 也没有 status/name ⇒ 无法归因，保守记 unknown')
})

test('describeError：过长消息截到 500 字符，避免整段响应体进库', () => {
    const long = Object.assign(new Error('x'.repeat(2000)), {name: 'APIError', status: 400})
    const d = describeError(long)
    assert.equal(d.message.length, 500)
    assert.equal(d.status, 400)
})
