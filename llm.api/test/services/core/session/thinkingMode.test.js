/**
 * @fileOverview thinkingMode 的穷举用例（D44 的"不得由 bug 默认决定"要能被核对）
 * @module test/services/core/session/thinkingMode
 * @description
 * 这组用例分两类：
 * A. **行为等价类**：决策必须与改造前那句 `options.enableThinking && llmConfig.enableThinking ? ... : {enable_thinking:false}`
 *    逐值一致——本模块不许在"加留痕"的名义下偷改线上行为；
 * B. **留痕语义类**：三层来源（请求表态 / 档位配置 / 最终生效）必须分开可见，
 *    否则一年后还是没人答得得"那批 run 到底有没有思考"。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    decideThinking, normalizeRequested, profileConfigured, thinkingForArchive,
    THINKING_REQUESTED, THINKING_EFFECTIVE,
} from '../../../../services/core/session/thinkingMode.js'

/** 改造前的原始判据，逐字搬来当参照物（等价性断言用它，不靠我口头保证） */
function legacyBody(requested, profile) {
    return requested && profile ? profile : {enable_thinking: false}
}

describe('normalizeRequested：三种可能，不趁机收紧真值语义', () => {
    test('boolean 与 number 都按 JS 真值（与现状同一口径）', () => {
        assert.equal(normalizeRequested(true), THINKING_REQUESTED.ON)
        assert.equal(normalizeRequested(false), THINKING_REQUESTED.OFF)
        assert.equal(normalizeRequested(1), THINKING_REQUESTED.ON)
        assert.equal(normalizeRequested(0), THINKING_REQUESTED.OFF)
        assert.equal(normalizeRequested(2), THINKING_REQUESTED.ON, '现状是 truthy ⇒ 这里不许偷偷只认 0/1')
    })
    test('未传与非法类型 ⇒ unset（schema 会挡，但异常路径要诚实）', () => {
        for (const v of [undefined, null, 'true', '', {}, []]) {
            assert.equal(normalizeRequested(v), THINKING_REQUESTED.UNSET)
        }
        assert.equal(normalizeRequested(), THINKING_REQUESTED.UNSET)
    })
})

describe('profileConfigured：空对象算"配过"，因为现状真的会走那一支', () => {
    test('对象与空对象都是真', () => {
        assert.equal(profileConfigured({enable_thinking: true}), true)
        assert.equal(profileConfigured({}), true, '现状 `profile ? ...` 对 {} 为真 ⇒ 改成 false 会改变请求体')
    })
    test('未配置与非对象都是假；数组按现状算"配过"', () => {
        for (const v of [undefined, null, 0, 1, 'x']) {
            assert.equal(profileConfigured(v), false)
        }
        /** `[]` 在 legacy 那句 `profile ? ...` 里是真，展开后一个参数都不发 ⇒ 判成 false 会改变那一支的请求体 */
        assert.equal(profileConfigured([]), true)
    })
})

describe('decideThinking：与改造前那句 && 逐值等价', () => {
    const cases = [
        {requested: true, profile: {enable_thinking: true, reasoning_effort: 'low'}},
        {requested: 1, profile: {enable_thinking: true}},
        {requested: 0, profile: {enable_thinking: true}},
        {requested: false, profile: {enable_thinking: true}},
        {requested: true, profile: undefined},
        {requested: true, profile: {}},
        {requested: undefined, profile: {enable_thinking: true}},
        {requested: undefined, profile: undefined},
        {requested: 2, profile: {enable_thinking: true}},
    ]
    for (const [i, c] of cases.entries()) {
        test(`等价 #${i} requested=${String(c.requested)} profile=${JSON.stringify(c.profile)}`, () => {
            const d = decideThinking(c)
            assert.deepEqual(d.params, legacyBody(c.requested, c.profile))
        })
    }
    /**
     * 唯一一处**刻意不等价**：schema 之外的类型（字符串/对象）。
     * legacy 那句是 JS 真值判断，`'true'` 会打开思考；但 `chatStreamSchema.js` 的
     * `type: ['boolean','number']` 会先把这种请求 400 掉，那一支线上不可达。
     * 这里给它 `unset`（关），因为"照抄一个不可达且语义错误的分支"不是兼容性，是共谋。
     * 写在明处而不是藏在实现里：哪天 schema 放宽，这条断言会先叫。
     */
    test('不可达分支的分歧：字符串在 legacy 里是开、在这里是未表态（schema 已 400 挡在前面）', () => {
        const d = decideThinking({requested: 'true', profile: {enable_thinking: true}})
        assert.equal(d.effective, THINKING_EFFECTIVE.OFF)
        assert.equal(d.requested, THINKING_REQUESTED.UNSET)
        assert.notDeepEqual(d.params, legacyBody('true', {enable_thinking: true}), '这处分歧是刻意的，改等价要先看上面那段理由')
    })
    test('dev 现状（请求 0 + 档位未配）⇒ 明确 off，且三层都能看出来', () => {
        const d = decideThinking({requested: 0, profile: undefined, modelKey: 'relay_common_pro'})
        assert.equal(d.requested, THINKING_REQUESTED.OFF)
        assert.equal(d.profileConfigured, false)
        assert.equal(d.effective, THINKING_EFFECTIVE.OFF)
        assert.deepEqual(d.params, {enable_thinking: false})
        assert.equal(d.modelKey, 'relay_common_pro')
    })
    test('运维配好档位但前端仍发 0 ⇒ 依然 off（这正是三端硬编码的后果）', () => {
        const d = decideThinking({requested: 0, profile: {enable_thinking: true}})
        assert.equal(d.effective, THINKING_EFFECTIVE.OFF)
        assert.equal(d.profileConfigured, true, '档位配了但被请求侧短路 ⇒ 留痕必须能区分这两种"关"')
    })
    test('前端没表态（未传）而档位配了 ⇒ 也是 off；留痕要写成 unset 而不是"用户拒绝"', () => {
        const d = decideThinking({requested: undefined, profile: {enable_thinking: true}})
        assert.equal(d.requested, THINKING_REQUESTED.UNSET)
        assert.equal(d.effective, THINKING_EFFECTIVE.OFF)
    })
    test('空对象档位 + 请求开 ⇒ 生效"开"但不发任何思考参数（可疑但如实记录）', () => {
        const d = decideThinking({requested: true, profile: {}})
        assert.equal(d.effective, THINKING_EFFECTIVE.ON)
        assert.deepEqual(d.params, {})
    })
    test('缺参调用不抛', () => {
        const d = decideThinking()
        assert.equal(d.effective, THINKING_EFFECTIVE.OFF)
        assert.equal(d.modelKey, '')
    })
})

describe('thinkingForArchive：缺决策写 null，不冒充"查过"', () => {
    test('有决策 ⇒ 四字段齐，params 不落档（上游参数原文没有排查价值）', () => {
        const a = thinkingForArchive(decideThinking({requested: 1, profile: {enable_thinking: true}, modelKey: 'm1'}))
        assert.deepEqual(a, {requested: 'on', profileConfigured: true, effective: 'on', modelKey: 'm1'})
        assert.ok(!('params' in a), 'params 不该进档案')
    })
    test('null / undefined / 非对象 ⇒ null', () => {
        for (const v of [null, undefined, 'x', 42, []]) {
            assert.equal(thinkingForArchive(v), null)
        }
        assert.equal(thinkingForArchive(), null)
    })
    test('profileConfigured 缺失时归一成 false（缺键不等于 true，也不留 undefined）', () => {
        const a = thinkingForArchive({requested: 'off', effective: 'off'})
        assert.equal(a.profileConfigured, false)
        assert.equal(a.modelKey, '')
    })
})
