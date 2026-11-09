/**
 * @fileOverview 过程分段（segments）的离线单测
 * @module test/services/core/segments
 * @description
 * PR-B 第一块的判据：**被 reset 抹掉的中间内容必须留得下来，而且留下的东西不能把库撑爆**。
 * 所以这里穷举三件事：服务端给的 `kind/category/title/metrics` 形态稳定；
 * 截断只影响 `text`、不影响 `metrics.chars`；超限丢段必须留下"丢过"的痕迹。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {
    SEGMENT_KINDS,
    SEGMENT_CATEGORIES,
    DEFAULT_SEGMENT_TEXT_CHARS,
    DEFAULT_MAX_SEGMENTS,
    segmentTitle,
    segmentCategory,
    sealSegment,
    BODY_IN_ANSWER,
    fitSegments,
    fitSegmentsVolume,
    createSegmentLedger,
} from '../../../services/core/segments.js'

/* ========================= 标题与大类 ========================= */

test('segmentTitle：服务端给成人读的标题，工具数量与名字都要进去', () => {
    assert.equal(segmentTitle(SEGMENT_KINDS.TOOL_ROUND, ['search_web', 'get_current_datetime']),
        '调用 2 个工具：search_web、get_current_datetime')
    assert.equal(segmentTitle(SEGMENT_KINDS.TOOL_ROUND, []), '调用工具')
    assert.equal(segmentTitle(SEGMENT_KINDS.TOOL_ROUND, [{name: 'run_code'}]), '调用 1 个工具：run_code', '也接受工具调用对象形态')
    assert.equal(segmentTitle(SEGMENT_KINDS.SKILL_RELOAD, [], 'thesis'), '加载技能「thesis」后重新回答')
    assert.equal(segmentTitle(SEGMENT_KINDS.FINALIZE), '工具次数用尽，补一次无工具收尾')
    assert.equal(segmentTitle(SEGMENT_KINDS.ANSWER), '最终回答')
    assert.equal(segmentTitle('weird-kind', [], '备注'), '备注', '未知 kind 不炸，用附加信息兜底')
    assert.equal(segmentTitle('weird-kind'), '过程片段')
})

test('segmentCategory：kind 可以细化，渲染大类保持稳定', () => {
    assert.equal(segmentCategory(SEGMENT_KINDS.TOOL_ROUND), SEGMENT_CATEGORIES.TOOLS)
    assert.equal(segmentCategory(SEGMENT_KINDS.SKILL_RELOAD), SEGMENT_CATEGORIES.SKILL)
    assert.equal(segmentCategory(SEGMENT_KINDS.FINALIZE), SEGMENT_CATEGORIES.TEXT)
    assert.equal(segmentCategory(SEGMENT_KINDS.ANSWER), SEGMENT_CATEGORIES.TEXT)
    assert.equal(segmentCategory(undefined), SEGMENT_CATEGORIES.TEXT, '未知 kind 归到文本而不是崩')
    assert.deepEqual(Object.values(SEGMENT_CATEGORIES), ['tools', 'skill', 'text'])
})

/* ========================= 单段封存 ========================= */

test('sealSegment：形态字段齐全，前端不需要推断任何东西', () => {
    const s = sealSegment({seq: 2, kind: SEGMENT_KINDS.TOOL_ROUND, text: '我先查一下', tools: ['search_web'], startedAt: 1000, now: 3400})
    assert.deepEqual(Object.keys(s).sort(), ['category', 'kind', 'metrics', 'ref', 'seq', 'text', 'title', 'tools', 'truncated'])
    assert.equal(s.seq, 2)
    assert.equal(s.title, '调用 1 个工具：search_web')
    assert.equal(s.text, '我先查一下')
    assert.equal(s.ref, null, '被抹掉的段自带正文，不指向别处')
    assert.deepEqual(s.metrics, {chars: 5, toolCount: 1, ms: 2400})
    assert.equal(s.truncated, false)
})

test('sealSegment：answer 与 finalize 都不重复存正文，只留计数与指针', () => {
    /** 一轮 finalize 实测 610 字：它的输出就是最终答案，段里再存一份就是同一篇文章占两处 */
    for (const kind of [SEGMENT_KINDS.ANSWER, SEGMENT_KINDS.FINALIZE]) {
        const s = sealSegment({kind, text: '最终答案全文', tools: kind === SEGMENT_KINDS.FINALIZE ? [] : undefined})
        assert.equal(s.text, '', kind)
        assert.equal(s.ref, 'answer', `${kind} 要告诉读的人去哪儿找全文`)
        assert.equal(s.metrics.chars, '最终答案全文'.length, '全文在 message.answer 里，这里只留量')
        assert.equal(s.truncated, false, `${kind} 没存正文，不该报截断`)
    }
    assert.deepEqual(BODY_IN_ANSWER, [SEGMENT_KINDS.ANSWER, SEGMENT_KINDS.FINALIZE])
})

test('fitSegmentsVolume：不存正文的段不会被误标成截断', () => {
    const segs = [
        {seq: 1, kind: SEGMENT_KINDS.TOOL_ROUND, text: 'x'.repeat(400), metrics: {chars: 400}, truncated: false},
        {seq: 2, kind: SEGMENT_KINDS.ANSWER, text: '', metrics: {chars: 900}, truncated: false},
    ]
    const kept = fitSegmentsVolume(segs, 100)
    assert.equal(kept[0].text.length, 50)
    assert.equal(kept[0].truncated, true)
    assert.equal(kept[1].text, '')
    assert.equal(kept[1].truncated, false, 'answer 段的 text 是有意为空的，报截断就是假警报')
})

test('sealSegment：截断只改 text，metrics.chars 仍是原文真实长度', () => {
    const long = '字'.repeat(DEFAULT_SEGMENT_TEXT_CHARS + 300)
    const s = sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: long, textChars: DEFAULT_SEGMENT_TEXT_CHARS})
    assert.equal(s.text.length, DEFAULT_SEGMENT_TEXT_CHARS)
    assert.equal(s.metrics.chars, long.length, '有多长这个事实不能被截断污染')
    assert.equal(s.truncated, true)
})

test('sealSegment：answer 段不重复存正文，只留计数与指针', () => {
    const s = sealSegment({kind: SEGMENT_KINDS.ANSWER, text: '最终答案全文'})
    assert.equal(s.text, '')
    assert.equal(s.metrics.chars, '最终答案全文'.length, '全文在 message.answer 里，这里只留量')
})

test('sealSegment：脏输入不炸', () => {
    assert.equal(sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: null}).text, '')
    assert.equal(sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: undefined, tools: null}).metrics.toolCount, 0)
    assert.equal(sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: {a: 1}}).text, '{"a":1}')
    assert.equal(sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'x', startedAt: 5000, now: 1000}).metrics.ms, 0, '时钟回拨不该给出负数耗时')
    assert.equal(sealSegment({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'x', textChars: 0}).text, 'x', '预算给 0 视为未配置，用默认值')
})

/* ========================= 收敛策略 ========================= */

test('fitSegments：未超限原样保留，不产生 dropped', () => {
    const segs = [1, 2, 3].map(seq => ({seq, metrics: {chars: 10}}))
    assert.deepEqual(fitSegments(segs, 8), {segments: segs, dropped: {count: 0, chars: 0}})
})

test('fitSegments：超限时丢最早的段，并累计丢了多少字', () => {
    const segs = Array.from({length: 5}, (unused, i) => ({seq: i + 1, metrics: {chars: (i + 1) * 100}}))
    const r = fitSegments(segs, 3)
    assert.deepEqual(r.segments.map(s => s.seq), [3, 4, 5], '保留最近的三段')
    assert.deepEqual(r.dropped, {count: 2, chars: 300})
})

test('fitSegments：空输入与非法上限都不炸', () => {
    assert.deepEqual(fitSegments([], 3), {segments: [], dropped: {count: 0, chars: 0}})
    assert.deepEqual(fitSegments(undefined, 3).segments, [])
    assert.equal(fitSegments([{seq: 1, metrics: {chars: 5}}], 0).segments.length, 1, '上限给 0 视为未配置')
})

test('fitSegmentsVolume：总量超预算时逐段均摊收缩，而不是丢整段', () => {
    const segs = [1, 2, 3, 4].map(seq => ({seq, kind: 'tool-round', text: 'x'.repeat(100), metrics: {chars: 100}}))
    const kept = fitSegmentsVolume(segs, 200)
    assert.equal(kept.length, 4, '一段都没丢')
    assert.ok(kept.every(s => s.text.length <= 50), '每段收缩到均摊额度')
    assert.ok(kept.every(s => s.metrics.chars === 100), '原文长度仍是 100')
    assert.ok(kept.every(s => s.truncated === true), '收缩要声明出来')
})

test('fitSegmentsVolume：入参不被修改', () => {
    const segs = [{seq: 1, text: 'x'.repeat(100), metrics: {chars: 100}}]
    const before = JSON.stringify(segs)
    fitSegmentsVolume(segs, 10)
    assert.equal(JSON.stringify(segs), before)
})

/* ========================= 账本 ========================= */

test('账本：seq 连续递增，即使发生过丢段也不回号', () => {
    const ledger = createSegmentLedger({maxSegments: 3})
    for (let i = 0; i < 5; i++) {
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: `第${i + 1}段`})
    }
    const list = ledger.list()
    assert.equal(list.length, 3, '只留最近三段')
    assert.deepEqual(list.map(s => s.seq), [3, 4, 5], '序号是全局轮次号，不是数组下标')
    const summary = ledger.summary()
    assert.deepEqual(summary.dropped, {count: 2, chars: 6}, '丢过东西必须说出来')
    assert.equal(summary.processChars, '第1段第2段第3段第4段第5段'.length, '留存 + 丢弃 = 全部真实过程字数')
})

test('账本：默认预算够用（dev 观测最多 6 段），不会误伤正常轮次', () => {
    const ledger = createSegmentLedger()
    for (let i = 0; i < 6; i++) {
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'a'.repeat(300), tools: ['search_web']})
    }
    assert.equal(ledger.list().length, 6)
    assert.deepEqual(ledger.summary().dropped, {count: 0, chars: 0})
    assert.ok(ledger.list().every(s => s.text.length === 300), '单段 300 字远未到截断线')
})

test('账本：默认段数上限是 8，与 dev 观测的 6 段留有余量', () => {
    assert.equal(DEFAULT_MAX_SEGMENTS, 8)
    const ledger = createSegmentLedger()
    for (let i = 0; i < 10; i++) {
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'x'})
    }
    assert.equal(ledger.list().length, 8)
    assert.equal(ledger.summary().dropped.count, 2)
})

test('账本：同一篇最终正文有两段时，摘要只计一次（不虚高）', () => {
    const ledger = createSegmentLedger()
    ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: '我先查一下', tools: ['search_web'], startedAt: 0, now: 1200})
    ledger.seal({kind: SEGMENT_KINDS.FINALIZE, text: '收尾调用的输出', startedAt: 1200, now: 9000})
    ledger.seal({kind: SEGMENT_KINDS.ANSWER, text: '收尾调用的输出', startedAt: 9000, now: 9001})

    assert.equal(ledger.list().length, 3, '三段都在：过程、收尾调用、最终答案各有各的意义')
    /** 过程字数只算被 reset 抹掉的那些段：finalize/answer 的全文已经在 message.answer 里，重复计就说不清这是什么数 */
    assert.equal(ledger.summary().processChars, '我先查一下'.length)
    assert.deepEqual(ledger.summary().dropped, {count: 0, chars: 0})
    /** has() 给后续 PR-C/D 判断"这一轮走到哪一步"用 */
    assert.equal(ledger.has(SEGMENT_KINDS.FINALIZE), true)
    assert.equal(ledger.has(SEGMENT_KINDS.SKILL_RELOAD), false)
})

test('账本：收尾调用没产出而走了兜底时，answer 段不混进过程字数', () => {
    const ledger = createSegmentLedger()
    const notice = '（本轮工具调用达到上限……）'
    ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: '第一段', tools: ['search_web']})
    ledger.seal({kind: SEGMENT_KINDS.FINALIZE, text: ''})
    ledger.seal({kind: SEGMENT_KINDS.ANSWER, text: '第一段' + notice})
    /** 兜底时"部分正文 + 原因"同时出现在过程段与 answer 里 ⇒ 过程字数只算过程段，避免重复计数 */
    assert.equal(ledger.summary().processChars, '第一段'.length)
})

test('账本：正常收尾（没补调用）只有 tool-round + answer 两段', () => {
    const ledger = createSegmentLedger()
    ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: '先说一句', tools: ['search_web']})
    ledger.seal({kind: SEGMENT_KINDS.ANSWER, text: '这是结论', startedAt: 1000, now: 1500})
    assert.deepEqual(ledger.list().map(s => s.kind), ['tool-round', 'answer'])
    assert.equal(ledger.list()[1].text, '', 'answer 段全文在 message.answer 里')
    assert.equal(ledger.list()[1].metrics.ms, 500)
    assert.equal(ledger.summary().processChars, '先说一句'.length, 'answer 段不计入过程字数')
})
