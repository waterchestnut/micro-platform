/**
 * @fileOverview artifact 对账执行壳的离线用例（假 dac/假核验走真编排函数体）
 * @module test/tasks/artifactReconcile
 * @description
 * 钉的点与 sleepTimeConsolidate.test 同族：默认干跑、先校验后抢锁、锁必还、
 * 两扫描并集的去重、graceMs→olderThan 的换算、messageCode 引用面的当前语义，
 * 再各钉一条本刀特有的：**矛盾行经完整链路后 unregister 永远 deferred**（两重白名单）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'

global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {},
    tools: {},
}

const mod = await import('../../tasks/artifactReconcile.js')
const {artifactReconcileRunPlan, runArtifactReconcile} = mod

const NOW = 1763200000000
const iso = (ms) => new Date(ms).toISOString()

const makeDeps = ({stalled = [], handleMissing = [], acquire = true} = {}) => {
    const calls = {scanStalled: [], scanHandleMissing: [], mark: [], unreg: [], tomb: [], verify: [], acquire: 0, release: 0}
    return {calls, deps: {
        scanStalled: async (olderThan, limit) => {
            calls.scanStalled.push({olderThan: new Date(olderThan).getTime(), limit})
            return stalled
        },
        scanHandleMissing: async (olderThan, limit) => {
            calls.scanHandleMissing.push({olderThan: new Date(olderThan).getTime(), limit})
            return handleMissing
        },
        setIntegrity: async (artifactCode, mark) => { calls.mark.push([artifactCode, mark]) },
        markUnregistered: async (artifactCode) => { calls.unreg.push(artifactCode) },
        tombstoneDocFile: async ({fileCode, artifactCode}) => { calls.tomb.push([artifactCode, fileCode]) },
        verifyDocFile: async (fc) => { calls.verify.push(fc); return true },
        acquireOnce: async () => { calls.acquire++; return acquire },
        releaseLock: async () => { calls.release++ },
    }}
}
const stalledRow = (code, over = {}) => ({artifactCode: code, state: 'uploaded', fileCode: `fc-${code}`, insertTime: iso(NOW - 60 * 60000), ...over})
const ghostRow = (code, over = {}) => ({artifactCode: code, state: 'registered', fileCode: '', insertTime: iso(NOW - 60 * 60000), ...over})

describe('1 runPlan：默认与阀', () => {
    test('全缺配置 ⇒ 干跑 + 10 分钟宽限 + 200 行上限', () => {
        const p = artifactReconcileRunPlan({})
        assert.equal(p.ok, true)
        assert.equal(p.enforce, false)
        assert.equal(p.graceMs, 600000)
        assert.equal(p.limit, 200)
    })
    test('enforce 严格布尔：字符串 "true" 不算动手', () => {
        assert.equal(artifactReconcileRunPlan({cronConfig: {artifactReconcileEnforce: true}}).enforce, true)
        assert.equal(artifactReconcileRunPlan({cronConfig: {artifactReconcileEnforce: 'true'}}).enforce, false)
    })
    test('宽限低于一次大文件 intake 的量级 ⇒ 拒绝（把在途当孤儿回收的同族事故，不许出厂）', () => {
        for (const bad of [0, 60000, 600000 - 1, -5, 'x']) {
            const p = artifactReconcileRunPlan({overrides: {graceMs: bad}})
            assert.equal(p.ok, false, `graceMs=${bad} 必须被拦`)
            assert.equal(p.enforce, false, '拦下时不许给动手许可')
        }
        assert.equal(artifactReconcileRunPlan({overrides: {graceMs: 30 * 60000}}).ok, true, '更宽的宽限是保守方向：放行')
        assert.equal(artifactReconcileRunPlan({overrides: {limit: 0}}).ok, false)
    })
})

describe('2 runArtifactReconcile：顺序、并集与白名单', () => {
    test('先校验后抢锁：阀拒绝时 acquireOnce 一次都不碰', async () => {
        const {deps, calls} = makeDeps()
        const r = await runArtifactReconcile({deps, graceMs: 1000})
        assert.equal(r.skipped, 'invalid-plan')
        assert.equal(calls.acquire, 0)
    })
    test('锁占用 ⇒ 跳过、不扫描、不还没拿到的锁', async () => {
        const {deps, calls} = makeDeps({acquire: false})
        const r = await runArtifactReconcile({deps, now: NOW})
        assert.equal(r.skipped, 'lock-held')
        assert.equal(calls.scanStalled.length, 0)
        assert.equal(calls.release, 0)
    })
    test('两扫描并集按 artifactCode 去重；olderThan=now-grace 换算到位；默认干跑零动作', async () => {
        const stalled = [stalledRow('a1'), stalledRow('dup')]
        const ghosts = [ghostRow('g1'), ghostRow('dup')]
        const {deps, calls} = makeDeps({stalled, handleMissing: ghosts})
        const r = await runArtifactReconcile({deps, now: NOW})
        assert.equal(r.scanned, 3, 'a1/g1/dup——dup 两边都捞到也只进一次')
        assert.equal(calls.scanStalled[0].olderThan, NOW - 600000)
        assert.equal(calls.scanHandleMissing[0].olderThan, NOW - 600000)
        assert.equal(r.dryRun, true)
        assert.equal(r.executedAll, 0)
        assert.equal(calls.mark.length, 0)
        assert.equal(r.counts['inconsistent-record'], 1)
    })
    test('enforce：孤儿回收走 tombstone、矛盾行 mark-broken，但 unregister 永远 deferred（两重门）', async () => {
        const {deps, calls} = makeDeps({stalled: [stalledRow('a1')], handleMissing: [ghostRow('g1')]})
        const r = await runArtifactReconcile({deps, now: NOW, enforce: true})
        assert.equal(r.dryRun, false)
        assert.ok(calls.tomb.some(([c]) => c === 'a1'), 'allocated∧¬registered 的回收动作真的走到了注入的 tombstone')
        assert.deepEqual(calls.mark, [['g1', 'broken']])
        assert.ok(!calls.unreg.includes('g1'), 'enforce 也不能自动注销矛盾行——判断类的 ? 门与白名单是两重')
        assert.ok(calls.unreg.includes('a1'), '孤儿行的 drop-allocation-ledger 落库形态=markUnregistered（从未登记过的行，清账不是撤 exposing）')
        const gPlan = r.plans.find((p) => p.artifactCode === 'g1')
        assert.ok(gPlan.deferred.includes('unregister-artifact?'))
    })
    test('引用面当前语义：行上挂了 messageCode ⇒ 保护（不删不注销，只标失效）', async () => {
        const {deps, calls} = makeDeps({handleMissing: [ghostRow('g2', {messageCode: 'm-1'})]})
        const r = await runArtifactReconcile({deps, now: NOW, enforce: true})
        const p = r.plans.find((x) => x.artifactCode === 'g2')
        assert.equal(p.klass, 'protected')
        assert.deepEqual(calls.mark, [['g2', 'broken']])
    })
    test('核验只对有把手的行发（ghost 行零 verify——没有 fileCode 就没有"文件在不在"这回事）', async () => {
        const {deps, calls} = makeDeps({stalled: [stalledRow('a2')], handleMissing: [ghostRow('g3')]})
        await runArtifactReconcile({deps, now: NOW, enforce: true})
        assert.deepEqual(calls.verify, ['fc-a2'])
    })
    test('中途抛错也必还锁（finally 纪律）', async () => {
        const {deps, calls} = makeDeps()
        deps.scanStalled = async () => { throw new Error('mongo 抖了一下') }
        await assert.rejects(() => runArtifactReconcile({deps, now: NOW}))
        assert.equal(calls.release, 1)
    })
})
