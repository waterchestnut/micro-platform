import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import {exitReasonForPersist, loopExitReason, exhaustedFallback} from '../../../services/core/llmLoop.js'
import {PERSIST_VIA} from '../../../services/core/session/shutdownPolicy.js'

/**
 * `loopExit` 落库前的最后一道补齐。
 *
 * 起因是一条 dev 读数（v1.72）：断开落在"工具批之后"的那一轮，档案里
 * `progress:'abort'` 而 `loopExit:'unknown'`——四个早退点都在赋值之前落库，
 * 于是"这轮为什么没答完"又回到只能靠日志猜。而 `llmLoop` 里那句注释当时还写着
 * **"理论上不可达"**：读数到场，注释就得改。
 */

/**
 * `fb.progress` 这类**属性表达式进度**能不能不带 `interruptedBy`，唯一的合法理由是"它取不到 abort"。
 * 这句话必须是跑出来的值域，不能是我读 `llmLoop` 注释读出来的结论——
 * 上一版守卫就是因为式子匹配不上 `fb.progress`（里面有个点号）而**巧合地**全绿，
 * 那属于把盲区伪装成覆盖。所以这里把 `loopExit` 的真实字母表（含 `aborted:*` 各形态）
 * 连同正文/分段的空与非空一起枚举，取它可能落下的全部 progress。
 */
const FB_PROGRESS_DOMAIN = (() => {
    const exits = ['break', 'continue', 'exhausted', 'unknown', '', 'aborted:error', 'aborted:unattributed', 'aborted:loop-exit', 'aborted:shutdown:process-lost', undefined]
    const seen = new Set()
    for (const loopExit of exits) {
        for (const answerContent of ['', '有正文']) {
            for (const answerList of [[], ['一段'], [null, '', undefined]]) {
                seen.add(exhaustedFallback({loopExit, answerContent, answerList}).progress)
            }
        }
    }
    return [...seen].sort()
})()
/** 允许因"值域不含 abort"而豁免来源的属性表达式（必须逐项被真正用到，不许有死项） */
const NEVER_ABORT_PROGRESS_ARGS = ['fb.progress']

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
        /** 遍历**枚举本身**：抄一份名单会在下次加 via 时悄悄少测一个值 */
        for (const via of Object.values(PERSIST_VIA)) {
            for (const closing of [false, true]) {
                const v = exitReasonForPersist({progress: 'abort', loopExit: 'unknown', via, closing})
                assert.match(v, /^(aborted|shutdown):[a-z-]+$/, `形状不合约定：${v}`)
                assert.ok(!/unknown/.test(v), `补齐后不许还留着 unknown：${v}`)
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

    test('每个 abort 落库点都必须自带来源（新增站点忘了接线就要红）', () => {
        const calls = lines().filter(l => /persistTurn\('abort'/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.ok(calls.length >= 4, `至少应有 4 个 abort 落库点，实际 ${calls.length}：接线可能整体丢了`)
        const naked = calls.filter(l => !/via:\s*PERSIST_VIA\./.test(l))
        assert.deepEqual(naked, [], `这些 abort 落库点没有来源标签：${JSON.stringify(naked.map(s => s.trim().slice(0, 70)))}`)
    })

    test('站点用的是各自的标签，不是同一个笼统值', () => {
        const s2 = lines().join('\n')
        for (const k of ['LOOP_ENTRY', 'LOOP_EXIT', 'FINALIZE_INTERRUPTED']) {
            assert.ok(s2.includes(`PERSIST_VIA.${k}`), `站点 ${k} 的接线不见了`)
        }
        const direct = lines().filter(l => /persistTurn\([^)]*PERSIST_VIA\.UNATTRIBUTED/.test(l))
        assert.deepEqual(direct, [], `仍有 abort 站点直接落 unattributed：${JSON.stringify(direct.map(x => x.trim().slice(0, 70)))}`)
    })

    test('每个 abort 落库点都必须说明"是谁打断的"（interruptedBy 不许漏）', () => {
        /**
         * 这条正是底座原来缺的东西：RESCUE 与 EARLY_STOP 站点只带了 via，
         * 于是 `extInfo.interruptedBy` 落成默认值——而"用户按停止"与"发版切连接"
         * 恰恰是这一列要分的两件事。**只能靠人工对比发现的不变量，等于没有不变量。**
         *
         * 2026-11-12 连着补两次，第二次的理由更要紧：
         * ① 只匹配字面量 `persistTurn('abort'` 会漏掉**变量进度**的站点（`errProgress`）；
         * ② 补成 `[A-Za-z_$][\w$]*\s*,` 之后仍然漏——`persistTurn(fb.progress, …)` 里有个点号，
         *   式子匹配不上，于是"它没带来源"看起来是绿的，其实**从没进过断言**。
         *   巧合正确比错误更糟：盲区藏在我声称已经补强的那条用例里。
         * 现在按进度实参的**形态**分三类各自处置：字面 'abort'、裸标识符、属性表达式；
         * 属性表达式只能凭"值域不含 abort"豁免，且豁免表不许留死项。
         */
        const argOf = (l) => (/persistTurn\(\s*([^,)]+)/.exec(l) || [])[1]?.trim() || ''
        const calls = lines().filter((l) => /persistTurn\(/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.ok(calls.length >= 7, `persistTurn 站点应不少于 7 处，实际 ${calls.length}：接线可能整体丢了`)

        const literal = calls.filter((l) => argOf(l) === "'abort'")
        const bare = calls.filter((l) => {
            const a = argOf(l)
            return a && !/^'/.test(a) && !/[.[]/.test(a)
        })
        const dotted = calls.filter((l) => /[.[]/.test(argOf(l)))
        /** 三类必须真的把全部站点分完：新出现的写法（三元、函数调用）不能悄悄落到任何一类之外 */
        assert.equal(literal.length + bare.length + dotted.length, calls.length,
            `站点分类没覆盖全部：${JSON.stringify(calls.filter((l) => ![...literal, ...bare, ...dotted].includes(l)).map((l) => argOf(l)))}`)

        assert.ok(literal.length >= 5, `字面 'abort' 站点应不少于 5 处，实际 ${literal.length}`)
        assert.ok(bare.some((l) => /errProgress/.test(l)),
            '参数化进度（errProgress）的站点必须被本条覆盖，否则又退回只匹配字面量的假绿')
        const naked = [...literal, ...bare].filter((l) => !/interruptedBy/.test(l))
        assert.deepEqual(naked, [], `这些 abort 落库点没写打断来源：${JSON.stringify(naked.map((s) => s.trim().slice(0, 80)))}`)

        /** 属性表达式：要么自带来源，要么凭值域证明豁免，且豁免项必须真被用到 */
        const usedExemptions = []
        for (const l of dotted) {
            const a = argOf(l)
            if (/interruptedBy/.test(l)) continue
            assert.ok(NEVER_ABORT_PROGRESS_ARGS.includes(a),
                `${a} 既没写打断来源，也不在"值域不含 abort"的豁免表里（见下一条用例）`)
            assert.ok(!FB_PROGRESS_DOMAIN.includes('abort'),
                `${a} 想靠值域豁免，但 exhaustedFallback 的 progress 值域里有 abort：${JSON.stringify(FB_PROGRESS_DOMAIN)}`)
            usedExemptions.push(a)
        }
        const dead = NEVER_ABORT_PROGRESS_ARGS.filter((a) => !usedExemptions.includes(a))
        assert.deepEqual(dead, [], `豁免表里有死项（站点其实已经没了，或已经自带来源）：${JSON.stringify(dead)}`)
    })

    test('豁免的地基：exhaustedFallback 在任何 loopExit 形态下都落不出 abort', () => {
        /**
         * 上一条用例允许属性表达式进度不带来源，靠的是这条。
         * 值域写成字面量数组会被"改函数返回值但不改这里"绕过，所以两头都钉：
         * 跑出来的值域 = 期望值域，且不含 abort。
         */
        assert.deepEqual(FB_PROGRESS_DOMAIN, ['error', 'finish'],
            `progress 值域变了：${JSON.stringify(FB_PROGRESS_DOMAIN)}；若真出现 abort，`
            + '就得把 fb.progress 那个站点从豁免表移走并让它自带来源')
        assert.ok(!FB_PROGRESS_DOMAIN.includes('abort'), '空答案/到顶兜底都不该记 abort，abort 只该由中断路径写下')
        /** 顺带钉住"空答案绝不记 finish"这条既有口径（值域里有 error 就是它在起作用） */
        assert.equal(exhaustedFallback({loopExit: 'exhausted', answerContent: '', answerList: []}).progress, 'error')
    })

    test('中断来源不许有静默兜底，也不许忽略站点显式传值', () => {
        /**
         * 底座原来有两个方向的问题，各来自一次跨仓对照：
         * ① 源仓的默认值是写死的 'unspecified' ⇒ 站点漏接线时缺陷变成"看起来正常的数据"；
         * ② 底座的默认值只调 `interruptReason()`，从不读 `extra.interruptedBy`
         *   ⇒ 五个站点传进来的来源**全是死参数**（今天没错纯属巧合：算的是同一个函数）。
         * 现在两边同形：站点显式值优先，缺省时现场计算；这个用例把"两者都必须存在"钉住。
         */
        const codeLines = lines().filter(l => l.includes('unspecified') && !/^\s*(\*|\/\/)/.test(l.trim()))
        assert.deepEqual(codeLines, [],
            `来源不该有写死的标签值，却出现在：${JSON.stringify(codeLines.map(l => l.trim().slice(0, 70)))}`)
        const defaults = lines().filter(l => /interruptedBy:\s*progress === 'abort'/.test(l))
        assert.equal(defaults.length, 1, `默认分支应恰好一处，实际 ${defaults.length}`)
        assert.ok(defaults[0].includes('extra.interruptedBy ||'), '站点显式传值必须优先，不能被默认覆盖')
        assert.ok(defaults[0].includes('interruptReason()'), '缺省时必须现场计算，不写死标签')
    })
    test('cancelled 段只在唯一落库点封，且必须排在段列表被读走之前', () => {
        /**
         * 两个失败模式都静默：
         * ① 写在四个早退点各一遍 ⇒ 漏一个点就漏一类中断，且四处会各自漂移；
         * ② 写在 `segments.list()` 之后 ⇒ 封了个寂寞，档案里根本没有这段，
         *    而代码看起来是对的（这与"配置写在不生效的位置"是同一类错误）。
         */
        const src = lines()
        const at = src.map((l, i) => [l, i]).filter(([l]) => /needsCancelledSegment\(/.test(l) && !/^\s*(\*|\/\/)/.test(l))
        assert.equal(at.length, 1, `判决点应只有一处，实际 ${at.length}：${JSON.stringify(at.map(([l]) => l.trim().slice(0, 60)))}`)
        const sealLine = at[0][1]
        const readLine = src.findIndex(l => /segments:\s*segments\.list\(\)/.test(l))
        assert.ok(readLine > sealLine, `封段(${sealLine + 1}) 必须早于段被读走(${readLine + 1})，否则档案里没有这一段`)
        const body = src.slice(sealLine, sealLine + 8).join('\n')
        assert.match(body, /SEGMENT_KINDS\.CANCELLED/, '封的必须是 cancelled 段')
        assert.match(body, /text:\s*answerContent/, '正文取当前累积的半句')
        /** 不用正则：这里要匹配的是"含引号与斜杠的一行 import"，写成正则要一路转义，用 includes 反而没有猜的空间 */
        const hasImport = src.some(l => l.includes('needsCancelledSegment') && l.includes(`from './segments.js'`))
        assert.ok(hasImport, '没 import 就无法调用；判据是那一行 import 本身，不是"前 80 行里大概能找到"')
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
