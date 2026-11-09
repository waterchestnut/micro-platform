/**
 * @fileOverview SSE 通道的离线单测：`id` 单调与心跳注释不占游标
 * @module test/tools/sseChannel
 * @description
 * 守的是 §19 的 SSE 四条不变量里与本模块有关的两条。这两条错了，PR-C 的 `/resume`
 * 就会**跳过事件**或**把心跳当事件重放**，而那类 bug 在线上表现为"续接后少一段回答"，极难归因。
 * 所以这里用假 sink + 注入时钟，不需要真连接也不需要真定时器。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {createSseChannel, DEFAULT_PING_INTERVAL_MS} from '../../tools/sseChannel.js'

/**
 * @description 造一个假可写流，记录写入的每一帧
 * @returns {{frames: String[], write: Function, written: String}} 假 sink
 */
function fakeSink() {
    const frames = []
    return {
        frames,
        get written() {
            return frames.join('')
        },
        write(chunk) {
            frames.push(chunk)
        },
    }
}

/**
 * @description 造一个可手动推进的时钟 + 定时器，避免测试里真实等待
 * @param {Number} [start] 起始毫秒
 * @returns {{now: Function, setInterval: Function, clearInterval: Function, tick: Function, fire: Function}} 时钟夹具
 */
function fakeClock(start = 0) {
    let t = start
    const timers = []
    return {
        now: () => t,
        setInterval: (fn, ms) => {
            timers.push({fn, ms, next: t + ms})
            return timers.length - 1
        },
        clearInterval: (id) => {
            if (timers[id]) {
                timers[id].cancelled = true
            }
        },
        /**
         * @description 推进时间并触发到期的定时器
         * @param {Number} ms 推进毫秒数
         * @returns {void}
         */
        tick(ms) {
            t += ms
            for (const timer of timers) {
                if (!timer.cancelled) {
                    while (t >= timer.next) {
                        timer.fn()
                        timer.next += timer.ms
                    }
                }
            }
        },
        fire: (id) => timers[id]?.fn(),
    }
}

test('id 严格单调：每事件 +1，且与写入顺序一致', () => {
    const sink = fakeSink()
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})

    const seqs = [
        ch.emit('{"a":1}', 'meta'),
        ch.emit('{"b":2}'),
        ch.emit('{"c":3}', 'tool_result'),
        ch.emit('done', 'done'),
    ]
    assert.deepEqual(seqs, [1, 2, 3, 4])
    assert.equal(ch.getSeq(), 4)

    const ids = [...sink.written.matchAll(/^id:(\d+)$/gm)].map(m => Number(m[1]))
    assert.deepEqual(ids, [1, 2, 3, 4], '帧里的 id 必须与返回值同序，否则客户端游标与事件对不上')
})

test('缺省事件名是 delta，与既有前端契约一致', () => {
    const sink = fakeSink()
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})
    ch.emit('{"content":"x"}')
    assert.match(sink.written, /event:delta\n/)
})

test('心跳注释不带 id、不推进游标（§19：心跳不是业务事件）', () => {
    const sink = fakeSink()
    const clock = fakeClock(0)
    const ch = createSseChannel(sink, {pingIntervalMs: 8000, ...clock})

    ch.emit('{"a":1}', 'meta')
    clock.tick(8000)          // 静默到期 ⇒ 应当发心跳
    assert.equal(ch.getSeq(), 1, '心跳不许推进事件游标')
    assert.match(sink.written, /:ping\n\n/)
    assert.equal((sink.written.match(/^id:/gm) || []).length, 1, '心跳帧里不该出现 id 行')

    ch.emit('{"b":2}')
    assert.equal(ch.getSeq(), 2, '心跳之后第一条事件的 seq 是 2，不是 3')
})

test('心跳只在真静默时发：正常出字不插注释帧', () => {
    const sink = fakeSink()
    const clock = fakeClock(0)
    const ch = createSseChannel(sink, {pingIntervalMs: 8000, ...clock})

    ch.emit('{"a":1}')           // t=0
    clock.tick(4000)             // t=4000：距上次写入 4s，不该发心跳
    ch.emit('{"b":2}')           // lastWriteAt=4000
    clock.tick(4000)             // t=8000：定时器到期，但静默只有 4s ⇒ 仍然不发
    assert.ok(!sink.written.includes(':ping'), '刚写过事件就不该再插心跳')

    clock.tick(4000)             // t=12000：未到下一个触发点（16000）
    assert.ok(!sink.written.includes(':ping'), '没到定时点就不该发')

    clock.tick(4000)             // t=16000：静默 12s ⇒ 发心跳
    assert.ok(sink.written.includes(':ping'))
    assert.equal(ch.getSeq(), 2, '心跳不推进事件游标')
})

test('close 之后不再写入，且可重复调用', () => {
    const sink = fakeSink()
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})
    ch.emit('{"a":1}')
    assert.equal(ch.close(), 1)
    assert.equal(ch.isOpen(), false)
    assert.equal(ch.emit('{"b":2}'), null, '关闭后不该发出事件')
    assert.equal(ch.ping(), false)
    assert.equal(ch.close(), 1, '重复 close 不该改游标')
    assert.equal(sink.frames.length, 1)
})

test('底层 write 抛错时不外抛，并回报一次', () => {
    const errors = []
    const sink = {
        write() {
            throw new Error('EPIPE')
        },
    }
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0, onError: (e) => errors.push(e.message)})

    assert.equal(ch.emit('{"a":1}'), null, '写失败时 emit 返回 null 而不是抛')
    assert.deepEqual(errors, ['EPIPE'])
    assert.equal(ch.isOpen(), false, '写失败视为连接已断')
    ch.emit('{"b":2}')
    assert.equal(errors.length, 1, '断线后不该反复触发错误回调刷屏')
})

test('pingIntervalMs<=0 时心跳整体关闭（配置逃生门）', () => {
    const sink = fakeSink()
    const clock = fakeClock(0)
    const ch = createSseChannel(sink, {pingIntervalMs: 0, ...clock})
    ch.emit('{"a":1}')
    clock.tick(60000)
    assert.ok(!sink.written.includes(':ping'))
    ch.close()
})

test('close 会取消定时器：之后不再有任何写入', () => {
    const sink = fakeSink()
    const clock = fakeClock(0)
    const ch = createSseChannel(sink, {pingIntervalMs: 8000, ...clock})
    ch.close()
    clock.tick(30000)
    assert.deepEqual(sink.frames, [], 'close 后心跳必须真的停下来')
})

test('默认心跳间隔 8s，且明显小于生产 Traefik 的 180s 与 dev nginx 的 60s', () => {
    assert.equal(DEFAULT_PING_INTERVAL_MS, 8000)
    assert.ok(DEFAULT_PING_INTERVAL_MS < 60000, 'dev 侧 nginx 默认 60s 必须被覆盖')
})

test('多行 data 仍然按 SSE 规范拆成多行 data:（不破坏既有分帧）', () => {
    const sink = fakeSink()
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})
    ch.emit('line1\nline2', 'notice')
    assert.match(sink.written, /data:line1\ndata:line2\n/)
    assert.match(sink.written, /\n\n$/, '帧必须以空行结束：客户端只在收到完整帧后才推进游标')
})

/* ---------- §19 第 11 条：SSE 四条不变量的覆盖审计 ----------
 * 写这张表是因为 §26.2 把「SSE 四条不变量有测试」当成 PR-C 的**已满足前置**，
 * 而逐条核对下来只有一条半真的有用例——标题满足不等于内容满足。
 *
 * | 不变量 | 覆盖在哪 | 状态 |
 * |---|---|---|
 * | 1. `id` 严格单调、每事件 +1 | 上面第 1 条用例 | ✅ |
 * | 2. 不跳过任何保留事件 | **只有服务端这半边**（写失败不占号，见下面两条）；
 *   "日志里的事件一个都不漏"那一半边要等 PR-C 的 Streams 事件日志，**现在还测不了** | ⚠️ 半个 |
 * | 3. 不完整帧不推进游标 | 服务端保证每帧以空行结束（上一条）；客户端侧规则属四端各自实现，本仓只能钉服务端 | ✅（服务端侧） |
 * | 4. 心跳注释不进业务事件列表、不推游标 | 上面第 3 条用例 | ✅ |
 *
 * 第 2 条这半边是 v1.31 补的：`emit` 原来先 `seq += 1` 再写，**写失败时号已烧掉**，
 * 于是游标序列里会出现一个"从没送达也从没记录"的空洞。今天没日志看不出来，
 * 上了事件日志后它会让 `/resume` 的"漏了哪几号"无法判定。
 */

test('不变量 2（服务端半边）：写入失败不占号——不在游标序列里制造空洞', () => {
    const frames = []
    let failNext = false
    const sink = {
        write(chunk) {
            if (failNext) {
                throw new Error('EPIPE: 客户端已断开')
            }
            frames.push(chunk)
        },
    }
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})
    assert.equal(ch.emit('a', 'delta'), 1, '第一帧正常拿到 1 号')
    failNext = true
    assert.equal(ch.emit('b', 'delta'), null, '写失败必须返回 null')
    assert.equal(ch.getSeq(), 1, '**关键**：失败的那一帧不能把号推进到 2')
    /**
     * 写失败后通道按既有语义置为不可写（`open=false`），
     * 所以这里断言的是"之后不会再有帧带 2 号写出去"——
     * 号没被烧，比"还能继续发"更重要：宁可整条流停住，也不留一个不可辨的空洞。
     */
    assert.equal(ch.isOpen(), false)
    assert.ok(!frames.some(f => /id:2/.test(f)), '绝不能出现"2 号已发出但没人收到"的帧')
})

test('不变量 2：失败前已成功送达的号仍然连续（不是一失败就把已有号作废）', () => {
    const frames = []
    let fail = false
    const sink = {write(c) {
        if (fail) {
            throw new Error('boom')
        }
        frames.push(c)
    }}
    const ch = createSseChannel(sink, {pingIntervalMs: 0, now: () => 0})
    assert.equal(ch.emit('一', 'delta'), 1)
    assert.equal(ch.emit('二', 'delta'), 2)
    fail = true
    assert.equal(ch.emit('三', 'delta'), null)
    assert.equal(ch.getSeq(), 2, '游标停在最后一个真正送达的号上')
    assert.equal(ch.close(), 2, 'close 回报的末号也必须是真的')
})
