import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * 投影 ↔ 读字段 的漂移守卫。
 *
 * 起因是一条**真实存在过的缺陷**：`LlmUsageDac.listAbandoned` 的 `.select()` 里没有 `progress`，
 * 于是 `planBackfill` 拿到的 `row.progress === undefined`，`isAbandonedRun` 第一句就判假，
 * dev 上 9 条候选**全部**被贴上 `heartbeat-fresh` 跳过 —— 回填功能实际是死的，日志却毫无异常。
 * 是我拿"计划视图 vs 任务层两个相互矛盾的读数"去把那 9 行的真实字段打出来才发现的。
 *
 * 为什么这里用**读源码文本**而不是 import DAC：`daos/core/schema/index.js` 是顶层 await 建连接，
 * 任何 import 它的测试都会去连真实 Mongo（本仓现有测试也从不 import dac）。
 * 这条守卫要防的是"以后有人改投影漏字段"，源码级比对足够，且不引入连接。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const dacSrc = fs.readFileSync(path.join(here, '../../../../daos/core/dac/llmUsageDac.js'), 'utf8')

const {BACKFILL_ROW_FIELDS, planBackfill} = await import('../../../../services/core/session/abandonedBackfill.js')
const {DEFAULT_OLDER_THAN_MS} = await import('../../../../daos/core/policy/llmUsagePolicy.js')

/**
 * @description 从源码里取 LIST_ABANDONED_SELECT 的键集合
 * @returns {Array<String>} 键
 */
function selectKeys() {
    const i = dacSrc.indexOf('export const LIST_ABANDONED_SELECT = {')
    assert.ok(i >= 0, '找不到 LIST_ABANDONED_SELECT 的定义 ⇒ 它被改名或删掉了，守卫必须失效报警')
    const body = dacSrc.slice(i, dacSrc.indexOf('\n}', i))
    return [...new Set([...body.matchAll(/([A-Za-z_][\w]*)\s*:\s*1/g)].map(m => m[1]))]
}

describe('listAbandoned 投影与回填读字段的绑定', () => {
    test('服务层读的每个字段都必须在投影里（缺 progress 那次就是死在这里）', () => {
        const keys = selectKeys()
        const missing = BACKFILL_ROW_FIELDS.filter(f => !keys.includes(f))
        assert.deepEqual(missing, [], `投影缺这些字段 ⇒ 回填会静默失效：${missing.join(', ')}`)
    })

    test('守卫本身必须真的能看见 progress（防止它靠"两边同时缺"蒙过第一条）', () => {
        assert.ok(selectKeys().includes('progress'))
        assert.ok(selectKeys().includes('estPromptTokens'))
        // usage 快照面的键也要两边同时在位（少一边=另一条"缺 progress"式静默失效）
        for (const k of ['promptTokens', 'completionTokens', 'totalTokens', 'credits', 'creditsPriced']) {
            assert.ok(BACKFILL_ROW_FIELDS.includes(k), `BACKFILL_ROW_FIELDS 缺 ${k}`)
            assert.ok(selectKeys().includes(k), `投影缺 ${k} ⇒ 快照会静默丢这个真值`)
        }
    })
})

const {backfillUsageSnapshot} = await import('../../../../services/core/session/abandonedBackfill.js')

describe('backfillUsageSnapshot：终态冻结行的真值复制（三种事实三种形状，都不造数）', () => {
    test('首 token 前就死 ⇒ {hasUsage:false}——三端"模型开始输出前已取消"归因的凭据，不许缺键落回笼统句', () => {
        assert.deepEqual(backfillUsageSnapshot({modelCalls: 1, estPromptTokens: 800}), {hasUsage: false, modelCalls: 1})
        assert.deepEqual(backfillUsageSnapshot({}), {hasUsage: false, modelCalls: 0})
    })
    test('有真值 ⇒ tokens/credits 照抄；credits 缺席不写键（null 不是 0）；creditsPriced 严格 ===true', () => {
        const s = backfillUsageSnapshot({promptTokens: 100, completionTokens: 40, totalTokens: 140, modelCalls: 2, credits: 140, creditsPriced: false})
        assert.deepEqual(s, {hasUsage: true, modelCalls: 2, promptTokens: 100, completionTokens: 40, totalTokens: 140, credits: 140, creditsPriced: false})
        const noCredits = backfillUsageSnapshot({promptTokens: 7, completionTokens: 0})
        assert.equal('credits' in noCredits, false, '行上没有 credits 列（历史行）⇒ 不写键，别用 0 冒充"算过且免费"')
        assert.equal(noCredits.completionTokens, 0, '0 是"上游没回传 completion"的真值时照抄——注意与"键缺席"是两种事实')
        assert.equal('totalTokens' in noCredits, false, 'total 缺席不许 p+c 派生（D66：同一数字第二套口径）')
    })
    test('脏值（负数/非数/字符串数字）⇒ 收敛：数字串照收，负数/NaN 当缺席', () => {
        const s = backfillUsageSnapshot({promptTokens: '50', completionTokens: -1, totalTokens: 'x'})
        assert.equal(s.hasUsage, true)
        assert.equal(s.promptTokens, 50)
        assert.equal('completionTokens' in s, false)
        assert.equal('totalTokens' in s, false)
    })
})

describe('planBackfill 两支都挂 usage 快照（同一函数，不许一支忘）', () => {
    const old = new Date(Date.now() - DEFAULT_OLDER_THAN_MS * 3)
    const row = {messageCode: 'm1', conversationCode: 'c1', userCode: 'u1', progress: 'processing', updateTime: old, modelCalls: 1, estPromptTokens: 2, promptTokens: 900, completionTokens: 100, totalTokens: 1000, credits: 1000, creditsPriced: false}

    test('flip 支（档案 processing 行原地翻）带 extInfo.usage', () => {
        const p = planBackfill({row, hasArchive: true, archiveProgress: 'processing', now: Date.now})
        assert.equal(p.mode, 'flip')
        assert.deepEqual(p.fields['extInfo.usage'], {hasUsage: true, modelCalls: 1, promptTokens: 900, completionTokens: 100, totalTokens: 1000, credits: 1000, creditsPriced: false})
    })
    test('add 支（纯遗弃补档）带 extInfo.usage；死在首帧前的行是 hasUsage:false', () => {
        const p = planBackfill({row, hasArchive: false, checkpoint: null, now: Date.now})
        assert.deepEqual(p.fields.extInfo.usage, {hasUsage: true, modelCalls: 1, promptTokens: 900, completionTokens: 100, totalTokens: 1000, credits: 1000, creditsPriced: false})
        const dead = planBackfill({row: {...row, promptTokens: undefined, completionTokens: undefined}, hasArchive: false, checkpoint: null, now: Date.now})
        assert.deepEqual(dead.fields.extInfo.usage, {hasUsage: false, modelCalls: 1})
    })
})

describe('planBackfill 的跳过理由必须能区分病因', () => {    const old = new Date(Date.now() - DEFAULT_OLDER_THAN_MS * 3)
    const base = {messageCode: 'm1', conversationCode: 'c1', userCode: 'u1', updateTime: old, modelCalls: 1, estPromptTokens: 2}

    test('progress 字段缺失 ⇒ not-processing:missing（旧实现会报成无害的 heartbeat-fresh）', () => {
        const row = {...base}
        delete row.progress
        const p = planBackfill({row, hasArchive: false, checkpoint: null, now: Date.now})
        assert.equal(p.action, 'skip')
        assert.equal(p.reason, 'not-processing:missing')
    })

    test('progress 是别的终态 ⇒ not-processing:<值>，不与心跳混为一谈', () => {
        const p = planBackfill({row: {...base, progress: 'finish'}, hasArchive: false, checkpoint: null, now: Date.now})
        assert.equal(p.reason, 'not-processing:finish')
    })

    test('progress 对但心跳还新 ⇒ 才是真的 heartbeat-fresh', () => {
        const p = planBackfill({
            row: {...base, progress: 'processing', updateTime: new Date()},
            hasArchive: false, checkpoint: null, now: Date.now,
        })
        assert.equal(p.reason, 'heartbeat-fresh')
    })

    test('形状正确的遗弃行 ⇒ 进入回填，且 writtenBy=backfill、正文为空', () => {
        const p = planBackfill({row: {...base, progress: 'processing'}, hasArchive: false, checkpoint: null, now: Date.now})
        assert.equal(p.action, 'backfill')
        assert.equal(p.fields.answer, '')
        assert.equal(p.fields.progress, 'abort')
        assert.equal(p.fields.extInfo.writtenBy, 'backfill')
    })
})
