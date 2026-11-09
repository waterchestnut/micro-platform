/**
 * @fileOverview 主循环的流式消费与迭代决策测试（假 stream 注入，不联网）
 * @module test/services/core/llmLoopStream
 * @description
 * 这是 PR-0.1 的第二增量，也是 §26 G-2 的门：`execChat` 的**循环级**行为第一次可离线验证。
 * 上半部分直接测 `drainAssistantStream` 与两个决策函数；下半部分用一个
 * `simLoop` 复刻 `llmChat.js` 主循环的控制流，从而**在没有模型、没有数据库、没有工具的情况下**
 * 复现 §2E-3 的空答案缺陷——它此前只能靠真实打一次 6 轮搜索才能看见。
 *
 * 维护约定：`simLoop` 与 `llmChat.js` 的控制流必须同步改。
 * 改主循环时如果没让这里的用例变红，说明两边行为已经分叉，测试网就失效了。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {
    drainAssistantStream,
    iterationDecision,
    loopExitReason,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    resolveMaxIterations,
    finalizationDecision,
    buildFinalizeBody,
    exhaustedFallback,
    DEFAULT_MAX_ITERATIONS,
    MAX_ITERATIONS_CEILING,
    EXHAUSTED_NOTICE_TEXT,
    FINALIZE_HINT_TEXT,
} from '../../../services/core/llmLoop.js'

/* ---------- 构造假 chunk 的小工具（形态取自 OpenAI 兼容层的真实响应） ---------- */

const chunkOf = (delta, finish = null) => ({choices: [{index: 0, delta, finish_reason: finish}], usage: null})
const textChunk = (t) => chunkOf({content: t})
const reasonChunk = (t) => chunkOf({reasoning_content: t})
const usageChunk = (finish = 'stop') => ({choices: [], usage: {total_tokens: 7}})
const finishChunk = (finish = 'stop') => chunkOf({}, finish)
const toolChunk = (index, id, name, args) => chunkOf({tool_calls: [{index, id, function: {name, arguments: args}}]})
/** 只作为 async generator 提供，验证与数组形态等价（真实 chatStream 是可迭代对象） */
async function* asStream(chunks) {
    for (const c of chunks) {
        yield c
    }
}

/* ========================= drainAssistantStream ========================= */

test('drainAssistantStream：纯文本逐段累加，finishReason 取最后一个非空值', async () => {
    const r = await drainAssistantStream([textChunk('你'), textChunk('好'), finishChunk('stop')])
    assert.equal(r.content, '你好')
    assert.equal(r.reasoning, '')
    assert.equal(r.finishReason, 'stop')
    assert.equal(r.receivedToolCall, false)
    assert.equal(r.toolCalls.length, 0)
    assert.equal(r.deltaCount, 2, '只有含正文/推理的帧才算 delta')
    assert.equal(r.chunkCount, 3, '所有帧都被看过')
})

test('drainAssistantStream：reasoning_content 单独成帧也不计入正文', async () => {
    const r = await drainAssistantStream([reasonChunk('先想想'), textChunk('答案'), usageChunk()])
    assert.equal(r.content, '答案')
    assert.equal(r.reasoning, '先想想')
    assert.equal(r.deltaCount, 2)
    assert.equal(r.chunkCount, 3, '末帧 usage 也算看过')
})

test('drainAssistantStream：async generator 与数组形态结果一致', async () => {
    const chunks = [reasonChunk('r'), textChunk('a'), toolChunk(0, 'c1', 'search_web', '{"q":1}'), finishChunk('tool_calls')]
    const fromArray = await drainAssistantStream(chunks)
    const fromStream = await drainAssistantStream(asStream(chunks))
    assert.deepEqual(fromStream, fromArray)
    assert.equal(fromStream.receivedToolCall, true)
})

test('drainAssistantStream：末帧 choices 为空数组时跳过而不报错', async () => {
    const r = await drainAssistantStream([textChunk('x'), usageChunk()])
    assert.equal(r.content, 'x')
})

test('drainAssistantStream：chunk 缺 choices 会抛错（钉住现状，PR-A 的 try/catch 才处理它）', async () => {
    await assert.rejects(
        () => drainAssistantStream([{id: 'no-choices'}]),
        /Cannot read properties of undefined/,
        '抽取前 `chunk.choices[0]` 就是这个形态，且 execChat 外层没有 try/catch ⇒ 异常直接冒到上层'
    )
})

test('drainAssistantStream：tool_calls 为空数组也算 receivedToolCall（现状，会造成空转退出）', async () => {
    const r = await drainAssistantStream([chunkOf({content: '嗯', tool_calls: []})])
    assert.equal(r.receivedToolCall, true, '判定看的是字段是否存在，不是数组是否非空')
    assert.equal(r.toolCalls.length, 0)
    assert.equal(r.content, '嗯')
})

test('drainAssistantStream：reasoning 与正文交错时两段各归各位', async () => {
    const r = await drainAssistantStream([
        reasonChunk('甲'), textChunk('A'), reasonChunk('乙'), textChunk('B'), finishChunk('stop'),
    ])
    assert.equal(r.content, 'AB')
    assert.equal(r.reasoning, '甲乙')
})

/* ========================= onDelta 回调 ========================= */

test('onDelta：每帧一次，且收到的是原始 delta（未知键不丢）', async () => {
    const seen = []
    await drainAssistantStream([
        textChunk('一'),
        chunkOf({content: '二', tool_calls: [{index: 0, id: 'c', function: {name: 'f', arguments: '{}'}}], unknown_key: 42}),
        reasonChunk('三'),
        usageChunk(),
    ], {onDelta: (delta) => seen.push(delta)})

    assert.equal(seen.length, 3, '含正文或推理的帧才回调，末帧 usage 不回调')
    assert.equal(seen[0].content, '一')
    assert.equal(seen[1].unknown_key, 42, '抽取前 SSE 载荷是 {...delta} 展开，因此额外键必须原样保留')
    assert.equal(seen[1].tool_calls.length, 1)
    assert.equal(seen[2].reasoning_content, '三')
    assert.equal(seen[2].content, undefined)
})

test('onDelta：先累加再回调，snapshot 只含基元值（不暴露可变引用）', async () => {
    const snaps = []
    const r = await drainAssistantStream([
        textChunk('a'),
        toolChunk(0, 'c1', 'search_', ''),
        chunkOf({content: 'b', tool_calls: [{index: 0, function: {name: 'web', arguments: '{}'}}]}),
    ], {onDelta: (delta, snap) => snaps.push({...snap})})

    /** 顺序规则（与抽取前逐字一致）：`answerContent += delta.content` 在前、streamCallback 在后，
     *  而 tool_calls 的并入在 onDelta **之后**（同一帧内），所以本帧的工具增量看不到、上一帧的看得到 */
    assert.deepEqual(snaps[0], {content: 'a', reasoning: '', toolCallCount: 0})
    assert.deepEqual(snaps[1], {content: 'ab', reasoning: '', toolCallCount: 1}, '本帧 content 已计入，本帧 tool_calls 尚未计入')
    assert.equal(r.toolCalls[0].function.name, 'search_web', '名字跨帧拼出来的结果只在返回值里给')
    assert.ok(!('toolCalls' in snaps[1]), 'snapshot 不给可变数组引用，避免"当时的值"其实是"最后的值"')
})

test('onDelta：回调可以是 async，消费顺序严格跟流（假流背压场景）', async () => {
    const order = []
    await drainAssistantStream(asStream([textChunk('1'), textChunk('2'), textChunk('3')]), {
        onDelta: async (delta) => {
            await new Promise(r => setImmediate(r))
            order.push(delta.content)
        },
    })
    assert.deepEqual(order, ['1', '2', '3'], 'SSE 事件顺序不能因为 await 而乱')
})

test('onDelta：回调抛错时向上冒泡（与抽取前一致，PR-A 之后才由 try/catch 兜住）', async () => {
    await assert.rejects(
        () => drainAssistantStream([textChunk('x')], {onDelta: () => { throw new Error('sink down') }}),
        /sink down/
    )
})

/* ========================= iterationDecision ========================= */

const SKILL = {name: 'thesis', prompt: 'p', tools: []}

test('iterationDecision：判定表与抽取前的两条 if 完全一致', () => {
    const cases = [
        /** [state, expected] */
        [{receivedToolCall: true, rawToolCallCount: 1, answerContent: '', skillContext: null}, 'tool-round', '正常工具轮'],
        [{receivedToolCall: true, rawToolCallCount: 1, answerContent: '半句', skillContext: SKILL}, 'tool-round', '工具优先，半句正文交给下一段（现状）'],
        [{receivedToolCall: true, rawToolCallCount: 0, answerContent: '嗯', skillContext: SKILL}, 'final', 'tool_calls:[] 的空转帧不再查技能'],
        [{receivedToolCall: false, rawToolCallCount: 0, answerContent: '我选技能A', skillContext: SKILL}, 'skill-check', '有正文且有技能上下文'],
        [{receivedToolCall: false, rawToolCallCount: 0, answerContent: '答案', skillContext: null}, 'final', '没有技能上下文直接收尾'],
        [{receivedToolCall: false, rawToolCallCount: 0, answerContent: '', skillContext: SKILL}, 'final', '空正文不查技能（抽取前就是 && answerContent）'],
        [{}, 'final', '全缺省'],
    ]
    for (const [state, expected, note] of cases) {
        assert.equal(iterationDecision(state), expected, note)
    }
})

test('iterationDecision：skill-check 与 tool-round 互斥，不会同时命中', () => {
    for (const rc of [true, false]) {
        const hit = [0, 1, 3].flatMap(n => ['', '正文'].flatMap(a => [SKILL, null].map(s =>
            iterationDecision({receivedToolCall: rc, rawToolCallCount: n, answerContent: a, skillContext: s}))))
        assert.ok(!(hit.includes('skill-check') && hit.includes('tool-round')), `${rc} 时两种分支不该都能出现`)
    }
})

/* ========================= loopExitReason ========================= */

test('loopExitReason：区分 break、被上限掐断、以及循环根本没跑', () => {
    assert.equal(loopExitReason({broke: true, iterationCount: 3, maxIterations: 6}), 'break')
    assert.equal(loopExitReason({broke: false, iterationCount: 6, maxIterations: 6}), 'exhausted')
    assert.equal(loopExitReason({broke: false, iterationCount: 0, maxIterations: 0}), 'no-iterations')
    assert.equal(loopExitReason({broke: false, iterationCount: 6, maxIterations: 7}), 'unknown', '既没 break 也没打满 ⇒ 理论上不可达，留个值让误用现形')
})

test('loopExitReason：broke 优先，异常路径不会把正常收尾误报成打满', () => {
    assert.equal(loopExitReason({broke: true, iterationCount: 6, maxIterations: 6}), 'break')
})

/* ========================= 循环级仿真：simLoop ========================= */

/**
 * @description 复刻 llmChat.js 主循环的控制流（不含 IO：不建 OpenAI 客户端、不落库、不跑真工具）
 * @param {Object} cfg
 * @param {Array<Array<Object>>} cfg.rounds 每轮一个假 stream
 * @param {Number} [cfg.maxIterations] 迭代上限（配置缺省 6）
 * @param {Object} [cfg.skillContext] 技能上下文
 * @param {Function} [cfg.skillSelect] 仿 skillChat.checkSkillSelection
 * @param {Function} [cfg.runTools] 仿工具执行，返回 [{tool_call_id, tool, content}]
 * @param {'ok'|'empty'|'throw'|'disabled'} [cfg.finalize] 仿"无工具收尾调用"的四种结果，默认 'ok'
 * @param {String} [cfg.finalizeText] 收尾调用产出的正文，默认一段可断言的文本
 * @returns {Promise<Object>} 与线上一致的可观测量：落库 answer/progress、事件序列、退出方式
 */
async function simLoop({rounds, maxIterations = 6, skillContext = null, skillSelect = null, runTools = null, finalize = 'ok', finalizeText = '（基于已取回结果的收尾结论）'}) {
    const events = []
    const messages = []
    const toolCallTrace = []
    const answerList = []
    const queue = [...rounds]
    let answerContent = ''
    let answerReasoning = ''
    let iterationCount = 0
    let loopBroke = false
    let toolRounds = 0
    let skillReloads = 0

    const emitReset = () => {
        events.push({type: 'reset'})
        answerContent = ''
    }

    while (iterationCount < maxIterations) {
        if (iterationCount >= rounds.length) {
            /** 线上这里是再发一次请求；测试里"轮数用尽"就是配置错误，必须响 */
            throw new Error(`假流只准备了 ${rounds.length} 轮，第 ${iterationCount + 1} 轮无从可取`)
        }
        iterationCount++
        const drained = await drainAssistantStream(queue.shift(), {
            onDelta: (delta) => events.push({type: 'delta', content: delta.content || '', reasoning: delta.reasoning_content || ''}),
        })
        answerContent += drained.content
        answerReasoning += drained.reasoning
        let toolCalls = drained.toolCalls

        const decision = iterationDecision({
            receivedToolCall: drained.receivedToolCall,
            rawToolCallCount: toolCalls.length,
            answerContent,
            skillContext,
        })

        if (decision === 'skill-check') {
            const selected = skillSelect ? skillSelect(answerContent, skillContext) : null
            if (selected) {
                messages.push({role: 'system', content: selected.prompt})
                if (answerContent) answerList.push(answerContent)
                skillReloads++
                emitReset()
                continue
            }
        }

        if (decision === 'tool-round') {
            toolCalls = pruneToolCalls(toolCalls)
            if (toolCalls.length > 0) {
                messages.push(buildAssistantToolCallMessage(toolCalls))
                const results = runTools
                    ? runTools(toolCalls)
                    : toolCalls.map(tc => ({tool_call_id: tc.id, tool: tc.function.name, content: 'result'}))
                for (const r of results) {
                    messages.push({role: 'tool', tool_call_id: r.tool_call_id, content: r.content})
                    toolCallTrace.push({id: r.tool_call_id, name: r.tool, result: r.content})
                    events.push({type: 'tool_result', id: r.tool_call_id})
                }
                toolRounds++
                if (answerContent) answerList.push(answerContent)
                emitReset()
                continue
            }
        }

        loopBroke = true
        break
    }

    /** ↓↓↓ 以下三段与 llmChat.js 循环之后的处理逐字同构（§2E-3 修复）↓↓↓ */
    const exit = loopExitReason({broke: loopBroke, iterationCount, maxIterations})

    const fin = finalizationDecision({
        loopExit: exit,
        answerContent,
        finalizeDisabled: finalize === 'disabled',
    })
    let forcedFinal = false
    if (fin.action === 'force-final') {
        forcedFinal = true
        iterationCount++
        if (finalize === 'ok') {
            /** 收尾调用成功：正文照常流式下发 */
            events.push({type: 'delta', content: finalizeText, reasoning: ''})
            answerContent += finalizeText
        }
        /** 'empty' = 模型返回空正文；'throw' = 调用抛错被 execChat 吞掉：两者都不改 answerContent */
    }

    const fb = exhaustedFallback({loopExit: exit, answerContent, answerList})
    if (fb.notice) {
        /** 兜底文案也作为一段正文下发：否则客户端在 N 次 reset 之后什么都看不到 */
        events.push({type: 'delta', content: fb.notice, reasoning: '', notice: true})
        answerContent = fb.answer
    }

    return {
        answer: answerContent,
        answerList,
        answerReasoning,
        events,
        messages,
        toolCallTrace,
        iterationCount,
        toolRounds,
        skillReloads,
        resets: events.filter(e => e.type === 'reset').length,
        exit,
        finDecision: fin,
        forcedFinal,
        fallback: fb,
        /** 落库形态：progress 由 exhaustedFallback 决定，不再无条件 'finish' */
        persisted: {answer: fb.answer, progress: fb.progress, loopExit: exit, forcedFinal},
    }
}

/** 造一轮"要求调工具"的假响应；id 用自增计数，保证可复现（不用随机数） */
let callSeq = 0
const toolRound = (name, withText) => ([
    ...(withText ? [textChunk(withText)] : []),
    toolChunk(0, `call-${++callSeq}`, name, '{"a":1}'),
    finishChunk('tool_calls'),
])
const textRound = (t) => ([textChunk(t), finishChunk('stop')])
const toolRounds = (n, withText) => Array.from({length: n}, (unused, i) => toolRound(`t${i}`, withText ? `第${i + 1}段` : undefined))

/* ---------- 迭代上限与收尾补救的纯函数 ---------- */

test('resolveMaxIterations：请求 > 频道 > 全局 > 兜底，并钳到 1..20', () => {
    assert.equal(resolveMaxIterations({}), DEFAULT_MAX_ITERATIONS, '什么都不配就是 6，与抽取前一致')
    assert.equal(resolveMaxIterations({configValue: 10}), 10)
    assert.equal(resolveMaxIterations({configValue: 10, channelValue: 8}), 8, '频道盖过全局')
    assert.equal(resolveMaxIterations({configValue: 10, channelValue: 8, requestValue: 4}), 4, '请求盖过频道')
    assert.equal(resolveMaxIterations({requestValue: 999}), MAX_ITERATIONS_CEILING, '天花板不可突破')
    assert.equal(resolveMaxIterations({requestValue: 0, configValue: 12}), 12, '0 视为未配置（否则会一次工具都不许调）')
    assert.equal(resolveMaxIterations({requestValue: -3, configValue: 12}), 12)
    assert.equal(resolveMaxIterations({requestValue: '7'}), 7, '字符串数字要认（表单/环境变量常是字符串）')
    assert.equal(resolveMaxIterations({requestValue: 7.9}), 7, '向下取整')
    assert.equal(resolveMaxIterations({requestValue: 'abc', channelValue: null}), DEFAULT_MAX_ITERATIONS)
    assert.equal(resolveMaxIterations({fallback: 3}), 3)
})

test('finalizationDecision：只有 exhausted 且末段为空才补救', () => {
    assert.deepEqual(finalizationDecision({loopExit: 'break', answerContent: '答'}), {action: 'none', reason: 'normal-exit'})
    assert.deepEqual(finalizationDecision({loopExit: 'no-iterations', answerContent: ''}), {action: 'none', reason: 'normal-exit'})
    assert.deepEqual(finalizationDecision({loopExit: 'exhausted', answerContent: ''}), {action: 'force-final', reason: 'exhausted-empty'})
    assert.deepEqual(finalizationDecision({loopExit: 'exhausted', answerContent: '有正文'}), {action: 'none', reason: 'has-answer'})
    assert.deepEqual(finalizationDecision({loopExit: 'exhausted', answerContent: '', aborted: true}), {action: 'none', reason: 'aborted'})
    assert.deepEqual(finalizationDecision({loopExit: 'exhausted', answerContent: '', finalizeDisabled: true}), {action: 'none', reason: 'disabled'})
})

test('buildFinalizeBody：摘掉工具、追加提示，且不改动入参', () => {
    const createBody = {model: 'm', messages: [{role: 'user', content: 'q'}], tools: [{type: 'function'}], tool_choice: 'auto', max_tokens: 100, stream: true}
    const messages = [{role: 'user', content: 'q'}, {role: 'assistant', content: null, tool_calls: [{id: 'c'}]}]
    const body = buildFinalizeBody(createBody, messages)

    assert.equal(body.tools, undefined, '收尾调用不能还带工具，否则模型会继续调')
    assert.equal(body.tool_choice, undefined)
    assert.equal(body.stream, true, '仍然流式：用户要能看到结论逐字出来')
    assert.equal(body.max_tokens, 100, '其余参数原样继承')
    assert.equal(body.messages[body.messages.length - 1].content, FINALIZE_HINT_TEXT)
    assert.equal(messages.length, 2, '入参数组不能被改：它还要用于落库与检查点')
    assert.equal(createBody.messages.length, 1)
})

test('exhaustedFallback：非 exhausted 原样透传，exhausted 才给部分正文与 error', () => {
    assert.deepEqual(exhaustedFallback({loopExit: 'break', answerContent: '正常答案', answerList: ['a']}),
        {answer: '正常答案', progress: 'finish', usedPartial: false, notice: ''})
    assert.deepEqual(exhaustedFallback({loopExit: 'exhausted', answerContent: '补出来的结论', answerList: ['a']}),
        {answer: '补出来的结论', progress: 'finish', usedPartial: false, notice: ''}, '补救成功就用补救结果，不该再兜底')

    const withPartial = exhaustedFallback({loopExit: 'exhausted', answerContent: '', answerList: ['第一段', '第二段']})
    assert.equal(withPartial.progress, 'error')
    assert.equal(withPartial.usedPartial, true)
    assert.equal(withPartial.answer, '第一段第二段' + EXHAUSTED_NOTICE_TEXT)

    const empty = exhaustedFallback({loopExit: 'exhausted', answerContent: '', answerList: []})
    assert.equal(empty.progress, 'error')
    assert.equal(empty.answer, EXHAUSTED_NOTICE_TEXT)
    assert.equal(exhaustedFallback({loopExit: 'exhausted', answerContent: '', answerList: [null, '', undefined]}).usedPartial, false, '脏分段不算救回来')
})

/* ---------- 场景 ---------- */

test('场景：单轮纯文本正常收尾', async () => {
    const r = await simLoop({rounds: [textRound('你好，世界')]})
    assert.equal(r.exit, 'break')
    assert.equal(r.iterationCount, 1)
    assert.equal(r.resets, 0)
    assert.equal(r.answer, '你好，世界')
    assert.deepEqual(r.answerList, [])
    assert.equal(r.persisted.answer, r.answer, '正常路径落库的就是末段，没问题')
    assert.deepEqual(r.events.map(e => e.type), ['delta'])

    /** finish 帧的 delta 是空对象 ⇒ 不产生 SSE 事件（现状：末帧只带 finish_reason，不发空 delta） */
    assert.equal(r.events.filter(e => e.type === 'finish').length, 0)
})

test('场景：一轮工具后再回答，reset 把上一段推进 answerList', async () => {
    const r = await simLoop({rounds: [toolRound('search_web', '我先查一下'), textRound('查到了：结论是这样')]})
    assert.equal(r.exit, 'break')
    assert.equal(r.iterationCount, 2)
    assert.equal(r.toolRounds, 1)
    assert.equal(r.resets, 1)
    assert.deepEqual(r.answerList, ['我先查一下'], '半句话被留档在 answerList')
    assert.equal(r.answer, '查到了：结论是这样')
    assert.equal(r.messages[0].role, 'assistant', '仿真从空 messages 起步，只记本轮新推入的消息')
    assert.equal(r.messages[0].content, null, '工具调用消息的 content 必须是显式 null')
    assert.equal(r.messages[1].role, 'tool')
})

test('场景：§2E-3 修复前的形态可用 finalize=disabled 复现（回归锚点）', async () => {
    /** 关掉补救调用 ⇒ 行为回到 v1.14：末段为空、循环被上限掐断 */
    const r = await simLoop({rounds: toolRounds(6), finalize: 'disabled'})
    assert.equal(r.exit, 'exhausted')
    assert.equal(r.iterationCount, 6)
    assert.equal(r.toolRounds, 6)
    assert.equal(r.resets, 6)
    assert.equal(r.finDecision.action, 'none')
    assert.equal(r.finDecision.reason, 'disabled')
    assert.equal(r.forcedFinal, false)
    /** 修复后哪怕不补救，也不再记 finish：progress=error + 可读原因 */
    assert.equal(r.persisted.progress, 'error')
    assert.match(r.persisted.answer, /工具调用达到上限/)
})

test('场景：§2E-3 修复——上限打满时补一次无工具收尾调用，用户拿到结论而不是空白', async () => {
    const r = await simLoop({rounds: toolRounds(6)})
    assert.equal(r.exit, 'exhausted')
    assert.equal(r.finDecision.action, 'force-final')
    assert.equal(r.forcedFinal, true)
    assert.equal(r.persisted.progress, 'finish')
    assert.equal(r.persisted.answer, '（基于已取回结果的收尾结论）', '落库不再是空串')
    assert.equal(r.iterationCount, 7, '收尾调用也要计入迭代，成本可核对')
    /** 事件形态：6 段 reset 之后，客户端必须还能看到一段正文 */
    assert.equal(r.events.filter(e => e.type === 'delta' && e.content).length, 1)
})

test('场景：§2E-3 修复——收尾调用返回空正文时保住历史分段并记 error', async () => {
    const r = await simLoop({rounds: toolRounds(6, true), finalize: 'empty'})
    assert.equal(r.forcedFinal, true)
    assert.equal(r.persisted.progress, 'error', '空答案绝不记 finish')
    assert.equal(r.persisted.answer, '第1段第2段第3段第4段第5段第6段' + EXHAUSTED_NOTICE_TEXT)
    assert.equal(r.fallback.usedPartial, true, '被 reset 抹掉的 6 段正文要救回来')
})

test('场景：§2E-3 修复——收尾调用抛错时同样退化成 error，而不是整轮失败', async () => {
    const r = await simLoop({rounds: toolRounds(6), finalize: 'throw'})
    assert.equal(r.forcedFinal, true)
    assert.equal(r.persisted.progress, 'error')
    assert.equal(r.persisted.answer, EXHAUSTED_NOTICE_TEXT, '没有历史分段时只落原因')
})

test('场景：正常收尾不触发收尾调用、不改 progress', async () => {
    const r = await simLoop({rounds: [toolRound('search_web', '先说一句'), textRound('这是结论')]})
    assert.equal(r.exit, 'break')
    assert.equal(r.finDecision.action, 'none')
    assert.equal(r.finDecision.reason, 'normal-exit')
    assert.equal(r.forcedFinal, false)
    assert.equal(r.persisted.progress, 'finish')
    assert.equal(r.persisted.answer, '这是结论')
})

test('场景：maxIterations=0 时循环一次都不跑', async () => {
    const r = await simLoop({rounds: [textRound('不会被消费')], maxIterations: 0})
    assert.equal(r.exit, 'no-iterations')
    assert.equal(r.iterationCount, 0)
    assert.equal(r.answer, '')
    assert.deepEqual(r.events, [])
})

test('场景：假流轮数不够时测试自己报错，而不是悄悄少跑一轮', async () => {
    await assert.rejects(
        () => simLoop({rounds: [toolRound('a'), toolRound('b')], maxIterations: 6}),
        /假流只准备了 2 轮/
    )
})

test('场景：工具调用全是空壳时直接收尾，正文保留', async () => {
    /** tool_calls 增量没有 index ⇒ 聚合阶段就被丢弃（现状），prune 之后为空 */
    const r = await simLoop({
        rounds: [
            [chunkOf({content: '我想调用工具', tool_calls: [{function: {name: 'x', arguments: '{}'}}]}), finishChunk('tool_calls')],
            textRound('不该走到这里'),
        ],
    })
    assert.equal(r.exit, 'break', '空壳工具调用让本轮直接结束')
    assert.equal(r.iterationCount, 1)
    assert.equal(r.toolRounds, 0)
    assert.equal(r.answer, '我想调用工具')
    assert.equal(r.resets, 0)
})

test('场景：技能动态加载会多消耗一轮并 reset 一次', async () => {
    const r = await simLoop({
        rounds: [textRound('SKILL:thesis'), textRound('按技能写好的正文')],
        skillContext: {name: 'thesis', prompt: '技能详情', tools: []},
        skillSelect: (answer) => (answer.includes('SKILL:') ? {name: 'thesis', prompt: '技能详情', tools: []} : null),
    })
    assert.equal(r.skillReloads, 1)
    assert.equal(r.resets, 1)
    assert.equal(r.iterationCount, 2)
    assert.equal(r.exit, 'break')
    assert.equal(r.messages[0].role, 'system', '技能详情以 system 注入')
    assert.equal(r.answer, '按技能写好的正文')
})

test('场景：技能检测没选中时不额外耗轮次，也不 reset', async () => {
    const r = await simLoop({
        rounds: [textRound('普通回答')],
        skillContext: {name: 'thesis', prompt: 'p', tools: []},
        skillSelect: () => null,
    })
    assert.equal(r.skillReloads, 0)
    assert.equal(r.resets, 0)
    assert.equal(r.iterationCount, 1)
    assert.equal(r.exit, 'break')
})

test('场景：事件顺序——本段正文先发，工具结果次之，reset 最后', async () => {
    const r = await simLoop({rounds: [toolRound('search_web', '先说一句'), textRound('收尾')]})
    assert.deepEqual(r.events.map(e => e.type), ['delta', 'tool_result', 'reset', 'delta'])
})

test('场景：与 v1.6/v1.13 线上观测逐字对照（用 finalize=disabled 还原修复前的形态）', async () => {
    const names = ['get_current_datetime', 'search_web', 'search_web', 'search_web', 'search_web', 'search_web']
    const r = await simLoop({rounds: names.map(n => toolRound(n)), finalize: 'disabled'})
    assert.equal(r.resets, 6)
    assert.equal(r.events.filter(e => e.type === 'tool_result').length, 6)
    assert.equal(r.iterationCount, 6)
    /** 修复前：末段 0 字符 + progress finish；修复后同样条件下是 error + 原因文案（见上一条用例） */
    assert.equal(r.answerList.length, 0, '纯工具帧不产生分段')
    assert.match(r.persisted.answer, /工具调用达到上限/)

    /** v1.6 探针记录的是"实收 253~256 字符全被 reset 抹掉"，这里用 6 段各 3 字符复算 */
    const withText = await simLoop({rounds: toolRounds(6, true), finalize: 'disabled'})
    const recv = withText.events.filter(e => e.type === 'delta' && !e.notice).reduce((n, e) => n + e.content.length, 0)
    assert.equal(recv, 18, '6 段 × 3 字符，与"被 reset 抹掉字符数"同口径')
    /** 修复前这里是 `answer === ''`；修复后分段被救回来并附原因 */
    assert.equal(withText.fallback.usedPartial, true)
    assert.ok(withText.answer.startsWith('第1段第2段第3段第4段第5段第6段'), '历史分段不再丢失')
    assert.match(withText.answer, /工具调用达到上限/)
    assert.equal(withText.persisted.progress, 'error')
})
