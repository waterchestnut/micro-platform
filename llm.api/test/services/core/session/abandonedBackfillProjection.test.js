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
    })
})

describe('planBackfill 的跳过理由必须能区分病因', () => {
    const old = new Date(Date.now() - DEFAULT_OLDER_THAN_MS * 3)
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
