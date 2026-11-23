/**
 * @fileOverview featureManifest 对账判据穷举（platform-feature-map Phase 1 刀3）
 * @module test/services/core/session/featureManifest.test
 * @description
 * planReconcile 是本刀的全部风险面（执行壳是三段直写）——钉五条：
 * ①增改下线保持四分类完备无漏；②下线**只作用于装配中行**（pending 行缺席=stalePending 不重复下线）；
 * ③内容比较=声明字段全量（privs/门控/入口漂移都算变更，数组顺序不算）；
 * ④browseGate 归一比较（缺失 vs false 是"没登记"与"登记为公共"两种事实）；
 * ⑤skillCode 匹配键纪律（无键行/条目不进计划——壳层预检已拒，判据再兜底不炸）。
 */
import { test, describe } from 'node:test'
import * as assert from 'node:assert/strict'
import { planReconcile, diffManifestItem, stalePendingNote } from '../../../../services/core/skill/featureManifest.js'

const MD = '---\nname: a\ndescription: d\n---\nb'
const item = (over = {}) => ({ skillCode: 'c1', skillName: 'feat-a', skillMD: MD, channels: ['xxzx_common'], ...over })
const row = (over = {}) => ({ skillCode: 'c1', skillName: 'feat-a', skillMD: MD, channels: ['xxzx_common'], status: 0, reviewStatus: 'approved', ...over })

describe('planReconcile 四分类', () => {
    test('完全一致 ⇒ 全 keep，零计划', () => {
        const p = planReconcile({ rows: [row()], items: [item()] })
        assert.deepEqual(p.keep, ['c1'])
        assert.equal(p.toAdd.length + p.toUpdate.length + p.toOffline.length + p.stalePending.length, 0)
    })
    test('manifest 新增条目 ⇒ toAdd；库里多余 approved 行 ⇒ toOffline（僵尸条目主防线）', () => {
        const p = planReconcile({
            rows: [row(), row({ skillCode: 'gone', skillName: 'feat-gone' })],
            items: [item(), item({ skillCode: 'new1', skillName: 'feat-new' })],
        })
        assert.deepEqual(p.toAdd.map((x) => x.skillCode), ['new1'])
        assert.deepEqual(p.toOffline.map((x) => x.skillCode), ['gone'])
    })
    test('pending 行缺席 ⇒ stalePending 不是 toOffline（没在装配的东西不存在下线；不重复降级）', () => {
        const p = planReconcile({ rows: [row({ reviewStatus: 'pending' })], items: [] })
        assert.equal(p.toOffline.length, 0)
        assert.deepEqual(p.stalePending, ['c1'])
    })
    test('status 非 0（禁用行）缺席 ⇒ 也只 stalePending', () => {
        const p = planReconcile({ rows: [row({ status: 1 })], items: [] })
        assert.equal(p.toOffline.length, 0); assert.deepEqual(p.stalePending, ['c1'])
    })
})

describe('diffManifestItem：声明字段全量比较', () => {
    test('skillMD 正文漂移 ⇒ diff 含 skillMD', () => {
        assert.deepEqual(diffManifestItem(row(), item({ skillMD: MD + 'x' })), ['skillMD'])
    })
    test('功能级 privs/channels 漂移都算变更（权限与可见面变了必须重审）；数组顺序不算', () => {
        assert.ok(diffManifestItem(row(), item({ featurePrivs: ['p1', 'p2'] })).includes('featurePrivs'))
        assert.deepEqual(diffManifestItem(row({ featurePrivs: ['p1', 'p2'] }), item({ featurePrivs: ['p2', 'p1'] })), [], '顺序不该造成假变更')
        assert.ok(diffManifestItem(row(), item({ channels: ['other'] })).includes('channels'))
    })
    test('entry/invokeSpec/idemKeyPolicy 漂移（入口与调用面是目录内容的一部分）', () => {
        assert.ok(diffManifestItem(row(), item({ entry: { url: '/sub/x' } })).includes('entry'))
        assert.ok(diffManifestItem(row(), item({ invokeSpec: { api: 'a.b' } })).includes('invokeSpec'))
        assert.ok(diffManifestItem(row(), item({ idemKeyPolicy: 'explicit' })).includes('idemKeyPolicy'))
    })
    test('browseGate：缺失 vs false 是两种事实要报差异；缺失 vs undefined 不算（都是"没登记"）', () => {
        assert.ok(diffManifestItem(row(), item({ browseGate: false })).includes('browseGate'))
        assert.ok(diffManifestItem(row({ browseGate: false }), item({})).includes('browseGate'))
        assert.deepEqual(diffManifestItem(row({ browseGate: undefined }), item({ browseGate: undefined })), [])
    })
})

describe('匹配键兜底与 note', () => {
    test('无 skillCode 的行/条目不进计划（壳层预检的第一责任，判据兜底不炸）', () => {
        const p = planReconcile({ rows: [row(), { skillName: 'x' }], items: [{ skillName: 'y' }, item()] })
        assert.deepEqual(p.keep, ['c1'])
        assert.equal(p.toAdd.length, 0)
    })
    test('stalePendingNote 带 stamp 且话说清楚（批准者要能看懂"manifest 已经不要了"）', () => {
        const n = stalePendingNote('c1', 'v3')
        assert.ok(n.includes('manifest-stale:v3') && n.includes('回捞而非误批'))
        assert.ok(stalePendingNote('c1', '').includes('no-stamp'))
    })
})
