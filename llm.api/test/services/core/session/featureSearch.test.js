/**
 * @fileOverview featureSearch 判据 + featureCatalogTool 壳真跑（刀2 用例面）
 * @module test/services/core/session/featureSearch.test
 * @description
 * 判据件穷举（打分/确定性排序/minScore/miss 单一形状）+ 壳用假 deps 真跑
 * （recoverCandidate/runFollowLoop 家规：会走 IO 的分支必须被真跑，不靠读文本）。
 * 壳的测试钉的是**编排纪律**：装配管道转调、权限合取、V7 三态、W6 存量 read 直通、审计容错。
 */
import { test, describe } from 'node:test'
import * as assert from 'node:assert/strict'
// 壳的顶层读 llm.logger（logger-only，userInfoDeadline 同法先注入最小全局再动态 import）
global.llm = global.llm || { tools: {}, logger: { warn() {}, info() {}, error() {} }, config: {} }
import { scoreEntry, searchFeatures, entryText } from '../../../../services/core/session/featureSearch.js'

const E = (over = {}) => ({ skillCode: 's1', title: '批量导出周报', description: '按模板导出', clientCode: 'learoad', ...over })

describe('featureSearch 判据', () => {
    test('整串包含 10 分打底；中文 2-gram 共现给相关性底分（"导出报告"命中"批量导出周报"不靠分词）', () => {
        const s = scoreEntry(E(), '导出报告')
        assert.ok(s >= 2 && s < 12, `共现应命中 minScore 但不及整串，实得 ${s}`)
        assert.ok(scoreEntry(E(), '批量导出周报') >= 10, '整串包含=最高档')
        assert.equal(scoreEntry({ title: '天气', description: 'weather', clientCode: 'w' }, '导出周报'), 0, '零共现=0 不硬凑')
    })
    test('空关键词/空文本 ⇒ 0（不硬凑）', () => {
        assert.equal(scoreEntry(E(), ''), 0)
        assert.equal(scoreEntry({ skillCode: 'x' }, 'anything'), 0)
    })
    test('排序确定性：同分按 skillCode 定序（进 prompt 的顺序必须可复现）', () => {
        const a = E({ skillCode: 'b-code' })
        const b = E({ skillCode: 'a-code' })
        const r = searchFeatures({ entries: [a, b], keyword: '批量导出周报' })
        assert.deepEqual(r.matched.map((x) => x.skillCode), ['a-code', 'b-code'])
    })
    test('minScore 截噪：弱重合不进 matched，但 miss 与"过滤后无"同一形状（V4 单一形状）', () => {
        const r = searchFeatures({ entries: [E({ title: '完全无关', description: 'xyz', skillCode: 'z' })], keyword: '导出周报' })
        assert.deepEqual(r, { matched: [], total: 0 })
        const empty = searchFeatures({ entries: [], keyword: '导出周报' })
        assert.deepEqual(empty, r, '无条目与全不相关返回同形——oracle 不留第二条缝')
    })
    test('matched 项只出目录内字段（引用面受控，模型没有自由生成入口的原料）', () => {
        const r = searchFeatures({ entries: [E({ entry: { url: '/sub/learoad#/export' }, effectClass: 'guide' })], keyword: '批量导出周报' })
        assert.deepEqual(Object.keys(r.matched[0]).sort(), ['clientCode', 'description', 'effectClass', 'entryUrl', 'score', 'skillCode', 'title'].sort().filter((k) => k !== 'clientCode'))
        assert.equal(r.matched[0].entryUrl, '/sub/learoad#/export')
    })
})

describe('featureCatalogTool 壳（假 deps 真跑）', () => {
    const row = (over = {}) => ({
        skillCode: 'sk-1', skillName: '周报导出', status: 0, reviewStatus: 'approved',
        channels: ['xxzx_common'], skillMD: '---\nname: w\ndescription: 按模板批量导出各类报告\n---\nbody',
        clientCode: 'learoad', effectClass: 'read', browseGate: false, featurePrivs: [], ...over,
    })
    const shell = async (deps) => {
        const m = await import('../../../../services/core/session/featureCatalogTool.js')
        return m.executeFeatureCatalogSearch({ keyword: '导出报告', userCode: 'u1', channel: 'xxzx_common', deps })
    }

    test('成功路径：装配管道产物→合取放行→matched 带目录字段', async () => {
        const ret = JSON.parse(await shell({
            readCatalogRows: async () => [row()],
            fetchGrants: async () => ({}),
        }))
        assert.equal(ret.matched.length, 1)
        assert.equal(ret.matched[0].skillCode, 'sk-1')
        assert.ok(ret.matched[0].description.includes('批量导出'))
    })
    test('V7 权限服务炸 ⇒ permission-service-unavailable，绝不洗成"没有功能"（matched 键都不出）', async () => {
        const ret = JSON.parse(await shell({
            readCatalogRows: async () => [row()],
            fetchGrants: async () => { throw new Error('ucenter down') },
        }))
        assert.equal(ret.status, 'permission-service-unavailable')
        assert.equal(ret.matched, undefined)
    })
    test('目录读取炸 ⇒ catalog-unreadable 第三态（三种失败形状互不冒充）', async () => {
        const ret = JSON.parse(await shell({ readCatalogRows: async () => { throw new Error('db down') } }))
        assert.equal(ret.status, 'catalog-unreadable')
    })
    test('W6/合取：browseGate=false 存量直通；缺失 browseGate 保守过门（给了 browse 即放行）', async () => {
        const ret = JSON.parse(await shell({
            readCatalogRows: async () => [
                row({ skillCode: 'legacy-1' }),
                row({ skillCode: 'gated-1', browseGate: undefined, clientCode: 'callin' }),
            ],
            fetchGrants: async ({ privs }) => (privs.includes('callin-browse') ? { 'callin-browse': true } : {}),
        }))
        const codes = ret.matched.map((m) => m.skillCode)
        assert.ok(codes.includes('legacy-1'))
        assert.ok(codes.includes('gated-1'), '缺失 browseGate 的行经保守门+granted 放行')
    })
    test('deny 面：browseGate 缺失且无 browse ⇒ 该行整体消失（miss 形状不留痕迹，V4+防线1）', async () => {
        const ret = JSON.parse(await shell({
            readCatalogRows: async () => [row({ skillCode: 'gated-2', browseGate: undefined, clientCode: 'secret' })],
            fetchGrants: async () => ({}),
        }))
        assert.equal(ret.matched.length, 0)
        assert.ok(ret.hint, 'miss 带统一提示（与"目录里根本没有"同形状）')
    })
    test('审计 sink 抛错不殃及检索（log-and-forget）', async () => {
        const ok = await shell({
            readCatalogRows: async () => [row()],
            fetchGrants: async () => ({}),
            auditSink: async () => { throw new Error('audit db down') },
        })
        assert.equal(JSON.parse(ok).matched.length, 1)
    })
    test('工具三件套形状：isFeatureCatalogTool 认名，build 定义含必填 keyword', async () => {
        const m = await import('../../../../services/core/session/featureCatalogTool.js')
        assert.equal(m.isFeatureCatalogTool(m.FEATURE_SEARCH_TOOL_NAME), true)
        assert.equal(m.isFeatureCatalogTool('other'), false)
        const tools = m.buildFeatureCatalogTools()
        assert.equal(tools[0].function.name, m.FEATURE_SEARCH_TOOL_NAME)
        assert.deepEqual(tools[0].function.parameters.required, ['keyword'])
    })
})
