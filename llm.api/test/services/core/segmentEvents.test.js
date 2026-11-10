import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import {resolveProtocol} from '../../../services/core/llmLoop.js'
import {
    createSegmentLedger, segmentStartEvent, segmentEndEvent, SEGMENT_KINDS, SEGMENT_CATEGORIES,
} from '../../../services/core/segments.js'

/**
 * 协议 3 的段事件。
 * 断言全部围绕**成对性与载荷边界**：孤儿 start 会留下永不结束的卡、孤儿 end 会留下没有头的卡，
 * 两者都比"少一个事件"难查得多；而 `segment_end` 带正文会让"流里看到的字数"和"库里回放的字数"变成两套。
 */

/**
 * @description 造一个记账的账本
 * @param {Object} [opt] 选项
 * @returns {Object} {ledger, calls}
 */
function mk(opt = {}) {
    const calls = []
    const ledger = createSegmentLedger({
        events: opt.events !== false,
        onEvent: (event, payload) => calls.push({event, payload}),
        ...opt.budget,
    })
    return {ledger, calls}
}

describe('resolveProtocol 的协议 3', () => {
    test('只有显式 protocol>=3 才发段事件', () => {
        assert.equal(resolveProtocol({}).emitSegments, false)
        assert.equal(resolveProtocol({protocol: 1}).emitSegments, false)
        /** 四端今天传的都是 2：默认必须与改造前逐字一致 */
        assert.equal(resolveProtocol({protocol: 2}).emitSegments, false)
        assert.equal(resolveProtocol({protocol: 3}).emitSegments, true)
    })

    test('协议 3 不丢协议 2 的能力（工具结果分流）', () => {
        assert.equal(resolveProtocol({protocol: 2}).emitToolResults, true)
        assert.equal(resolveProtocol({protocol: 3}).emitToolResults, true)
        assert.equal(resolveProtocol({protocol: 1}).emitToolResults, false)
        assert.equal(resolveProtocol({protocol: 1, streamToolResults: true}).emitToolResults, true)
    })

    test('protocol 值本身要能透传（前端要据此选渲染分支）', () => {
        assert.equal(resolveProtocol({protocol: 3}).protocol, 3)
        assert.equal(resolveProtocol({protocol: '3'}).protocol, 3, 'env/JSON 里可能是字符串')
        assert.equal(resolveProtocol({protocol: 9}).protocol, 3, '更高的版本按已知最高档处理，不要静默变成 1')
    })
})

describe('段事件的成对性', () => {
    test('events 关闭时一个事件都不发（协议 2 的字节不受影响）', () => {
        const {ledger, calls} = mk({events: false})
        assert.equal(ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND}), null)
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'abc', tools: ['search']})
        assert.deepEqual(calls, [])
    })

    test('open→seal 恰好一对，seq 一致', () => {
        const {ledger, calls} = mk()
        ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND, tools: ['search', 'fetch']})
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: '半句话', tools: ['search', 'fetch'], startedAt: 1000, now: 2500})
        assert.deepEqual(calls.map(c => c.event), ['segment_start', 'segment_end'])
        assert.equal(calls[0].payload.seq, 1)
        assert.equal(calls[1].payload.seq, 1, 'start/end 靠 seq 关联，对不上就废了')
    })

    test('重复 open 只发一条 start（否则前端多出一张永不结束的卡）', () => {
        const {ledger, calls} = mk()
        ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND})
        ledger.open({kind: SEGMENT_KINDS.SKILL_RELOAD})
        assert.equal(calls.filter(c => c.event === 'segment_start').length, 1)
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'x'})
        assert.equal(calls.length, 2)
    })

    test('漏 open 直接 seal 时补发 start：孤儿 end 绝不允许出现', () => {
        const {ledger, calls} = mk()
        ledger.seal({kind: SEGMENT_KINDS.FINALIZE, text: '最终内容'})
        assert.deepEqual(calls.map(c => c.event), ['segment_start', 'segment_end'])
    })

    test('连续两段各自成对且 seq 递增', () => {
        const {ledger, calls} = mk()
        ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND})
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: '一'})
        ledger.open({kind: SEGMENT_KINDS.ANSWER})
        ledger.seal({kind: SEGMENT_KINDS.ANSWER, text: '二'})
        assert.deepEqual(calls.map(c => `${c.event}:${c.payload.seq}`),
            ['segment_start:1', 'segment_end:1', 'segment_start:2', 'segment_end:2'])
    })
})

describe('meta 必须自报真实档位（源码级守卫）', () => {
    test('llmChat 的 meta 载荷里不许再出现硬编码 protocol: 2', () => {
        /**
         * 与 `clientProtocol === 2` 同族的问题：`meta` 里曾写死 `protocol: 2`，
         * 于是协议 3 的流一边发 `segment_start`、一边告诉客户端"我是协议 2"。
         * 前端按 `meta.protocol` 选渲染分支时就会**永远选不到 3**，
         * 而后端读数看起来一切正常——这种"后端在发、契约说没有"的不一致最难查。
         * 同上一轮：llmChat 的发射顺序离线跑不起来，所以守的是形状。
         */
        const src = fs.readFileSync(new URL('../../../services/core/llmChat.js', import.meta.url), 'utf8')
        const hard = src.split(/\r?\n/)
            .filter(l => /protocol:\s*2\b/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.deepEqual(hard, [], `meta 里仍写死档位：${JSON.stringify(hard.map(s => s.trim().slice(0, 80)))}`)
        assert.match(src, /protocol:\s*clientProtocol/, '必须报协商出来的真实档位')
    })
})

describe('请求侧的协议闸门（端到端实测照出来的教训）', () => {
    /**
     * 我曾以为"resolveProtocol 支持 3"就等于协议 3 可用；实发一次得到 **400 "响应体预定义枚举值之一"**
     * 才发现 schema 的 `enum:[1,2]` 才是真正的入口闸门。
     * 所以这里把枚举契约钉住：以后加协议 4 时，改协商不改 schema 会立刻被这条用例抓到。
     * @param {Object} node 任意 schema 节点
     * @param {String} key 要找的属性名
     * @returns {Object|null} 找到的节点
     */
    const findProp = (node, key) => {
        if (!node || typeof node !== 'object') {
            return null
        }
        if (node.properties && node.properties[key]) {
            return node.properties[key]
        }
        for (const v of Object.values(node)) {
            const hit = findProp(v, key)
            if (hit) {
                return hit
            }
        }
        return null
    }

    test('协议 3 必须继承协议 2 的全部事件（源码级守卫：不许再出现 clientProtocol === 2）', () => {        /**
         * 为什么是读源码而不是跑函数：这个 bug 出在 llmChat 的发射顺序里，
         * 而 llmChat 依赖 OpenAI/DB/MCP，没有离线用例能覆盖到那几行——
         * 上一次它就是穿着"714 条全绿"过去的，只在我按 protocol:3 实发请求逐帧数时才现形
         * （`meta` 与 `sources` 一帧都不发）。
         * 所以这里退而求其次：把"严格相等"这个形状本身禁掉。
         */
        /** 用 import.meta.url 而不是绝对路径：硬编码盘符的测试只在写它的那台机器上绿，换个人/换底座就是假绿 */
        const src = fs.readFileSync(new URL('../../../services/core/llmChat.js', import.meta.url), 'utf8')
        const strict = src.split(/\r?\n/).filter(l => /clientProtocol\s*===?\s*2\b/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.deepEqual(strict, [], `llmChat 里仍有严格等于 2 的判断（新档位会丢掉这些事件）：${JSON.stringify(strict.map(s => s.trim().slice(0, 70)))}`)
    })

    test('chatStream 的 protocol 枚举必须包含 1/2/3，且不含没实现的档位', async () => {
        const {chatStreamBodySchema} = await import('../../../schemas/chatStreamSchema.js')
        const node = findProp(chatStreamBodySchema, 'protocol')
        assert.ok(node, '找不到 protocol 节点')
        assert.deepEqual(node.enum, [1, 2, 3], `实际枚举 ${JSON.stringify(node.enum)}`)
    })
})

describe('载荷边界（D63 的口径）', () => {
    test('start 的 kind/category/title 全部由服务端给好，前端零推断', () => {
        const {ledger, calls} = mk()
        ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND, tools: ['search']})
        const p = calls[0].payload
        assert.equal(p.kind, SEGMENT_KINDS.TOOL_ROUND)
        assert.equal(p.category, SEGMENT_CATEGORIES.TOOLS)
        assert.match(p.title, /search/, '标题要能看出这段在干什么')
        assert.equal(Object.prototype.hasOwnProperty.call(p, 'text'), false, '开场不该带正文')
    })

    test('end 带计数与形态，**不带正文**（否则流里和库里各一套字数）', () => {
        const {ledger, calls} = mk()
        ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND})
        ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: 'a'.repeat(3000), tools: ['search'], startedAt: 1000, now: 2200, textChars: 2000})
        const end = calls[1].payload
        assert.equal(Object.prototype.hasOwnProperty.call(end, 'text'), false)
        assert.equal(end.metrics.chars, 3000, 'chars 必须是原文真实长度，不被截断污染')
        assert.equal(end.truncated, true)
        assert.equal(end.metrics.toolCount, 1)
        assert.equal(end.metrics.ms, 1200)
        assert.equal(end.ref, null)
    })

    test('answer/finalize 段的 ref 要透出去（告诉客户端正文去 answer 里找）', () => {
        const end = segmentEndEvent({seq: 3, kind: SEGMENT_KINDS.ANSWER, category: 'text', title: '最终回答', metrics: {chars: 524, toolCount: 0, ms: 800}, ref: 'answer', truncated: false})
        assert.equal(end.ref, 'answer')
        assert.equal(end.metrics.chars, 524)
    })

    test('段数超限后 seq 仍连续（丢段不能让编号重排）', () => {
        const {ledger, calls} = mk({budget: {maxSegments: 2}})
        for (let i = 1; i <= 4; i++) {
            ledger.open({kind: SEGMENT_KINDS.TOOL_ROUND})
            ledger.seal({kind: SEGMENT_KINDS.TOOL_ROUND, text: `段${i}`})
        }
        const seqs = [...new Set(calls.map(c => c.payload.seq))].sort((a, b) => a - b)
        assert.deepEqual(seqs, [1, 2, 3, 4], '被丢掉的段仍占号，否则 start/end 会串位')
        assert.equal(ledger.list().length, 2, '入库仍只留最近的 2 段')
    })

    test('纯函数入口的默认值要能独立使用（不依赖 ledger）', () => {
        assert.deepEqual(Object.keys(segmentStartEvent({seq: 7, kind: SEGMENT_KINDS.SKILL_RELOAD})).sort(),
            ['category', 'kind', 'seq', 'title'])
        assert.equal(segmentStartEvent({}).seq, 1)
        assert.equal(segmentEndEvent({}).metrics.chars, 0)
    })
})
