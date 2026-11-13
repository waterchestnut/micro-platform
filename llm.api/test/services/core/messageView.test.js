import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import {toMessageView, toProcessSummary} from '../../../services/core/messageView.js'

/**
 * `message` 文档 → 前端视图的契约。
 *
 * **这个文件为什么现在才存在**：视图函数原先住在 `services/core/message.js`，
 * 那个文件一 import 就连 MongoDB（`daos/core/schema/index.js` 顶层 await），测试进不来——
 * 于是四个前端依赖的响应形状一直只有 `docs/api/chat-sse.md` 里的文字描述在担保。
 * 2026-11-11 把它抽成纯模块 `services/core/messageView.js` 后才有可能真测（v1.84 的 `recoverCandidate` 是同一种病的同一种修法）。
 *
 * 搬动时顺手发现原实现里 `toolCalls` 写了**两遍**（后者覆盖前者，值相同所以一直没暴露）——
 * 那本身就是"这函数从没被测过"的证据，所以这里留了一条查重复键的用例。
 */

/**
 * @description 造一条最小可用的 message 文档
 * @param {Object} over 覆盖字段
 * @returns {Object} 文档
 */
const doc = (over = {}) => ({
    messageCode: 'MC-1',
    conversationCode: 'CC-1',
    channel: 'common',
    query: '问',
    answer: '答',
    progress: 'finish',
    ...over,
})

/**
 * 视图键集，逐字对照。**但最后两键的等级不同，别把整张表当"实测"**：
 * - 前面 15 键是母本 dev 探针读到的既有形状；
 * - `runOverlap` / `regeneratedFrom` 是本轮从母本同步进来的 P5/P3 两键，
 *   **在本仓的部署（cw2pc）上还没实测过**——镜像还没带这次改动构建。
 *   部署后要用视图探针复测这两键真的出现在现网响应里，测到了再删掉这条说明
 *   （处理方式与 `toolResults` 那条同样：复测前它只是"代码侧期望的形状"）。
 *
 * 为什么写成一份字面量而不是两段 spread：`extInfoPassthrough.test.js` 的 `viewKeys()`
 * 是按正则读这个常量当权威清单的，spread 会让它只解析出尾部几键
 * ——这个失效是我刚才重构时自己撞出来的，守卫直接报了红。**要改的是写法，不是解析器。**
 */
const DEV_MEASURED_PROCESS_KEYS = ['iterationCount', 'tools', 'toolCalls', 'toolChoice', 'answerRounds',
    'skills', 'contextUsage', 'sources', 'recallStats', 'loopExit', 'forcedFinal', 'interruptedBy',
    'runOverlap', 'regeneratedFrom', /** ↑ 这两键：本仓部署上未实测，见上方说明 */
    'lostChars', 'segments', 'segmentSummary', 'usage', 'toolResults']

describe('视图的键集就是四端读到的那份（新增键必须标明是否已在部署上实测）', () => {
    test('process 的键与快照清单一致（顺序也算契约）', () => {
        assert.deepEqual(Object.keys(toProcessSummary({})), DEV_MEASURED_PROCESS_KEYS,
            '视图形状变了：本仓没有 docs/api/chat-sse.md（那条提示来自母本拷贝），'
            + '所以要改的是前端读 process 的代码，或者本来就不该改')
    })

    test('同步进来的两键在空 extInfo 下是 null，不是缺键', () => {
        /** "没有重叠"与"这版代码还不知道重叠"必须能区分——缺键会被前端读成后者 */
        const p = toProcessSummary({})
        assert.ok('runOverlap' in p, 'runOverlap 必须存在')
        assert.equal(p.runOverlap, null)
        assert.ok('regeneratedFrom' in p, 'regeneratedFrom 必须存在')
        assert.equal(p.regeneratedFrom, null)
    })

    test('顶层视图键含前端在用的那几个，且没有提示词字段', () => {
        const keys = Object.keys(toMessageView(doc()))
        for (const k of ['answer', 'answerReasoning', 'progress', 'error', 'process', 'messageCode']) {
            assert.ok(keys.includes(k), `视图少了 ${k}`)
        }
        for (const bad of ['messages', 'extInfo', 'prompt']) {
            assert.equal(keys.includes(bad), false, `视图不该有 ${bad}（发给模型的完整提示词只留在库里）`)
        }
    })

    test('空 extInfo 也要给出完整键集（前端可以无脑解构，不必到处 ?.）', () => {
        for (const ei of [undefined, null, {}]) {
            assert.deepEqual(Object.keys(toProcessSummary(ei)), DEV_MEASURED_PROCESS_KEYS, String(ei))
        }
    })
})

describe('解释"这一轮为什么没有内容"的两个字段（v1.86 新增，dev 实测驱动的）', () => {
    test('遗弃回填行：lostChars 与 interruptedBy 要能透出去', () => {
        const v = toMessageView(doc({
            answer: '',
            progress: 'abort',
            error: 'abandoned:process-lost',
            extInfo: {interruptedBy: 'process-lost', lostChars: 10772, recoveredBy: 'backfill', writtenBy: 'rescue'},
        }))
        assert.equal(v.process.lostChars, 10772)
        assert.equal(v.process.interruptedBy, 'process-lost')
        assert.equal(v.error, 'abandoned:process-lost')
    })

    test('视图只做忠实透传：数值原样出、非数值成 null（"0 算不算损失"不由这里决定）', () => {
        /**
         * 语义分工要说清：视图层的职责是"库里记了什么就给什么"，
         * 而 **`lostChars` 的 0 在现有数据里表示"回填时没估过"**（新写入已改判 null，存量仍是 0），
         * 所以"只有 > 0 才能引用字数"是**消费方**的规则，写在 `docs/api/chat-sse.md`。
         * 这里如果把 0 归成 null，就等于视图替数据编了一次故事——历史行会被说成"字段缺失"。
         */
        assert.equal(toProcessSummary({lostChars: 0}).lostChars, 0)
        assert.equal(toProcessSummary({lostChars: 10772}).lostChars, 10772)
        assert.equal(toProcessSummary({lostChars: undefined}).lostChars, null)
        assert.equal(toProcessSummary({lostChars: 'abc'}).lostChars, null, '非数值不许变成一个数字')
        assert.equal(toProcessSummary({lostChars: null}).lostChars, null)
    })

    test('归因审计字段不外泄：writtenBy / recoveredBy 都不在视图里', () => {
        /**
         * 这是**反向**边界：视图要的是"为什么空"，不是"这行谁写的"。
         * 顺带记住那个陷阱——"`/core/message/list` 读不到 writtenBy" ≠ "档案没有来源标记"，
         * 把前者当成后者会得出完全相反的诊断结论（§25 里那条就是这个坑）。
         */
        const v = toMessageView(doc({
            extInfo: {writtenBy: 'rescue', recoveredBy: 'backfill', interruptedBy: 'x', lostChars: 3},
        }))
        assert.equal('writtenBy' in v.process, false)
        assert.equal('recoveredBy' in v.process, false)
        assert.equal('writtenBy' in v, false)
        assert.equal(v.process.interruptedBy, 'x', '但该给的还是得给')
    })
})

describe('过程分段（PR-B）与用量（G-6）原样透出', () => {
    test('segments 缺省是空数组、有则不裁字段', () => {
        assert.deepEqual(toProcessSummary({}).segments, [])
        const seg = {seq: 2, kind: 'tool-round', category: 'tools', title: '调用 1 个工具', text: '',
            ref: null, tools: ['a'], metrics: {chars: 35, toolCount: 1, ms: 1635}, truncated: false}
        const p = toProcessSummary({segments: [seg]})
        assert.deepEqual(p.segments, [seg], '视图只裁不筛：段的字段要原样给前端')
    })

    test('cancelled 段能透出（历史里的半句就是靠它显示，否则只剩空气泡）', () => {
        const p = toProcessSummary({segments: [{seq: 3, kind: 'cancelled', category: 'text', metrics: {chars: 42}}]})
        assert.equal(p.segments[0].kind, 'cancelled')
        assert.equal(p.segments[0].metrics.chars, 42)
    })

    test('usage 与 loopExit 透出；缺省时 loopExit 是 null 而不是编一个', () => {
        assert.deepEqual(toProcessSummary({usage: {modelCalls: 2}}).usage, {modelCalls: 2})
        assert.equal(toProcessSummary({}).loopExit, null)
        assert.equal(toProcessSummary({loopExit: 'aborted:loop-exit'}).loopExit, 'aborted:loop-exit')
        assert.equal(toProcessSummary({}).forcedFinal, false)
    })
})

describe('搬运没有改变行为（逐字段对旧实现）', () => {
    const rich = {
        iterationCount: 3,
        tools: [{function: {name: 'searxng_http/search'}}, null, {function: {}}, {function: {name: 'x'}}],
        toolCalls: [{name: 'searxng_http/search', toolCallId: 't1'}],
        toolChoice: 'auto',
        answerList: [{}, {}, {}],
        skills: {candidates: ['document-extractor'], loadedDetails: [{name: 'd'}], toolCount: 1, matchedCount: 1},
        contextUsage: {total: 696, budget: 66976},
        sources: [{resCode: 'r1'}],
        recallStats: {hits: 2},
        loopExit: 'break',
        forcedFinal: true,
        segments: [{seq: 1, kind: 'answer', metrics: {chars: 770}}],
        segmentSummary: {count: 1, processChars: 770, dropped: {count: 0, chars: 0}},
        usage: {promptTokens: 1, completionTokens: 2, totalTokens: 3, callAlert: 'none'},
    }

    test('每个派生字段都按旧语义算（tools 去空、answerRounds=answerList 长度、iterationCount 缺省 1）', () => {
        const p = toProcessSummary(rich)
        assert.deepEqual(p.tools, ['searxng_http/search', 'x'], '工具名列表要滤掉没有 function.name 的项')
        assert.equal(p.answerRounds, 3)
        assert.equal(p.iterationCount, 3)
        assert.equal(toProcessSummary({}).iterationCount, 1, '缺省必须是 1（0 会被读成"一次都没跑"）')
        assert.deepEqual(p.skills, {candidates: ['document-extractor'], loadedDetails: [{name: 'd'}], toolCount: 1, matchedCount: 1})
        assert.deepEqual(p.segmentSummary.dropped, {count: 0, chars: 0})
    })

    test('toolResults：只给量级，原文一个字都不外泄；stored 三态不拿猜测填事实位', () => {
        const ei = {
            toolOverflows: [
                {ref: 'call_1', tool: 'search_web', chars: 12992, stored: true, originalTokens: 9000, keptTokens: 1200, content: 'LEAKY' + 'x'.repeat(50)},
                {ref: 'call_2', tool: 'run_code', chars: 300000, stored: false, originalTokens: 80000, keptTokens: 1200, content: 'y'.repeat(40)},
                /** 老形状：只有 tool_call_id、且没有 stored 键 */
                {tool_call_id: 'call_3', tool: 'legacy', chars: 500, content: 'z'.repeat(10)},
                /** 空条目也不该编出数字 */
                {},
            ],
        }
        const p = toProcessSummary(ei)
        assert.equal(p.toolResults.length, 4)
        assert.deepEqual(p.toolResults[0],
            {ref: 'call_1', tool: 'search_web', chars: 12992, stored: true, originalTokens: 9000, keptTokens: 1200})
        assert.equal(p.toolResults[1].stored, false, '超出留档上限必须说"没留住"，否则前端敢说"可取全文"')
        assert.equal(p.toolResults[2].ref, 'call_3', '老行只有 tool_call_id 时也要有 ref，否则前端拿不到取全文的键')
        assert.equal(p.toolResults[2].stored, null, 'stored 键缺失是"不知道"，不能默认成 true')
        assert.deepEqual(p.toolResults[3], {ref: null, tool: null, chars: null, stored: null, originalTokens: null, keptTokens: null})
        /**
         * 外泄边界靠断言而不是靠"我看着没写"。
         * `dev 实测：800 行里 27 条留档、合计 209,939 字符` ⇒ 这些正文真在库里，
         * 视图少滤一个字段就是整批外泄，所以两条都要钉：值里没有、键本身也不存在。
         */
        assert.equal(JSON.stringify(p).includes('LEAKY'), false, '视图里出现了工具返回原文')
        for (const r of p.toolResults) {
            assert.equal('content' in r, false, 'toolResults 不该带 content')
        }
    })

    test('返回对象里没有重复键（旧实现把 toolCalls 写了两遍，靠后者覆盖才没出事）', () => {
        const src = fs.readFileSync(new URL('../../../services/core/messageView.js', import.meta.url), 'utf8')
        const body = src.slice(src.indexOf('export function toProcessSummary'), src.indexOf('export function toMessageView'))
        const keys = [...body.matchAll(/^\s{8}([A-Za-z_][A-Za-z0-9_]*):/gm)].map(m => m[1])
        const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
        assert.deepEqual([...new Set(dup)], [], `重复的视图字段：${dup.join(',')}`)
        assert.ok(keys.length >= 10, `只解析出 ${keys.length} 个字段，多半是缩进判据没跟上`)
    })
})

describe('toMessageView 的兜底', () => {
    test('doc 为 null/undefined 时返回 null（调用方 map 时不会炸成半条记录）', () => {
        assert.equal(toMessageView(null), null)
        assert.equal(toMessageView(undefined), null)
    })

    test('attachments / inputs 缺省给空数组（前端直接 .map）', () => {
        const v = toMessageView(doc({attachments: undefined, inputs: undefined}))
        assert.deepEqual(v.inputs, [])
        assert.deepEqual(v.attachments, [])
        assert.deepEqual(v.answerAttachments, [])
    })

    test('answerFromCache 归一成布尔（库里可能是 undefined/0/1）', () => {
        for (const [raw, want] of [[undefined, false], [0, false], [1, true], [true, true]]) {
            assert.equal(toMessageView(doc({answerFromCache: raw})).answerFromCache, want, String(raw))
        }
    })
})
