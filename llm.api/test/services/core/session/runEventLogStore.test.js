import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    createRunEventMirror, readRunEventLog, eventKey, DEFAULT_KEY_PREFIX, GAP_CODE,
} from '../../../../services/core/session/runEventLogStore.js'
import {createFakeRedis} from '../../../helper/fakeRedis.js'

/**
 * Redis 承载（跨副本续接的数据面）。
 *
 * 最要紧的三条断言：
 * 1. 镜像失败**绝不影响回答**（fail-open，只计数）；
 * 2. 镜像丢帧/被截断必须变成**可检出的 gap**，而不是"看起来通顺但少了内容"的半截回答；
 * 3. 攒批省的是**往返**，不是条数——用例把这两件事分别钉住，免得下一个人把 pipeline 当"合并写入"删掉。
 */

/**
 * @description 造镜像
 * @param {Object} [opt] 选项
 * @returns {Object} {mirror, redis, key}
 */
function mkMirror(opt = {}) {
    const redis = opt.redis || createFakeRedis()
    const mirror = createRunEventMirror({
        getClient: async () => (opt.noClient ? null : redis),
        messageCode: 'mc-1',
        cfg: {flushEvery: opt.flushEvery ?? 25, flushMs: 0, ttlSec: opt.ttlSec ?? 120, maxEvents: opt.maxEvents ?? 2000, keyPrefix: opt.keyPrefix},
    })
    return {mirror, redis, key: eventKey('mc-1', opt.keyPrefix)}
}

describe('键与容量', () => {
    test('键格式带前缀与本轮标识', () => {
        assert.equal(eventKey('mc-9'), `${DEFAULT_KEY_PREFIX}:{mc-9}`)
        assert.equal(eventKey('mc-9', 'x'), 'x:{mc-9}')
    })

    test('MAXLEN 会把最老的挤出去（读侧要能发现）', async () => {
        const redis = createFakeRedis()
        for (let i = 1; i <= 6; i++) {
            await redis.xadd('k', 'MAXLEN', '~', 3, '*', 'seq', String(i), 'event', 'delta', 'data', 'x')
        }
        const raw = await redis.xrange('k')
        assert.deepEqual(raw.map(([, f]) => Number(f[1])), [4, 5, 6], `应只留最近 3 条，实际 ${JSON.stringify(raw.map(f => f[1]))}`)
    })
})

describe('写侧：攒批与收尾', () => {
    test('flushEvery 之前不写，达到就写一次管道（省往返不省条数）', async () => {
        const {mirror, redis} = mkMirror({flushEvery: 3})
        mirror.onEvent(1, 'delta', 'a')
        mirror.onEvent(2, 'delta', 'b')
        assert.equal(redis.calls.xadd, 0, '还没到批大小')
        mirror.onEvent(3, 'delta', 'c')
        await new Promise(r => setImmediate(r))
        assert.equal(redis.calls.pipelines, 1, '一批只发一次管道')
        assert.equal(redis.calls.xadd, 3, '条数不能因为攒批而减少：少一条就是丢帧')
        const s = mirror.stats()
        assert.equal(s.queued, 3)
        assert.equal(s.written, 3)
    })

    test('显式 flush 把零头写出去', async () => {
        const {mirror, redis} = mkMirror({flushEvery: 100})
        mirror.onEvent(1, 'meta', 'm')
        const n = await mirror.flush()
        assert.equal(n, 1)
        assert.equal(redis.calls.xadd, 1)
    })

    test('finish 写终结标记、续 TTL，并带上 finalSeq/outcome', async () => {
        const {mirror, redis, key} = mkMirror({flushEvery: 100, ttlSec: 77})
        mirror.onEvent(1, 'delta', 'a')
        mirror.onEvent(2, 'delta', 'b')
        const ret = await mirror.finish({finalSeq: 2, outcome: 'abort'})
        assert.equal(ret.flushed, 2)
        const raw = await redis.xrange(key)
        const end = raw.map(([, f]) => ({seq: Number(f[1]), event: f[3], data: f[5]})).find(x => x.event === '__end__')
        assert.deepEqual(end, {seq: 2, event: '__end__', data: 'abort'})
        assert.equal(redis.ttls.get(key), 77, 'TTL 必须在收尾时定下来，否则空键留在库里')
        assert.equal(mirror.stats().finished, true)
    })

    test('finish 之后的事件被丢弃并计数（收尾顺序错了要看得见）', async () => {
        const {mirror, redis} = mkMirror({flushEvery: 1})
        mirror.onEvent(1, 'delta', 'a')
        await new Promise(r => setImmediate(r))
        await mirror.finish({finalSeq: 1, outcome: 'done'})
        mirror.onEvent(2, 'delta', 'b')
        assert.equal(mirror.stats().droppedAfterFinish, 1)
        assert.equal(redis.calls.xadd, 2, '一条正文 + 一条 __end__，不该有第三条')
    })

    test('拿不到客户端时静默降级，绝不抛', async () => {
        const {mirror} = mkMirror({noClient: true})
        assert.doesNotThrow(() => {
            mirror.onEvent(1, 'delta', 'a')
        })
        const ret = await mirror.finish({finalSeq: 1})
        assert.ok(ret.failed >= 1, '写不成要计数，不能假装成功')
        assert.equal(ret.written, 0)
    })

    test('redis 写失败只计数（镜像不是聊天路径的依赖）', async () => {
        const redis = createFakeRedis({throwOnWrite: true})
        const {mirror} = mkMirror({redis, flushEvery: 1})
        assert.doesNotThrow(() => mirror.onEvent(1, 'delta', 'a'))
        await new Promise(r => setImmediate(r))
        const s = mirror.stats()
        assert.equal(s.written, 0)
        assert.ok(s.failed >= 1, `失败必须可见，实际 ${JSON.stringify(s)}`)
    })

    test('每次管道都顺带续 TTL：长跑的一轮不会中途键过期', async () => {
        const {mirror, redis} = mkMirror({flushEvery: 2, ttlSec: 30})
        mirror.onEvent(1, 'delta', 'a')
        mirror.onEvent(2, 'delta', 'b')
        await new Promise(r => setImmediate(r))
        assert.equal(redis.ttls.get(eventKey('mc-1')), 30)
    })
})

describe('命令形状：maxEvents 是"约"而非硬条数', () => {
    test('我们发的是近似修剪（MAXLEN ~ N），改成精确必须是有意识的动作', async () => {
        const redis = createFakeRedis()
        const {mirror} = mkMirror({redis, flushEvery: 1, maxEvents: 777})
        mirror.onEvent(1, 'delta', 'a')
        await new Promise(r => setImmediate(r))
        const args = redis.lastXadd.args.map(String)
        assert.deepEqual(args.slice(0, 4), ['MAXLEN', '~', '777', '*'],
            `命令形状变了：${JSON.stringify(args.slice(0, 4))}`)
        /**
         * 为什么钉这个形状：dev 实测证明 `~` 在小流上几乎不裁（cap=5 却留了 37 条），
         * 也就是说 `maxEvents` 的真实语义是**内存量级**，不是条数上限。
         * 如果有人为了让它变"严格"而删掉 `~`，那会同时把每次 XADD 的代价抬高——
         * 这个取舍应该由读数为它签字，而不是顺手改一个字符。
         */
    })

    test('字段成对且 seq 是字符串（redis 只能存字符串，读侧要能还原成号）', async () => {
        const redis = createFakeRedis()
        const {mirror} = mkMirror({redis, flushEvery: 1})
        mirror.onEvent(12, 'segment_end', '{"seq":1}')
        await new Promise(r => setImmediate(r))
        const args = redis.lastXadd.args.map(String)
        const at = args.indexOf('seq')
        assert.ok(at > 0)
        assert.deepEqual(args.slice(at, at + 6), ['seq', '12', 'event', 'segment_end', 'data', '{"seq":1}'])
    })
})

describe('读侧：连续性优先', () => {
    /**
     * @description 直接往假库里塞条目
     * @param {Object} redis 假客户端
     * @param {String} key 键
     * @param {Number[]} seqs 号
     * @param {Object} [opt] 选项
     * @returns {Promise<void>} 完成
     */
    async function seed(redis, key, seqs, opt = {}) {
        for (const s of seqs) {
            await redis.xadd(key, '*', 'seq', String(s), 'event', opt.events?.[s] || 'delta', 'data', `c${s}`)
        }
        if (opt.end) {
            await redis.xadd(key, '*', 'seq', String(opt.end.seq), 'event', '__end__', 'data', opt.end.outcome)
        }
    }

    test('连续区间：给出游标之后的全部帧与终结信息', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        /**
         * 期望值是按"种了什么"推出来的：正文帧 1/2/3 + 一条 `__end__{seq:3}`。
         * 第一版我给 seed 传了 [1,2,3,4] 又加 end{seq:4}，等于凭空造了个重复号——
         * 那种写法会让断言在测我的手误而不是测行为。
         */
        await seed(redis, key, [1, 2, 3], {end: {seq: 3, outcome: 'done'}})
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 1})
        assert.equal(r.found, true)
        assert.equal(r.reason, 'ok')
        assert.equal(r.gap, null)
        assert.deepEqual(r.events.map(e => e.seq), [2, 3], '__end__ 不作为业务帧下发')
        assert.deepEqual(r.final, {outcome: 'done', seq: 3})
    })

    test('头部被截断 ⇒ 报 gap 且不给半套事件', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        for (let i = 1; i <= 8; i++) {
            await redis.xadd(key, 'MAXLEN', '~', 3, '*', 'seq', String(i), 'event', 'delta', 'data', 'x')
        }
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 1})
        assert.equal(r.gap?.code, GAP_CODE)
        assert.deepEqual(r.events, [], '报 gap 就不给事件：给了就会被当成完整回答')
        assert.equal(r.gap.oldest, 6)
        assert.equal(r.gap.missingFrom, 2)
    })

    test('保留窗内部有洞（镜像丢帧）⇒ 同样报 gap', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        await seed(redis, key, [1, 2, 4, 5])
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 1})
        assert.equal(r.reason, 'partial')
        assert.equal(r.gap.missingFrom, 3, '洞在 3')
        assert.deepEqual(r.events, [])
    })

    test('游标落在保留窗内且不越界 ⇒ 正常补发（gap 不是一律拒绝）', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        await seed(redis, key, [4, 5, 6, 7])
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 5})
        assert.equal(r.reason, 'ok')
        assert.deepEqual(r.events.map(e => e.seq), [6, 7])
    })

    test('游标已超过镜像最大号 ⇒ 空事件、无 gap（客户端其实收全了）', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        await seed(redis, key, [1, 2, 3], {end: {seq: 3, outcome: 'abort'}})
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 3})
        assert.equal(r.reason, 'ok')
        assert.deepEqual(r.events, [])
        assert.equal(r.gap, null)
    })

    test('键不存在 ⇒ found:false reason:missing（路由据此回不可用）', async () => {
        const redis = createFakeRedis()
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'nope', lastSeq: 0})
        assert.equal(r.found, false)
        assert.equal(r.reason, 'missing')
    })

    test('读失败 ⇒ 降级为不可用而不是抛（redis 挂时聊天与续接都要能站住）', async () => {
        const redis = createFakeRedis({throwOnRead: true})
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 0})
        assert.equal(r.found, false)
        assert.equal(r.reason, 'unreadable')
    })

    test('没有客户端 ⇒ reason:no-client', async () => {
        const r = await readRunEventLog({getClient: async () => null, messageCode: 'mc-1', lastSeq: 0})
        assert.equal(r.reason, 'no-client')
    })

    test('空串载荷与缺字段都不炸（镜像里可能只有 seq/event）', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        await redis.xadd(key, '*', 'seq', '1', 'event', 'delta')
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 0})
        assert.equal(r.reason, 'ok')
        assert.equal(r.events[0].data, '')
    })

    test('非法/无号条目被忽略，不会把连续性判成洞', async () => {
        const redis = createFakeRedis()
        const key = eventKey('mc-1')
        await redis.xadd(key, '*', 'seq', 'junk', 'event', 'delta', 'data', 'x')
        await seed(redis, key, [1, 2])
        const r = await readRunEventLog({getClient: async () => redis, messageCode: 'mc-1', lastSeq: 0})
        assert.equal(r.reason, 'ok', JSON.stringify(r))
        assert.deepEqual(r.events.map(e => e.seq), [1, 2])
    })
})
