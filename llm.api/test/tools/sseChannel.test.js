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
