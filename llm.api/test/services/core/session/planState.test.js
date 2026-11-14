/**
 * @fileOverview 计划状态与完成性判据的用例（PR-M 地基）
 * @module test/services/core/session/planState
 * @description
 * 这是一个"未接线"的纯判据模块，所以这里的用例是它唯一的正确性证据——
 * 除了正向，还要钉住几条**必须为假**的行为，否则以后有人"顺手优化"会把保守取向偷偷翻过来：
 * - 缺失/非法状态不得默认成 done（必须 pending）；
 * - failed/abandoned 不得算未结（否则改了方案会被反问追到永远结束不了）；
 * - exhausted 出口不得触发完成性反问（那是 finalizationDecision 的活，重复触发就是同轮花两次钱）；
 * - recitation 裁剪不得从中间切半句、不得静默（必须整项丢 + 声明"另有 N 项未显示"）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

/** 向上找 src 根：相对层数我数错过多次，找标记目录不会错 */
function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/planState.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/session/planState.js')).href)
const {
    PLAN_STATUS, normalizeStatus, normalizePlan, planItemCounts, hasOpenItems,
    renderRecitation, decideCompletionSelfCheck, buildSelfCheckHint, interpretSelfCheckReply,
} = M

const plan = (...items) => ({items})

describe('1 normalizeStatus：缺失/非法一律 pending（绝不默认 done）', () => {
    test('五个合法状态原样通过', () => {
        for (const s of Object.values(PLAN_STATUS)) {
            assert.equal(normalizeStatus(s), s)
        }
    })
    test('大小写与首尾空格不影响识别', () => {
        assert.equal(normalizeStatus(' IN_PROGRESS '), 'in_progress')
        assert.equal(normalizeStatus('Done'), 'done')
    })
    test('缺失/空/乱值/null/数字 ⇒ pending（保守：没确认做完就没做完）', () => {
        for (const v of [undefined, null, '', '   ', 'wip', 'complete', 0, 1, true, {}]) {
            assert.equal(normalizeStatus(v), PLAN_STATUS.PENDING, `值 ${JSON.stringify(v)} 不该被判成完成`)
        }
    })
})

describe('2 normalizePlan：模型写的东西必须归一，且每处改写都留痕', () => {
    test('非对象 / 没有 items 数组 ⇒ 空清单 + 警告（宁可不注入也不编造条目）', () => {
        for (const v of [null, undefined, {}, [], 'x', {items: 'nope'}, {items: null}]) {
            const r = normalizePlan(v)
            assert.deepEqual(r.items, [])
            assert.ok(r.warnings.length >= 1)
        }
    })
    test('正常载荷：逐条保留 status 与 title', () => {
        const r = normalizePlan(plan(
            {id: 'a', title: '步骤A', status: 'done'},
            {id: 'b', title: '步骤B', status: 'in_progress'},
        ))
        assert.equal(r.items.length, 2)
        assert.deepEqual(r.items[0], {id: 'a', title: '步骤A', status: 'done'})
        assert.deepEqual(r.warnings, [])
    })
    test('非对象项、无 title 项 ⇒ 丢弃并警告', () => {
        const r = normalizePlan(plan(null, 'x', 3, {title: ''}, {id: 'ok', title: '有标题'}))
        assert.equal(r.items.length, 1)
        assert.equal(r.items[0].id, 'ok')
        assert.ok(r.warnings.some((w) => /不是对象/.test(w)))
        assert.ok(r.warnings.some((w) => /缺 title/.test(w)))
    })
    test('缺 id ⇒ 用序号补稳定 id 并警告', () => {
        const r = normalizePlan(plan({title: '无id项'}))
        assert.equal(r.items[0].id, 'item-1')
        assert.ok(r.warnings.some((w) => /缺 id/.test(w)))
    })
    test('id 重复 ⇒ 保留首个、丢弃后来者并警告（装配顺序不能因重复 id 抖动）', () => {
        const r = normalizePlan(plan(
            {id: 'x', title: '第一', status: 'done'},
            {id: 'x', title: '第二'},
        ))
        assert.equal(r.items.length, 1)
        assert.equal(r.items[0].title, '第一')
        assert.ok(r.warnings.some((w) => /id 重复/.test(w)))
    })
    test('非法 status ⇒ 兜成 pending 并警告', () => {
        const r = normalizePlan(plan({id: 'a', title: 'T', status: 'complete'}))
        assert.equal(r.items[0].status, 'pending')
        assert.ok(r.warnings.some((w) => /status.*非法/.test(w)))
    })
    test('title 首尾空格会被 trim', () => {
        const r = normalizePlan(plan({id: 'a', title: '  带空格  '}))
        assert.equal(r.items[0].title, '带空格')
    })
})

describe('3 计数与"未结"集合：openCount = pending + in_progress，failed/abandoned 不算', () => {
    test('五态齐活时逐项计数正确', () => {
        const p = normalizePlan(plan(
            {id: '1', title: 'a', status: 'pending'},
            {id: '2', title: 'b', status: 'in_progress'},
            {id: '3', title: 'c', status: 'done'},
            {id: '4', title: 'd', status: 'failed'},
            {id: '5', title: 'e', status: 'abandoned'},
        ))
        const c = planItemCounts(p)
        assert.equal(c.total, 5)
        assert.equal(c.pending, 1)
        assert.equal(c.inProgress, 1)
        assert.equal(c.done, 1)
        assert.equal(c.failed, 1)
        assert.equal(c.abandoned, 1)
        assert.equal(c.openCount, 2, 'failed/abandoned 是终态，不该算未结')
    })
    test('全 done ⇒ openCount 0、hasOpenItems false', () => {
        const p = normalizePlan(plan({id: '1', title: 'a', status: 'done'}))
        assert.equal(hasOpenItems(p), false)
    })
    test('只有 failed/abandoned ⇒ 没有未结（改了方案不该被追着问）', () => {
        const p = normalizePlan(plan(
            {id: '1', title: 'a', status: 'failed'},
            {id: '2', title: 'b', status: 'abandoned'},
        ))
        assert.equal(hasOpenItems(p), false)
    })
    test('空/畸形计划 ⇒ total 0、hasOpenItems false，不抛', () => {
        for (const p of [undefined, null, {}, {items: 'x'}, {items: []}]) {
            assert.equal(planItemCounts(p).total, 0)
            assert.equal(hasOpenItems(p), false)
        }
    })
})

describe('4 renderRecitation：确定性、整项丢、不静默', () => {
    test('同输入同输出（确定性，否则没法测/模型每轮视图会抖）', () => {
        const p = normalizePlan(plan({id: 'a', title: 'A', status: 'done'}, {id: 'b', title: 'B', status: 'pending'}))
        assert.equal(renderRecitation(p).text, renderRecitation(p).text)
    })
    test('头部带完成数/未结数，条目带状态符号', () => {
        const p = normalizePlan(plan({id: 'a', title: '写测试', status: 'done'}, {id: 'b', title: '接线路', status: 'pending'}))
        const {text} = renderRecitation(p)
        assert.match(text, /完成 1\/2/)
        assert.match(text, /未结 1/)
        assert.match(text, /\[x\] 写测试/)
        assert.match(text, /\[ \] 接线路/)
    })
    test('空计划 ⇒ 只有一行头，不抛', () => {
        const {text, shown, omitted} = renderRecitation({items: []})
        assert.equal(shown, 0)
        assert.equal(omitted, 0)
        assert.ok(text.startsWith('当前计划'))
    })
    test('超预算 ⇒ 整项丢弃 + 声明"另有 N 项未显示"，且 shown+omitted==total', () => {
        const many = {items: Array.from({length: 40}, (_, i) => ({id: `i${i}`, title: `很长的待办标题用来把预算撑爆 ${'字'.repeat(40)}`, status: 'pending'}))}
        const r = renderRecitation(many, {maxChars: 120})
        assert.equal(r.overBudget, true)
        assert.ok(r.omitted > 0)
        assert.equal(r.shown + r.omitted, 40)
        assert.match(r.text, new RegExp(`另有 ${r.omitted} 项未显示`))
        assert.match(r.text, /共 40 项/)
    })
    test('裁剪绝不把标题切成半句（每项要么整条在、要么整条不在）', () => {
        const items = Array.from({length: 20}, (_, i) => ({id: `i${i}`, title: `项${i}标题不会只出现一半`, status: 'pending'}))
        const r = renderRecitation({items}, {maxChars: 60})
        const bodyLines = r.text.split('\n').filter((l) => /\] 项\d+/.test(l))
        for (const l of bodyLines) {
            assert.match(l, /项\d+标题不会只出现一半$/, `出现被切半的标题：${l}`)
        }
    })
    test('maxChars 非法（0/负/NaN/字符串）⇒ 退回默认预算，不崩、不产生空清单', () => {
        const p = normalizePlan(plan({id: 'a', title: 'A', status: 'done'}))
        for (const bad of [0, -5, NaN, '1000', undefined]) {
            const r = renderRecitation(p, {maxChars: bad})
            assert.equal(r.shown, 1, `坏预算 ${String(bad)} 不该把唯一一项也裁掉`)
        }
    })
})

describe('5 decideCompletionSelfCheck：只在该触发时触发，且与 finalization 分工不重叠', () => {
    const openPlan = normalizePlan(plan({id: 'a', title: 'A', status: 'pending'}))
    const donePlan = normalizePlan(plan({id: 'a', title: 'A', status: 'done'}))
    test('开关关 ⇒ 绝不反问（默认不改变行为，和 E0.6/E0.2 同一取向）', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: openPlan, hasAnswer: true, selfCheckEnabled: false}),
            {action: 'none', reason: 'disabled'})
    })
    test('中断 ⇒ 不反问（别在取消/停机上花钱）', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: openPlan, hasAnswer: true, aborted: true, selfCheckEnabled: true}),
            {action: 'none', reason: 'aborted'})
    })
    test('没有计划 ⇒ 不反问（没有可核对的目标，反问是噪音）', () => {
        for (const p of [null, undefined, {items: []}]) {
            assert.deepEqual(decideCompletionSelfCheck({plan: p, hasAnswer: true, selfCheckEnabled: true}),
                {action: 'none', reason: 'no-plan'})
        }
    })
    test('exhausted 出口 ⇒ 交给 finalizationDecision，本判据不重复触发', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: openPlan, loopExit: 'exhausted', hasAnswer: false, selfCheckEnabled: true}),
            {action: 'none', reason: 'handled-by-finalization'})
    })
    test('正常退出但没正文 ⇒ 不反问（那是没答完，不是谎称做完）', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: openPlan, hasAnswer: false, selfCheckEnabled: true}),
            {action: 'none', reason: 'no-answer'})
    })
    test('计划已全结 ⇒ 不反问', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: donePlan, hasAnswer: true, selfCheckEnabled: true}),
            {action: 'none', reason: 'plan-complete'})
    })
    test('唯一会触发的形状：自认为做完(有正文) + 计划仍有未结项 ⇒ self-check', () => {
        assert.deepEqual(decideCompletionSelfCheck({plan: openPlan, loopExit: 'break', hasAnswer: true, selfCheckEnabled: true}),
            {action: 'self-check', reason: 'open-items'})
    })
    test('全默认参数（不传）⇒ none/disabled，不抛', () => {
        assert.deepEqual(decideCompletionSelfCheck(), {action: 'none', reason: 'disabled'})
    })
})

describe('6 buildSelfCheckHint：列未结项、超限声明、不列已完项', () => {
    test('含未结数量与前几项标题', () => {
        const p = normalizePlan(plan(
            {id: 'a', title: '查数据', status: 'done'},
            {id: 'b', title: '写报告', status: 'pending'},
            {id: 'c', title: '发通知', status: 'in_progress'},
        ))
        const h = buildSelfCheckHint(p)
        assert.match(h, /还有 2 项/)
        assert.match(h, /共 3 项/)
        assert.match(h, /- 写报告/)
        assert.match(h, /- 发通知/)
        assert.ok(!/查数据/.test(h), '已完成的项不该出现在反问里')
    })
    test('给出 DONE / CONTINUE 两个机器可读出口（正文处置靠它，见 interpretSelfCheckReply）', () => {
        const p = normalizePlan(plan({id: 'b', title: '写报告', status: 'pending'}))
        const h = buildSelfCheckHint(p)
        assert.match(h, /\bDONE\b/)
        assert.match(h, /\bCONTINUE\b/)
    })
    test('未结项超过 maxList ⇒ 截断并声明"另有 N 项未列出"', () => {
        const items = Array.from({length: 10}, (_, i) => ({id: `i${i}`, title: `任务${i}`, status: 'pending'}))
        const h = buildSelfCheckHint({items}, {maxList: 3})
        assert.match(h, /- 任务0/)
        assert.match(h, /- 任务2/)
        assert.ok(!/- 任务3\b/.test(h), '第 4 项起不该逐条列出')
        assert.match(h, /另有 7 项未列出/)
    })
    test('空/畸形计划 ⇒ 不抛，给 0 项措辞', () => {
        const h = buildSelfCheckHint({items: []})
        assert.match(h, /还有 0 项/)
    })
})

describe('7 interpretSelfCheckReply：不守格式时必须倒向"别搞坏已有答案"', () => {
    const M2 = {action: 'discard', supplement: '', marker: null}
    test('DONE ⇒ discard（多种标点/大小写）', () => {
        for (const t of ['DONE', 'done', 'DONE.', 'DONE：', ' Done ', 'DONE。\n（其实都做完了）']) {
            assert.deepEqual(interpretSelfCheckReply(t), {action: 'discard', supplement: '', marker: 'DONE'}, JSON.stringify(t))
        }
    })
    test('CONTINUE + 换行补充 ⇒ append(补充)', () => {
        const r = interpretSelfCheckReply('CONTINUE\n还漏了发通知这一步：已通知。')
        assert.equal(r.action, 'append')
        assert.equal(r.supplement, '还漏了发通知这一步：已通知。')
        assert.equal(r.marker, 'CONTINUE')
    })
    test('CONTINUE + 同行补充（冒号/空格）也算 append', () => {
        assert.equal(interpretSelfCheckReply('CONTINUE: 补一段').action, 'append')
        assert.equal(interpretSelfCheckReply('CONTINUE 补一段').supplement, '补一段')
    })
    test('CONTINUE 但没写内容 ⇒ discard（没补就别动原答案）', () => {
        for (const t of ['CONTINUE', 'CONTINUE\n', 'CONTINUE：  \n  ']) {
            assert.deepEqual(interpretSelfCheckReply(t), {action: 'discard', supplement: '', marker: 'CONTINUE'}, JSON.stringify(t))
        }
    })
    test('自由文本 / 空 / 非标记开头 ⇒ discard 且 marker=null（保守）', () => {
        for (const t of ['', '   ', '我已经完成了全部工作。', '答案是 42', '继续做', null, undefined]) {
            assert.deepEqual(interpretSelfCheckReply(t), M2, JSON.stringify(t))
        }
    })
    test('不扫描正文中段的 done/continue（只认开头，防误判）', () => {
        assert.deepEqual(interpretSelfCheckReply('这是结果，其中包含 DONE 字样'), M2)
    })
    test('CONTINUED / DONEZ 这类词不误判成标记（\\b 边界）', () => {
        assert.deepEqual(interpretSelfCheckReply('CONTINUED 我的答案'), M2)
        assert.deepEqual(interpretSelfCheckReply('DONEZONE'), M2)
    })
})
