/**
 * @fileOverview 上下文降级判据的用例（PR-K2 判据刀）
 * @module test/services/core/context/tiers
 * @description
 * 判据先于接线的刀，用例就是它全部的"现网"。最重的三条：
 * ①量不出≠安全（Infinity/缺失 budget 不许折算成 0 比值——D66 家族）；
 * ②约束存活（§17-14 的硬测法）：连续 N 次 clearing 后 system/user/assistant 逐字节不动，
 *   pinned constraint 可**逐字**恢复——这条靠"只碰 tool 消息"的结构性质，测试把它穷举出来；
 * ③clearing 幂等 + 无句柄不清：二次清空会把 marker 里的句柄也清掉，从此取不回原文，
 *   T3 就退化成丢信息——那是比不压缩更坏的结果。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/context/tiers.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const TIERS = await import(pathToFileURL(path.join(SRC, 'services/core/context/tiers.js')).href)
const {
    TIER_LEVELS, CLEARED_MARKER_PREFIX, contextPressureRatio, decideContextAction, clearToolResults,
    DIGEST_REQUIRED_SECTIONS, assertDigestFromRaw, extractIdentifiers, verifyIdentifiersPreserved,
    REFERENCE_ONLY_PREFIX, buildContextPressureEvent, buildContextCompactedEvent,
} = TIERS

describe('1 比值与决策表', () => {
    test('量不出 ⇒ null；Infinity/0/负数/非数都不折算成 0', () => {
        assert.equal(contextPressureRatio(1000, Infinity), null, '底座守卫给 Infinity：量不出不是"很安全"')
        assert.equal(contextPressureRatio(1000, 0), null)
        assert.equal(contextPressureRatio(1000, -5), null)
        assert.equal(contextPressureRatio(undefined, 200000), null)
        assert.equal(contextPressureRatio(NaN, 200000), null)
        assert.equal(contextPressureRatio(0, 200000), 0, '真的 0 是量得出的 0')
        assert.equal(contextPressureRatio(100000, 200000), 0.5)
    })
    test('档位顺序：none → pressure → clear → digest → overflow（默认全关时越界=overflow 如实上交）', () => {
        const base = {total: 1000, budget: 200000}
        assert.equal(decideContextAction(base).action, 'none')
        assert.equal(decideContextAction({...base, total: 170000}).action, 'pressure')
        assert.equal(decideContextAction({...base, total: 170000}).tierApplied, 'T1')
        assert.equal(decideContextAction({...base, total: 210000}).action, 'overflow', '默认关 ⇒ 越界不许静默改写任何东西')
        assert.equal(decideContextAction({...base, total: 210000, tiersConfig: {clearEnabled: true}}).action, 'clear')
        assert.equal(decideContextAction({...base, total: 210000, tiersConfig: {clearEnabled: true, digestEnabled: true}}).tierApplied, 'T3', 'T3 优先于 T4（无模型调用的层先走）')
        assert.equal(decideContextAction({...base, total: 210000, tiersConfig: {clearEnabled: true, digestEnabled: true}, clearExhausted: true}).action, 'digest', '声明"清无可清"⇒ 才轮到 T4')
        assert.equal(decideContextAction({...base, total: 210000, tiersConfig: {clearEnabled: true, digestEnabled: true}, clearExhausted: true}).action, 'digest')
        assert.equal(decideContextAction({...base, total: 210000, tiersConfig: {clearEnabled: true, digestEnabled: true}, clearExhausted: true, projectedTotalAfterClear: 150000}).action, 'none', 'clear 后预估回落 ⇒ 不再降级——pressure 线之下就是 none')
    })
    test('budget 量不出时决策 none（ Infinity 档不触任何层）', () => {
        assert.equal(decideContextAction({total: 999999, budget: Infinity}).action, 'none')
        assert.match(decideContextAction({total: 999999, budget: Infinity}).reason, /unmeasurable/)
    })
    test('pressureRatio 可配；越到线下就是 none', () => {
        assert.equal(decideContextAction({total: 100000, budget: 200000, tiersConfig: {pressureRatio: 0.4}}).action, 'pressure')
        assert.equal(decideContextAction({total: 100000, budget: 200000, tiersConfig: {pressureRatio: 0.99}}).action, 'none')
    })
})

describe('2 clearToolResults：只碰 tool、最近 N 保留、幂等、无句柄不清', () => {
    const mk = (n, from = 0) => Array.from({length: n}, (_, i) => ({
        role: 'tool', tool_call_id: `call_${from + i}`, content: 'x'.repeat(1000),
    }))
    test('结构性质：system/user/assistant 逐字节不动（约束存活的依据）', () => {
        const pinned = '禁止调用任何写操作工具'
        const msgs = [
            {role: 'system', content: 'sys'},
            {role: 'user', content: pinned},
            ...mk(6),
            {role: 'assistant', content: '我查了这些', tool_calls: [{id: 'call_0'}]},
            {role: 'user', content: '继续'},
        ]
        const {messages: out, cleared} = clearToolResults(msgs, {keepRecentN: 2})
        assert.equal(cleared.length, 4)
        for (const [i, orig] of msgs.entries()) {
            if (orig.role !== 'tool') assert.equal(out[i], orig, `第${i}条非 tool 消息被动过`)
        }
        const userIdx = msgs.findIndex((m) => m.role === 'user')
        assert.equal(out[userIdx].content, pinned, 'pinned constraint 必须逐字活着')
    })
    test('keepRecentN 兜底 + 边界值（N 大于等于 tool 数时一条都不清）', () => {
        const {cleared} = clearToolResults(mk(3), {keepRecentN: 3})
        assert.equal(cleared.length, 0)
        const {cleared: c2} = clearToolResults(mk(3), {keepRecentN: 10})
        assert.equal(c2.length, 0)
        assert.equal(clearToolResults(mk(3), {keepRecentN: 1}).cleared.length, 2)
    })
    test('幂等：二次 clearing 不动已带 marker 的（二次清空会连句柄一起清没）', () => {
        const once = clearToolResults(mk(5), {keepRecentN: 1})
        const twice = clearToolResults(once.messages, {keepRecentN: 1})
        assert.equal(twice.cleared.length, 0)
        assert.deepEqual(twice.messages, once.messages)
        const marker = once.messages.find((m) => String(m.content).startsWith(CLEARED_MARKER_PREFIX))
        assert.match(marker.content, /ref=call_0/, 'marker 里必须带句柄（清了取不回=T3 退化成丢信息）')
    })
    test('无句柄不清：refOf 给不出 ref 的条目跳过并计数（宁可不清也不清成孤儿）', () => {
        const orphans = [{role: 'tool', content: 'x'.repeat(100)}, {role: 'tool', content: 'y'.repeat(100)}]
        const r = clearToolResults(orphans, {keepRecentN: 0})
        assert.equal(r.cleared.length, 0)
        assert.equal(r.skippedNoRef, 2)
        assert.deepEqual(r.messages, orphans, '全跳过时内容原样（每条都未被改）')
    })
    test('API 形状守恒：清空只动 content，tool_call_id/role 原位（回给上游的消息不能变形）', () => {
        const {messages: out} = clearToolResults(mk(4), {keepRecentN: 1})
        out.forEach((m) => {
            assert.equal(m.role, 'tool')
            assert.ok(m.tool_call_id)
        })
    })
    test('连续 N 轮 clearing 的约束存活（§17-14 硬测法）', () => {
        const pinned = '本轮范围授权仅限只读'
        let msgs = [{role: 'system', content: 's'}, {role: 'user', content: pinned}]
        for (let round = 0; round < 12; round++) {
            msgs = [...msgs, ...mk(2, round * 2), {role: 'assistant', content: `第${round}轮`}, {role: 'user', content: `指令${round}`}]
            msgs = clearToolResults(msgs, {keepRecentN: 4}).messages
        }
        const still = msgs.filter((m) => m.role !== 'tool')
        assert.ok(still.some((m) => m.content === pinned), '12 轮降级后 pinned 逐字可恢复')
        assert.ok(still.some((m) => m.content === '指令11'), '最新用户指令同样活着（它会被清才怪）')
    })
})

describe('3 T4 三铁律的机器闸', () => {
    test('铁律一：digest 原料里混进 digest ⇒ 整单拒（滚动 digest 没有代码路径）', () => {
        assert.equal(assertDigestFromRaw([{kind: 'raw', text: 'a'}]).ok, true)
        assert.equal(assertDigestFromRaw([{kind: 'raw', text: 'a'}, {kind: 'digest', text: '上一版'}]).ok, false)
        assert.equal(assertDigestFromRaw([]).ok, false)
        assert.match(assertDigestFromRaw([{kind: 'digest', text: 'x'}]).error, /铁律一/)
    })
    test('铁律二：四段点名清单是常量（少一段的 prompt 在装配层就会被这条红拦住）', () => {
        assert.equal(DIGEST_REQUIRED_SECTIONS.length, 4)
        assert.ok(DIGEST_REQUIRED_SECTIONS.some((s) => s.includes('失败')))
    })
    test('铁律三：标识符逐字校验 + reference-only 前缀', () => {
        const raw = '见 https://api.example.com/v1/doc?id=42 与 数据\\报告_q3.pdf，参数 `max_tokens` 上限 60000'
        const ids = extractIdentifiers(raw)
        assert.ok(ids.includes('https://api.example.com/v1/doc?id=42'), JSON.stringify(ids))
        assert.ok(ids.some((x) => x.includes('报告')), '中文文件名也要提得住')
        assert.ok(ids.includes('max_tokens'), '反引号代码段是标识符')
        const ok = verifyIdentifiersPreserved([raw], '保留 https://api.example.com/v1/doc?id=42 与 数据\\报告_q3.pdf 和 max_tokens 的摘要')
        assert.equal(ok.ok, true)
        const bad = verifyIdentifiersPreserved([raw], '看了一个文档和一个 pdf')
        assert.equal(bad.ok, false)
        assert.ok(bad.missing.length >= 2)
        assert.match(REFERENCE_ONLY_PREFIX, /^<!-- reference only/)
    })
})

describe('4 事件载荷', () => {
    test('pressure：§6 line 717 的四字段；tierApplied 枚举闸；budget 量不出给 null', () => {
        const ev = buildContextPressureEvent({iteration: 4, tokens: 170000, budget: 200000, tierApplied: 'T1'})
        assert.deepEqual(ev, {type: 'context_pressure', iteration: 4, tokens: 170000, budget: 200000, tierApplied: 'T1'})
        assert.throws(() => buildContextPressureEvent({iteration: 1, tokens: 1, budget: 2, tierApplied: 'T9'}), /tierApplied/)
        assert.equal(buildContextPressureEvent({iteration: 1, tokens: 1, budget: Infinity}).budget, null)
    })
    test('compacted：mode 闸 + 句柄清单必带（"变短了多少可追回"是用户敢继续聊的依据）', () => {
        const ev = buildContextCompactedEvent({mode: 'clearing', iteration: 7, clearedCount: 4, freedTokensEst: 9000, handles: ['call_0', 'call_1']})
        assert.equal(ev.type, 'context_compacted')
        assert.deepEqual(ev.handles, ['call_0', 'call_1'])
        assert.throws(() => buildContextCompactedEvent({mode: 'compact'}), /mode/)
        assert.equal(buildContextCompactedEvent({mode: 'digest', iteration: 1, clearedCount: 0, freedTokensEst: 100, handles: Array.from({length: 40}, (_, i) => `h${i}`)}).handles.length, 16, '句柄清单有上限：事件是给用户看的，不是全量账本')
    })
    test('枚举不漂移', () => {
        assert.deepEqual(TIER_LEVELS, ['T1', 'T2', 'T3', 'T4'])
    })
})

describe('5 纯件纪律', () => {
    test('零 import、无 IO/全局/配置读取——判据刀的本分（触发数据出现前它不该有腿）', () => {
        const code = fs.readFileSync(path.join(SRC, 'services/core/context/tiers.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        assert.equal([...code.matchAll(/from\s+'([^']+)'/g)].length, 0, '本模块应当零 import')
        assert.ok(!/fetch\(|llm\.|require\(|config\.|process\.env/.test(code), '接线面（配置/网络）不许混进判据')
    })
})
