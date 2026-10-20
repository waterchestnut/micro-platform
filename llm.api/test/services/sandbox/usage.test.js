import { test } from 'node:test'
import * as assert from 'node:assert'

global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {sandboxConfig: {}, sandboxQuota: {}},
    tools: {},
}

/* 只导入纯函数：dac 是惰性动态导入的，离线不会连 Mongo */
const {computeSeconds, buildUsageRecord, checkQuota, assertQuota, turnSandboxCost} =
    await import('../../../services/sandbox/usage.js')

test('秒数有下限和封顶，时钟回拨不会变成负数', () => {
    assert.equal(computeSeconds(1000, 2000), 1)
    assert.equal(computeSeconds(1000, 1400), 1, '亚秒间隔 round 归 0，下限 1 必须兜住（§5.30 真库行抓的）')
    assert.equal(computeSeconds(2000, 1000), 1, '回拨给 1 秒而不是 0 或负数')
    assert.equal(computeSeconds(0, 999999999999), 3600, '野值按 3600 封顶')
    assert.equal(computeSeconds(0, 10000, 5), 5, '可用 maxSeconds 调上限')
})

test('账本行按单价折算 price，并保留归属字段', () => {
    const t0 = 1700000000000
    const rec = buildUsageRecord({
        sandboxId: 'sb-1', userCode: 'u-1', conversationCode: 'c-1', channel: 'code_assistant',
        usedFor: 'run-code', startedAt: t0, endedAt: t0 + 30000,
        quotaCfg: {pricePerSecond: 0.0002, maxSecondsPerSandbox: 3600},
    })
    assert.equal(rec.sandboxId, 'sb-1')
    assert.equal(rec.seconds, 30)
    assert.equal(rec.price, 0.006)
    assert.equal(rec.userCode, 'u-1')
    assert.equal(rec.usedFor, 'run-code')
    assert.ok(rec.startedAt instanceof Date)
})

test('配额未开启就完全不拦（默认状态）', () => {
    const r = checkQuota({quota: {}, usedSeconds: 999999})
    assert.equal(r.ok, true)
})

test('窗口秒数配额是"已用 + 预扣"一起比，不是只看已用', () => {
    const q = {enabled: true, dailySecondsPerUser: 100, reserveSeconds: 60}
    assert.equal(checkQuota({quota: q, usedSeconds: 30}).ok, true)
    const over = checkQuota({quota: q, usedSeconds: 50})
    assert.equal(over.ok, false)
    assert.match(over.reason, /配额已用完/)
    assert.equal(over.limit, 100)
})

test('台数与活跃会话上限各自独立生效；活跃数只算本进程', () => {
    assert.equal(checkQuota({quota: {enabled: true, maxSandboxesPerUser: 3}, usedSandboxes: 3}).ok, false)
    const active = checkQuota({quota: {enabled: true, maxActiveConversations: 2}, activeConversations: 2})
    assert.equal(active.ok, false)
    assert.match(active.reason, /仅统计本进程/)
})

test('0 表示该项不限，不是"零容忍"', () => {
    const q = {enabled: true, dailySecondsPerUser: 0, maxSandboxesPerUser: 0, maxActiveConversations: 0}
    assert.equal(checkQuota({quota: q, usedSeconds: 1e9, usedSandboxes: 1e9, activeConversations: 1e9}).ok, true)
})

test('未开启配额时 assertQuota 不查库、turnSandboxCost 无会话返回 0', async () => {
    llm.config.sandboxQuota = {}
    assert.deepEqual(await assertQuota({userCode: 'u-1'}), {ok: true, reason: '', used: 0})
    assert.equal(await turnSandboxCost({}), 0)
})
