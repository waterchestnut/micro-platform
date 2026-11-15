/**
 * @fileOverview 观察周读数仪的用例（判据纯函数，无需档案数据）
 * @module test/evals/gateWeekRead
 * @description
 * 钉四件事：①计数守恒（分布和=决策总数，反事实明细和=反事实总数）；
 * ②**enforce 反事实的口径**——block 与 await-human 都算"不直接执行"，allow 永不算；
 * ③身份分栏走 sampleCorpus 单源（user 主判据/prefix 次判据都在读数里生效，分家即红）；
 * ④姿态混检——enforce=true 的档案出现时报告必须自己声明（混合口径不成立的自曝）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'evals/gate/gateWeekRead.mjs'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {buildGateWeekReport} = await import(pathToFileURL(path.join(SRC, 'evals/gate/gateWeekRead.mjs')).href)

const msg = (conv, userCode, decisions, enforce = false) => ({
    conversationCode: conv, operator: {userCode}, insertTime: new Date('2026-11-16T06:00:00Z'),
    extInfo: {gate: {enabled: true, enforce, decisions, approvals: 0}},
})
const dec = (tool, verdict, source = 'layer2', extra = {}) =>
    ({tool, source, verdict, applied: 'observed:' + verdict, ...extra})

describe('1 计数与守恒', () => {
    test('空输入不炸且形状完整', () => {
        const r = buildGateWeekReport([])
        assert.equal(r.nDecisions, 0)
        assert.deepEqual(r.applied, {})
        assert.ok('分母提示' in r && '姿态混检' in r)
    })
    test('分布求和=决策总数；缺位字段归 (缺) 而不是丢弃', () => {
        const r = buildGateWeekReport([msg('user-1', 'teacher01', [
            dec('run_code', 'allow'), dec('x', 'block'), {tool: 'y', verdict: 'allow'},
        ])])
        assert.equal(r.nDecisions, 3)
        const sum = Object.values(r.applied).reduce((a, b) => a + b, 0)
        assert.equal(sum, 3)
        assert.equal(r.source['(缺)'], 1)
    })
    test('gate 无 decisions 的档案整条跳过（nMessages 记了但计数不进）', () => {
        const r = buildGateWeekReport([msg('user-1', 'teacher01', []), msg('user-2', 'teacher02', [dec('a', 'allow')])])
        assert.equal(r.nDecisions, 1)
    })
})

describe('2 enforce 反事实口径', () => {
    test('block+await-human 都算"enforce 下不直接执行"；allow 永不算', () => {
        const r = buildGateWeekReport([msg('user-1', 'teacher01', [
            dec('a', 'allow'), dec('b', 'block'), dec('c', 'await-human'), dec('d', 'block'),
        ])])
        assert.equal(r.反事实_enforce下不直接执行, 3)
        assert.deepEqual(r.反事实_明细, {block: 2, 'await-human': 1})
        const sum = Object.values(r.反事实_明细).reduce((a, b) => a + b, 0)
        assert.equal(sum, r.反事实_enforce下不直接执行)
    })
    test('overrode 只数 true（undefined/false 都不进）', () => {
        const r = buildGateWeekReport([msg('user-1', 'teacher01', [
            dec('a', 'escalate', 'layer2', {overrode: true}), dec('b', 'allow', 'layer2', {overrode: false}), dec('c', 'allow'),
        ])])
        assert.equal(r.overrode, 1)
    })
})

describe('3 身份分栏（sampleCorpus 单源）', () => {
    test('user 主判据（menglb）与 prefix 次判据（art-e2e-）都进 synthetic，原因分开计数', () => {
        const r = buildGateWeekReport([
            msg('user-1', 'menglb', [dec('a', 'allow')]),
            msg('art-e2e-main-9', 'teacher01', [dec('b', 'allow'), dec('c', 'allow')]),
            msg('user-2', 'teacher02', [dec('d', 'block')]),
        ])
        assert.equal(r.分栏.synthetic.messages, 2)
        assert.equal(r.分栏.synthetic.decisions, 3)
        assert.equal(r.分栏.natural.messages, 1)
        assert.equal(r.分栏.natural.decisions, 1)
        assert.deepEqual(r.合成排除计数, {user: 1, prefix: 1})
    })
    test('自然面零决策 ⇒ 分母提示必须自我声明（probe 流量不许冒充自然分布）', () => {
        const r = buildGateWeekReport([msg('user-m', 'menglb', [dec('a', 'allow')])])
        assert.match(r.分母提示, /自然面零决策/)
    })
    test('反事实分栏不混：natural 的 block 数与 synthetic 的分开（报告可按栏复核）', () => {
        const r = buildGateWeekReport([
            msg('user-1', 'teacher01', [dec('a', 'block')]),
            msg('user-m', 'menglb', [dec('b', 'block')]),
        ])
        assert.equal(r.反事实_enforce下不直接执行, 2)
        assert.equal(r.分栏.natural.decisions, 1)
    })
})

describe('5 enforce 形态映射（block 不是一个数，是五个来路）', () => {
    test('(verdict,source,raw) 三元组完全区分五来路+ask-human', async () => {
        const {enforceOutcomeOf} = await import(pathToFileURL(path.join(SRC, 'evals/gate/gateWeekRead.mjs')).href)
        assert.equal(enforceOutcomeOf({verdict: 'await-human', source: 'layer2'}), 'ask-human')
        assert.equal(enforceOutcomeOf({verdict: 'block', source: 'layer1', rule: 'deny-x'}), 'blocked-rule')
        assert.equal(enforceOutcomeOf({verdict: 'block', source: 'fuse'}), 'blocked-fuse')
        assert.equal(enforceOutcomeOf({verdict: 'block', source: 'no-classifier', raw: 'unparsable'}), 'blocked-no-model')
        assert.equal(enforceOutcomeOf({verdict: 'block', source: 'layer2', raw: 'block'}), 'blocked-classifier')
        assert.equal(enforceOutcomeOf({verdict: 'block', source: 'layer2', raw: 'escalate'}), 'blocked-no-human')
        assert.equal(enforceOutcomeOf({verdict: 'allow', source: 'layer2', raw: 'allow'}), null, 'allow 永不是反事实')
    })
    test('形态栏求和=反事实总数；自然面栏只数自然身份（探针自钓的 escalate 不许冒充用户量）', () => {
        const r = buildGateWeekReport([
            msg('user-1', 'teacher01', [dec('a', 'block', 'layer2', {raw: 'block'}), dec('b', 'await-human')]),
            msg('gate-stroke-block-9', 'menglb', [dec('c', 'await-human')]),
        ])
        assert.equal(r.反事实_enforce下不直接执行, 3)
        const sum = Object.values(r.反事实_enforce形态).reduce((a, b) => a + b, 0)
        assert.equal(sum, 3, '形态栏必须与总数守恒')
        assert.deepEqual(r.反事实_enforce形态, {'blocked-classifier': 1, 'ask-human': 2})
        assert.deepEqual(r.反事实_自然面, {'blocked-classifier': 1, 'ask-human': 1},
            '合成面（menglb 自钓）的那笔 ask-human 不得进自然栏')
    })
})

describe('4 姿态混检与按天时序', () => {
    test('enforce=true 档案出现 ⇒ withEnforce 计数（混合口径的自曝位）', () => {
        const r = buildGateWeekReport([
            msg('user-1', 'teacher01', [dec('a', 'allow')], false),
            msg('user-2', 'teacher02', [dec('b', 'allow')], true),
        ])
        assert.deepEqual(r.姿态混检, {observedOnly: 1, withEnforce: 1})
    })
    test('按天分桶用 insertTime 的日期（时序观察的最小仪器）', () => {
        const r = buildGateWeekReport([{
            conversationCode: 'user-1', operator: {userCode: 'teacher01'}, insertTime: new Date('2026-11-17T01:00:00Z'),
            extInfo: {gate: {enabled: true, enforce: false, decisions: [dec('a', 'allow'), dec('b', 'allow')]}},
        }])
        assert.deepEqual(r.按天, {'2026-11-17': 2})
    })
})
