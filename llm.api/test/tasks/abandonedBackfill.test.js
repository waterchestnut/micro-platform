import {test, describe} from 'node:test'
import * as assert from 'node:assert'

/**
 * 任务层需要 `llm` 全局（模块加载时就读 `llm.logger`/`llm.config`），
 * 沿用仓库里其它离线用例的形状：先立全局，再动态 import 被测模块。
 */
global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {},
    tools: {},
}

const mod = await import('../../tasks/abandonedBackfill.js')
const {backfillRunPlan, runBackfill} = mod
const {DEFAULT_OLDER_THAN_MS} = await import('../../daos/core/policy/llmUsagePolicy.js')

/**
 * 这一层只测"这次到底怎么跑"的决定。
 * 之所以值得单独测：这些默认值就是事故面——`dryRun` 站错边，
 * 一个还没复核过的写库动作就会在所有环境同时上线。
 */
describe('backfillRunPlan', () => {
    test('配置缺失 ⇒ 只出计划（默认值必须站在"不动数据"那一边）', () => {
        const p = backfillRunPlan({cronConfig: {}, overrides: {}})
        assert.equal(p.ok, true)
        assert.equal(p.dryRun, true)
        assert.equal(p.olderThanMs, DEFAULT_OLDER_THAN_MS)
        assert.equal(p.limit, 200)
    })

    test('backfillWrite=true 才允许写库', () => {
        assert.equal(backfillRunPlan({cronConfig: {backfillWrite: true}}).dryRun, false,
            '两道开关的第二道：开了定时不等于开始写')
        assert.equal(backfillRunPlan({cronConfig: {backfillWrite: 'true'}}).dryRun, true,
            '字符串 "true" 不算开：配置类型不严判就会静默走成另一条路（`FASTIFY_CLOSE_GRACE_DELAY` 同因）')
    })

    test('调用方显式 dryRun 优先于配置（人工复查时要能强制只看）', () => {
        assert.equal(backfillRunPlan({cronConfig: {backfillWrite: true}, overrides: {dryRun: true}}).dryRun, true)
    })

    test('阈值小于最长 run 墙钟的 3 倍 ⇒ 拒绝执行，不给出可写的计划', () => {
        for (const bad of [1000, 30000, 60000, 0, -1, 'abc']) {
            const p = backfillRunPlan({overrides: {olderThanMs: bad}})
            assert.equal(p.ok, false, `olderThanMs=${bad} 必须被安全阀拦下`)
            assert.equal(p.dryRun, true, '拦下时不能给出写库许可')
            assert.match(p.reason, /3 倍|正数毫秒/)
        }
    })

    test('阈值从 config 取，显式 params 覆盖它', () => {
        assert.equal(backfillRunPlan({cronConfig: {backfillOlderThanMs: 1200000}}).olderThanMs, 1200000)
        assert.equal(backfillRunPlan({cronConfig: {backfillOlderThanMs: 1200000}, overrides: {olderThanMs: 2000000}}).olderThanMs, 2000000)
        assert.equal(backfillRunPlan({cronConfig: {backfillLimit: 7}}).limit, 7)
    })
})

describe('runBackfill 的拒绝路径', () => {
    test('阈值不合法时直接返回，**不去抢锁**（先校验后加锁的顺序必须钉住）', async () => {
        const r = await runBackfill({olderThanMs: 1000})
        assert.equal(r.skipped, 'invalid-olderThanMs')
        assert.match(r.reason, /3 倍|正数毫秒/)
        /**
         * 这条用例同时是"没连 redis 也能跑"的证明：
         * 校验发生在 acquireOnce 之前，所以离线单测不会因为这个任务而需要真环境。
         */
    })
})
