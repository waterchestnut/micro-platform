import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import {exitReasonForPersist, loopExitReason} from '../../../services/core/llmLoop.js'

/**
 * `loopExit` 落库前的最后一道补齐。
 *
 * 起因是一条 dev 读数（v1.72）：断开落在"工具批之后"的那一轮，档案里
 * `progress:'abort'` 而 `loopExit:'unknown'`——四个早退点都在赋值之前落库，
 * 于是"这轮为什么没答完"又回到只能靠日志猜。而 `llmLoop` 里那句注释当时还写着
 * **"理论上不可达"**：读数到场，注释就得改。
 */

describe('exitReasonForPersist：只有 abort 才允许被补', () => {
    test('非 abort 落库一律原样返回（包括它本来就带 unknown）', () => {
        /**
         * 为什么"finish 时不补 unknown"也要测：这条规则如果写成
         * "unknown 就补"，那 `finish` 档案里的 unknown 会被伪造成 `aborted:*`，
         * 等于把"我不知道"改写成"我有答案"——那是这整轮工作最反对的那种事。
         */
        assert.equal(exitReasonForPersist({progress: 'finish', loopExit: 'break'}), 'break')
        assert.equal(exitReasonForPersist({progress: 'finish', loopExit: 'unknown'}), 'unknown')
        assert.equal(exitReasonForPersist({progress: 'error', loopExit: 'exhausted'}), 'exhausted')
        assert.equal(exitReasonForPersist({progress: 'error', loopExit: undefined}), undefined,
            'undefined 也别在这里被顺手填掉')
    })

    test('abort 且已有真实原因时绝不覆盖', () => {
        assert.equal(exitReasonForPersist({progress: 'abort', loopExit: 'exhausted', via: 'early-stop'}), 'exhausted')
        assert.equal(exitReasonForPersist({progress: 'abort', loopExit: 'break', via: 'rescue', closing: true}), 'break')
    })

    test('abort + unknown 时补出来源，且能区分断开与发版', () => {
        assert.equal(
            exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via: 'early-stop', closing: false}),
            'aborted:early-stop')
        assert.equal(
            exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via: 'rescue', closing: true}),
            'shutdown:rescue', '发版路径必须是 shutdown：把发版记成用户取消正是 v1.38 那条老错')
        assert.equal(
            exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via: 'unattributed', closing: false}),
            'aborted:unattributed', '没带 via 也要留下"这一条来自没区分的路径"，而不是编一个来源')
    })

    test('via 缺失落 unattributed，而不是留空或假装 normal', () => {
        assert.equal(exitReasonForPersist({progress: 'abort', loopExit: 'unknown', closing: false}), 'aborted:unattributed')
        assert.equal(exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via: '', closing: true}), 'shutdown:unattributed')
        assert.equal(exitReasonForPersist({progress: 'abort', loopExit: '', via: undefined}), 'aborted:unattributed')
    })

    test('补出的值必须带前缀且可聚合（统计要按来源分组，不能是自由文本）', () => {
        const seen = new Set()
        for (const via of ['normal', 'early-stop', 'rescue', 'error', 'unattributed']) {
            for (const closing of [false, true]) {
                const v = exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via, closing})
                assert.match(v, /^(aborted|shutdown):[a-z-]+$/, `形状不合约定：${v}`)
                seen.add(v.split(':')[0])
            }
        }
        assert.deepEqual([...seen].sort(), ['aborted', 'shutdown'], '前缀只有这两种，聚合口径才稳定')
    })

    test('loopExitReason 仍然会返回 unknown（那是这条路径的入口条件，不许在这里就改掉）', () => {
        /** 理论出口：循环没 break 也没到顶，只有 abort 早退会留下 unknown */
        assert.equal(loopExitReason({broke: false, iterationCount: 1, maxIterations: 6}), 'unknown')
    })
})

describe('落库点的接线（llmChat 离线跑不起来，所以守形状）', () => {
    /**
     * @description 读 llmChat 源码
     * @returns {String[]} 行数组
     */
    const lines = () => fs.readFileSync(new URL('../../../services/core/llmChat.js', import.meta.url), 'utf8').split(/\r?\n/)

    test('规则只算一次：`exitReasonForPersist` 在 persistTurn 顶部现算', () => {
        const src = lines()
        const defs = src.filter(l => /const loopExitNow = exitReasonForPersist\(/.test(l))
        assert.equal(defs.length, 1, `补齐只应算一次，实际 ${defs.length} 次`)
        assert.match(defs[0], /progress,/, '必须把本次落库的 progress 传进去，否则非 abort 也会被改')
        assert.match(defs[0], /via:\s*extra\.via/, 'via 要取落库现场的那个，不是写死的')
        assert.match(defs[0], /closing:\s*isClosing\(\)/, '关闭期间必须报 shutdown，不然发版又被记成用户取消')
    })

    test('两张表共用同一个值：档案与账本都不许再落未补齐的 loopExit', () => {
        const src = lines()
        const uses = src.filter(l => /loopExit:\s*loopExitNow/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.equal(uses.length, 2, `档案 extInfo 与账本 llmUsage 各一处，实际 ${uses.length} 处：${JSON.stringify(uses.map(s => s.trim()))}`)
        /**
         * 为什么这条最要紧：只补档案不补账本，就会出现
         * "message 说 aborted:early-stop、llmUsage 说 unknown"——
         * 同一个问题在两张表里两个答案，比两边都 unknown 更难查（会有一种看起来是对的）。
         */
        const bare = src.filter(l => /^\s*loopExit,\s*$/.test(l))
        assert.equal(bare.length, 1, `只剩 finalizationDecision 那处该用原始内存值，实际剩 ${bare.length} 处`)
    })

    test('finalizationDecision 仍用原始 loopExit（它判的是"循环怎么退的"，不是"怎么落的库"）', () => {
        const src = lines()
        const i = src.findIndex(l => /const fin = finalizationDecision\(\{/.test(l))
        assert.ok(i >= 0, '找不到 finalizationDecision 调用点')
        assert.match(src[i + 1], /^\s*loopExit,\s*$/,
            `收尾判定必须读未加工的循环结果，实际是 [${src[i + 1].trim()}]`)
        assert.ok(!/loopExitNow/.test(src[i + 1]), '把补齐值传进收尾判定=用落库口径倒推动作口径')
    })

    test('llmLoop 里"理论上不可达"那句话只能以被证伪的形式存在', () => {
        const src = fs.readFileSync(new URL('../../../services/core/llmLoop.js', import.meta.url), 'utf8')
        const hits = src.split(/\r?\n/).filter(l => l.includes('理论上不可达'))
        /**
         * 允许出现，但必须与"证伪"同行——上一版我写成"整文件不许出现"，
         * 结果新注释里那句"这句原来写的是…证伪了"自己触发了断言。
         * **守卫也要能被自己的读数打回**，不然它只是在证明作者当时的心情。
         */
        assert.equal(hits.length, 1, `出现 ${hits.length} 次`)
        assert.match(hits[0], /证伪|已证伪/, '留着这句必须同时说明它已被实测推翻')
        assert.match(src, /exitReasonForPersist/, '不可达性的处理者要在场')
    })
})
