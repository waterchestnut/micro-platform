/**
 * @fileOverview sleep-time 整理判据的用例（PR-O 判据先行刀）
 * @module test/services/core/memory/sleepTime
 * @description
 * 判据刀的"现网"就是它的用例。重点钉四件事：
 * ①合并只走可证明关系（相似/包含），语义冲突判据装看不见（留给模型面）；
 * ②pinned 永不进被并侧、链必须展平（执行壳不做传递闭包，两处理解不一致就是分家）；
 * ③解析保守到全 NOOP（unparsed/无证据/未知 atomCode/重复现存 都不许产出动作）；
 * ④白名单里没有硬删（不可逆操作在无人审路径上不开放——这条断言的是"不存在"，
 *   它比"存在"的断言更容易被未来的顺手优化破坏，所以值得单独钉）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/memory/sleepTime.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const ST = await import(pathToFileURL(path.join(SRC, 'services/core/memory/sleepTime.js')).href)
const {planConsolidation, selectDistillCandidates, buildConsolidationPrompt, parseConsolidationReply, consolidationAdvisory, DISTILLABLE_KINDS} = ST

const A = (code, text, over = {}) => ({atomCode: code, kind: 'preference', text, confidence: 0.7, insertTime: 1000, ...over})

describe('1 planConsolidation：只走可证明关系', () => {
    test('高相似合并：保留 conf 高者，被并方留证据', () => {
        const {actions} = planConsolidation([
            A('a', '用户偏好中文回复所有邮件', {confidence: 0.6}),
            A('b', '用户偏好中文回复所有邮件。', {confidence: 0.9}),
        ])
        assert.equal(actions.length, 1)
        assert.deepEqual([actions[0].keep, actions[0].away], ['b', 'a'])
        assert.ok(actions[0].evidence.sim >= 0.92 || actions[0].evidence.contained)
    })
    test('包含关系合并（短句在长句内；注意 promotion 的 minLen=8 门槛——4 字短语故意不吞，防短句被任意长文吞并）', () => {
        const {actions} = planConsolidation([
            A('a', '用户喜欢用红色作为主题色'),
            A('b', '用户喜欢用红色作为主题色，尤其是周报模板的配色'),
        ])
        assert.equal(actions.length, 1)
        assert.equal(actions[0].away, 'a')
    })
    test('包含赢过 conf：长句 conf 更低也当保留方（信息量优先于置信度——这条被 conf 规则盖住就是丢内容）', () => {
        const {actions} = planConsolidation([
            A('a', '用户喜欢用红色作为主题色', {confidence: 0.95}),
            A('b', '用户喜欢用红色作为主题色，尤其是周报模板的配色', {confidence: 0.5}),
        ])
        assert.equal(actions.length, 1)
        assert.equal(actions[0].keep, 'b')
        assert.equal(actions[0].away, 'a')
    })
    test('不同 kind 绝不互并（episode 与 preference 是两种事实）', () => {
        const {actions, pairsExamined} = planConsolidation([
            {atomCode: 'e', kind: 'episode', text: '喜欢红色', confidence: 0.7, insertTime: 1},
            A('p', '喜欢红色'),
        ])
        assert.equal(actions.length, 0)
        assert.equal(pairsExamined, 0, '不同 kind 的对根本不进比较——计数也要诚实')
    })
    test('pinned 条目永不被并走（用户显式保存优先级最高）', () => {
        const {actions} = planConsolidation([
            A('a', '喜欢红色', {pinned: true, confidence: 0.5}),
            A('b', '喜欢红色', {confidence: 0.9}),
        ])
        assert.equal(actions.length, 0, 'pinned 在低 conf 侧 ⇒ 整对放弃（宁可留重复不碰 pinned）')
    })
    test('链式重复必须展平：a→b→c 出口是 a→c、b→c，没有二手保留方', () => {
        const {actions} = planConsolidation([
            A('a', '用户偏好中文邮件', {confidence: 0.5, insertTime: 1}),
            A('b', '用户偏好中文邮件', {confidence: 0.7, insertTime: 2}),
            A('c', '用户偏好中文邮件', {confidence: 0.9, insertTime: 3}),
        ])
        const keeps = new Set(actions.map((x) => x.keep))
        const aways = new Set(actions.map((x) => x.away))
        assert.deepEqual(actions.length, 2)
        for (const k of keeps) assert.ok(!aways.has(k), `保留方 ${k} 自己是被并方——链没展平，执行壳要做传递闭包就是分家`)
        assert.ok([...aways].every((w) => keeps.has(w) === false))
        actions.forEach((x) => assert.equal(x.keep, 'c'))
    })
    test('脏输入不炸（null/无 text/无 code）', () => {
        const {actions} = planConsolidation([null, {atomCode: 'x'}, A('y', 'ok'), undefined])
        assert.equal(actions.length, 0)
    })
})

describe('2 selectDistillCandidates：攒够才值得花一次模型调用', () => {
    const NOW = 100 * 86400000
    const ep = (code, daysAgo, over = {}) => ({atomCode: code, kind: 'episode', text: `第${code}次对话`, insertTime: NOW - daysAgo * 86400000, ...over})
    test('年龄与数量双门槛：不足 minEpisodes 一条不选', () => {
        const picks = selectDistillCandidates([ep('a', 10), ep('b', 10)], {now: NOW})
        assert.equal(picks.length, 0)
    })
    test('新 episode 不进（minEpisodeAgeDays 默认 7；minEpisodes=3 是数量门槛）', () => {
        const picks = selectDistillCandidates([ep('a', 10), ep('b', 10), ep('c', 10), ep('d', 1)], {now: NOW})
        assert.deepEqual(picks.map((x) => x.atomCode), ['a', 'b', 'c'])
    })
    test('distilledInto 已标的跳过（整理不重复消费）', () => {
        const picks = selectDistillCandidates([ep('a', 10), ep('b', 10), ep('c', 10, {distilledInto: 'atom-x'}), ep('d', 10)], {now: NOW})
        assert.deepEqual(picks.map((x) => x.atomCode), ['a', 'b', 'd'])
    })
    test('maxPerRun 封顶且按时间升序（最旧优先——可重放，不是数组序）', () => {
        const many = Array.from({length: 30}, (_, i) => ep(`e${i}`, 10 + i))
        const picks = selectDistillCandidates(many, {now: NOW, maxPerRun: 5})
        assert.equal(picks.length, 5)
        assert.deepEqual(picks.map((x) => x.atomCode), ['e29', 'e28', 'e27', 'e26', 'e25'], 'e29 最旧排第一——"升序"是 insertTime 升序')
    })
})

describe('3 buildConsolidationPrompt：铁律在记忆域的搬运', () => {
    test('输入只有 raw episode 与现存条目文本（没有"上一轮整理输出"的参数位——铁律一由签名保证）', () => {
        const p = buildConsolidationPrompt(
            [{atomCode: 'e1', text: '用户说以后周报都用表格 https://wiki.corp/x 里的模板'}],
            [{atomCode: 'd1', kind: 'decision', text: '周报用表格'}],
        )
        assert.ok(p.includes('[e1]'))
        assert.ok(p.includes('现存 decision/preference'))
        assert.ok(p.includes('逐字保留'), '标识符逐字规则要在 prompt 里点名')
    })
    test('现存条目为空时给显式 (无)（空列表不靠模型猜）', () => {
        const p = buildConsolidationPrompt([{atomCode: 'e1', text: 'x'}], [])
        assert.ok(p.includes('(无)'))
    })
})

describe('4 parseConsolidationReply：保守到全 NOOP', () => {
    const valid = new Set(['e1', 'e2'])
    test('解析不出 ⇒ noop(unparsed)', () => {
        assert.deepEqual(parseConsolidationReply('我觉得没什么可提炼', {}), [{action: 'noop', reason: 'unparsed'}])
        assert.deepEqual(parseConsolidationReply('[{坏JSON', {}), [{action: 'noop', reason: 'unparsed'}])
    })
    test('未知 atomCode 的证据被过滤；过滤光 ⇒ noop(all-filtered)', () => {
        const text = '[{"action":"distill","kind":"decision","text":"用户决定用表格周报","evidenceAtomCodes":["ghost1"]}]'
        assert.deepEqual(parseConsolidationReply(text, {validAtomCodes: valid}), [{action: 'noop', reason: 'all-filtered'}])
    })
    test('kind 白名单：episode 不许由整理器产出', () => {
        const text = '[{"action":"distill","kind":"episode","text":"新事件","evidenceAtomCodes":["e1"]}]'
        assert.equal(parseConsolidationReply(text, {validAtomCodes: valid}).length, 1)
        assert.equal(parseConsolidationReply(text, {validAtomCodes: valid})[0].action, 'noop')
    })
    test('与现存重复的丢弃', () => {
        const text = '[{"action":"distill","kind":"decision","text":"周报用表格","evidenceAtomCodes":["e1"]}]'
        const r = parseConsolidationReply(text, {validAtomCodes: valid, existingDecisionTexts: new Set(['周报用表格'])})
        assert.equal(r[0].action, 'noop')
    })
    test('合法条目通过并保留证据链', () => {
        const text = '[{"action":"distill","kind":"preference","text":"偏好中文邮件","evidenceAtomCodes":["e1","ghost","e2"]}]'
        const r = parseConsolidationReply(text, {validAtomCodes: valid})
        assert.equal(r.length, 1)
        assert.deepEqual(r[0].evidenceAtomCodes, ['e1', 'e2'], '未知证据码过滤，已知的原样留')
    })
    test('DISTILLABLE_KINDS 只有提炼类', () => {
        assert.deepEqual(DISTILLABLE_KINDS, ['decision', 'preference'])
    })
})

describe('5 执行白名单：不可逆操作的门', () => {
    test('硬删与跨 namespace 写不在 allowed、在 forbidden（断言"不存在"——它最容易被顺手优化破坏）', () => {
        const adv = consolidationAdvisory()
        assert.ok(!adv.allowed.some((a) => /delete/i.test(a)), `allowed 里出现删除类：${adv.allowed.join(',')}`)
        assert.ok(adv.forbidden.includes('hard-delete'))
        assert.ok(adv.forbidden.includes('cross-namespace-write'))
        assert.ok(adv.forbidden.includes('touch-pinned'))
    })
})
