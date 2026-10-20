import { test } from 'node:test'
import * as assert from 'node:assert'

global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {kafka: {topics: {}}},
    tools: {},
}

const {partitionLags, verdictOf, startHeartbeat} = await import('../../../../services/core/memory/health.js')

test('partitionLags：end-committed；缺 committed 按 0；两边并集出分区', () => {
    const end = [{name: 't', partitions: [
        {partitionIndex: 0, offset: 100n},
        {partitionIndex: 1, offset: 50n},
        {partitionIndex: 2, offset: 7n},
    ]}]
    const com = [{groupId: 'g', topics: [{name: 't', partitions: [
        {partitionIndex: 0, committedOffset: 90n},
        {partitionIndex: 1, committedOffset: 50n},
    ]}]}]
    const lags = partitionLags(end, com, 't')
    assert.deepEqual(lags.map(l => l.partition), [0, 1, 2])
    assert.equal(lags[0].lag, 10)
    assert.equal(lags[1].lag, 0)
    assert.equal(lags[2].committed, 0, '无 committed 从 0 起算')
    assert.equal(lags[2].lag, 7)
})

test('partitionLags：主题不存在的查询返回空数组不炸', () => {
    assert.deepEqual(partitionLags([], [], 'nope'), [])
    assert.deepEqual(partitionLags(null, null, null), [])
})

test('verdictOf：大小写归一（broker 实测 STABLE/EMPTY 大写），全绿才 OK；其余逐项给可行动原因', () => {
    const base = {
        beat: {at: Date.now(), dlq: 0, counts: {processed: 3}},
        consumerAlive: true, groupState: 'Stable', members: 1,
        lags: [{partition: 0, end: 10, committed: 10, lag: 0}],
        thresholds: {lagWarn: 1000},
    }
    assert.equal(verdictOf(base).verdict, 'OK')
    assert.equal(verdictOf({...base, groupState: 'STABLE'}).verdict, 'OK', '大写 STABLE 必须认（dev 实测形态）')
    assert.equal(verdictOf(base).totalLag, 0)

    const dead = verdictOf({...base, consumerAlive: false})
    assert.notEqual(dead.verdict, 'OK')
    assert.ok(dead.reasons.some(r => r.includes('心跳')))

    const dlq = verdictOf({...base, beat: {at: Date.now(), dlq: 5}})
    assert.ok(dlq.reasons.some(r => r.includes('死信')))

    const rebal = verdictOf({...base, groupState: 'PreparingRebalance'})
    assert.ok(rebal.reasons.some(r => r.includes('PreparingRebalance')))

    const noMember = verdictOf({...base, members: 0})
    assert.ok(noMember.reasons.some(r => r.includes('成员数')))

    const bigLag = verdictOf({...base, lags: [{lag: 1500}], })
    assert.ok(bigLag.reasons.some(r => r.includes('lag')))
    assert.equal(bigLag.totalLag, 1500)

    const grpErr = verdictOf({...base, groupState: '', groupError: 'coordinator offline'})
    assert.ok(grpErr.reasons.some(r => r.includes('coordinator offline')))
})

test('startHeartbeat：写入 redis 的载荷含 at/pid/instanceTag/counts，stop 后停写', async () => {
    const writes = []
    const fakeRedis = {
        async setValue(k, v, ttl) { writes.push({k, json: JSON.parse(v), ttl}) },
    }
    const stop = startHeartbeat({redis: fakeRedis, instanceTag: 'probe', getCounts: () => ({processed: 7})})
    assert.equal(writes.length, 1, '启动即写第一跳（不等 30s）')
    assert.equal(writes[0].k, 'mem:cons:beat:memoryExtractor')
    assert.equal(writes[0].ttl, 90)
    assert.equal(writes[0].json.instanceTag, 'probe')
    assert.equal(writes[0].json.counts.processed, 7)
    stop()
    const n = writes.length
    await new Promise(r => setTimeout(r, 50))
    assert.equal(writes.length, n, 'stop 后不再写')
})

test('startHeartbeat：redis 抛错不影响心跳函数返回（消费进程绝不能因探针挂）', async () => {
    const boom = {async setValue() { throw new Error('redis down') }}
    const stop = startHeartbeat({redis: boom, instanceTag: 'x', getCounts: () => ({})})
    assert.equal(typeof stop, 'function')
    stop()
})
