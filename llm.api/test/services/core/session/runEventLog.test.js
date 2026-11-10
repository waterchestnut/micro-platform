import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {createRunEventLog, DEFAULT_MAX_EVENTS, DEFAULT_MAX_BYTES, DEFAULT_SNAPSHOT_URL, GAP_CODE} from '../../../../services/core/session/runEventLog.js'

/**
 * PR-C 事件日志：`/resume` 的数据源。
 *
 * 断言全部围绕 §19 的 SSE 不变量，而不是"函数能跑"。
 * 原因是这类 bug 的后果不可见：静默丢事件会让前端把缺的那段当成"没发生过"，
 * 用户看到的是一段通顺但少了内容的回答；而报 gap 虽然体验差一点，至少是诚实的。
 * 所以这里最狠的一条是"淘汰后必须给 gap"，其余都是它的陪衬。
 */

/**
 * @description 造日志并按号灌事件
 * @param {Object} [opts] 参数
 * @returns {Object} 日志句柄
 */
function mk(opts = {}) {
    return createRunEventLog({messageCode: 'mc-test', ...opts})
}

describe('不变量 1：seq 严格单调', () => {
    test('正常递增可记录，latest 跟着走', () => {
        const log = mk()
        log.record(1, 'meta', '{"a":1}')
        log.record(2, 'delta', 'x')
        log.record(3, 'done', 'done')
        assert.equal(log.latest(), 3)
        assert.equal(log.size(), 3)
    })

    test('回退号必须抛错，而不是悄悄覆盖', () => {
        const log = mk()
        log.record(5, 'delta', 'a')
        assert.throws(() => log.record(4, 'delta', 'b'), /严格递增/, '号倒退')
        assert.throws(() => log.record(5, 'delta', 'c'), /严格递增/, '号重复')
        assert.equal(log.size(), 1, '被拒的记录不能留下半成品')
        assert.equal(log.latest(), 5)
    })

    test('非法 seq（0/负/小数/非数字）一律抛错', () => {
        const log = mk()
        for (const bad of [0, -1, 1.5, NaN, 'x', null, undefined]) {
            assert.throws(() => log.record(bad, 'delta', 'v'), /非法 seq/, `应拒绝 ${String(bad)}`)
        }
    })

    test('号可以跳（写成功才落号，跳号来自别的通道），但保留区间仍要连续给出', () => {
        const log = mk()
        log.record(1, 'meta', 'm')
        log.record(3, 'delta', 'd')
        const r = log.since(1)
        assert.deepEqual(r.events.map(e => e.seq), [3], '只给比游标大的保留事件')
        assert.equal(r.gap, null, '本模块没淘汰过，不该造 gap')
    })
})

describe('不变量 2：不跳过任何保留事件 / 淘汰必须给 gap', () => {
    test('since 从 lastSeq+1 起连续给', () => {
        const log = mk()
        for (let i = 1; i <= 5; i++) {
            log.record(i, 'delta', `c${i}`)
        }
        assert.deepEqual(log.since(0).events.map(e => e.seq), [1, 2, 3, 4, 5])
        assert.deepEqual(log.since(3).events.map(e => e.seq), [4, 5])
        assert.deepEqual(log.since(5).events.map(e => e.seq), [], '已到末尾：空集且无 gap')
        assert.equal(log.since(5).gap, null)
    })

    test('游标指向已淘汰的号时报 gap（最要害的一条）', () => {
        const log = mk({maxEvents: 3})
        for (let i = 1; i <= 6; i++) {
            log.record(i, 'delta', `c${i}`)
        }
        assert.equal(log.size(), 3, '上限生效')
        assert.deepEqual(log.since(4).events.map(e => e.seq), [5, 6], '仍在保留范围内：正常补发')
        assert.equal(log.since(4).gap, null)
        /**
         * 游标 2 ⇒ 下一号 3 已被淘汰。这里若"有什么给什么"就会返回 [4,5,6]，
         * 前端少收一条 delta 且永远不知道少了——正是静默丢事件。
         */
        const g = log.since(2)
        assert.deepEqual(g.events, [], '报 gap 时不给半套事件')
        assert.ok(g.gap, '必须报 gap')
        assert.equal(g.gap.code, GAP_CODE)
        assert.equal(g.gap.since, 2)
        assert.equal(g.gap.oldest, 4, `最早保留应为 4，实际 ${g.gap.oldest}`)
        assert.equal(g.gap.latest, 6)
    })

    test('游标恰好落在淘汰边界上不报 gap', () => {
        const log = mk({maxEvents: 2})
        for (let i = 1; i <= 4; i++) {
            log.record(i, 'delta', 'x')
        }
        assert.equal(log.since(2).gap, null, 'oldest=3，from+1=3 仍完整')
        assert.ok(log.since(1).gap, 'from+1=2 已被淘汰')
    })

    test('空日志：since 给空集不报 gap（一轮还没产出事件时是合法状态）', () => {
        const log = mk()
        assert.deepEqual(log.since(0).events, [])
        assert.equal(log.since(0).gap, null)
        assert.equal(log.latest(), 0)
    })

    test('gapBody 是机器可读的一等返回（不是裸 410 文本）', () => {
        const log = mk({maxEvents: 2})
        for (let i = 1; i <= 5; i++) {
            log.record(i, 'delta', 'x')
        }
        const body = log.gapBody(log.since(1).gap)
        assert.equal(body.code, GAP_CODE)
        assert.equal(body.since, 1)
        assert.equal(body.messageCode, 'mc-test')
        /**
         * 旧断言是 `snapshotUrl` 里必须带 `messageCode=…`——那默认值指向
         * `/core/message/detail`，一个**没注册过的端点**。现在只指真实存在的 `/core/message/list`，
         * 参数改由 `snapshotRequest.body.filter` 给（POST 端点光有 URL 前端仍然拼不出请求）。
         */
        assert.equal(body.snapshotUrl, DEFAULT_SNAPSHOT_URL)
        assert.equal(body.snapshotRequest.method, 'POST')
        assert.equal(body.snapshotRequest.body.filter.messageCode, 'mc-test')
        const custom = log.gapBody(log.since(1).gap, {snapshotUrl: 'https://x/y'})
        assert.equal(custom.snapshotUrl, 'https://x/y', '调用方显式给的落点优先')
        assert.equal(custom.snapshotRequest.url, DEFAULT_SNAPSHOT_URL, '请求形状仍是默认端点：两者不同时要让前端看得见')
        assert.equal(typeof body.msg, 'string')
        assert.match(body.msg, /快照重建/, '人要能看懂该怎么办')
    })
})

describe('字节预算（条数上限不代表内存）', () => {
    test('按字节淘汰，且淘汰后必须报 gap', () => {
        const log = mk({maxEvents: 1000, maxBytes: 30})
        for (let i = 1; i <= 6; i++) {
            log.record(i, 'delta', 'x'.repeat(10))
        }
        assert.ok(log.size() < 6, `应被字节淘汰，实际留 ${log.size()} 条`)
        assert.ok(log.stats().bytes <= 30, `留存的字节必须不超预算，实际 ${log.stats().bytes}`)
        const st = log.stats()
        assert.ok(st.evictedThrough > 0, '字节淘汰也要推 evictedThrough，否则 gap 判不出来')
        assert.ok(log.since(1).gap, '游标落在被淘汰的区间里 ⇒ 必须报 gap')
        assert.equal(log.since(st.evictedThrough).gap, null, '游标在保留范围内 ⇒ 正常补发')
    })

    test('单帧就超预算时：留着它、记一次 oversized，不能把整轮清空', () => {
        const log = mk({maxBytes: 10})
        log.record(1, 'delta', 'x'.repeat(5))
        log.record(2, 'tool_result', 'Y'.repeat(100))
        assert.equal(log.size(), 1, '至少留最新一条：清空会让续接报"没有事件"而不是 gap')
        assert.equal(log.stats().oversized, 1, '这帧的代价必须可见')
        assert.equal(log.latest(), 2)
    })

    test('maxBytes 非法时取默认值（不能让 0 变成"一条都不留"）', () => {
        assert.equal(mk({maxBytes: 0}).stats().byteCap, DEFAULT_MAX_BYTES)
        assert.equal(mk({maxBytes: -5}).stats().byteCap, DEFAULT_MAX_BYTES)
    })

    test('淘汰后 oldest 正好是 evictedThrough+1（gap 判定的依据要自洽）', () => {
        const log = mk({maxEvents: 3})
        for (let i = 1; i <= 7; i++) {
            log.record(i, 'delta', 'a')
        }
        const st = log.stats()
        /**
         * 期望值是推出来的不是心算的：cap=3、灌 7 条 ⇒ 每灌一条挤掉最早一条，
         * 终态 evictedThrough=4、保留 [5,6,7]。我第一版写成 [4,5,6]，
         * 正是"凭印象写期望值"这个老毛病——所以把推导留在断言旁边。
         */
        assert.equal(st.evictedThrough, 4, `淘汰边界，实际 ${st.evictedThrough}`)
        assert.equal(st.evictedThrough + 1, log.since(st.evictedThrough).events[0].seq,
            '保留范围内第一个号 = 被淘汰的最大号 + 1')
        assert.ok(log.since(st.evictedThrough - 1).gap, '游标指向被淘汰的号 ⇒ 报 gap')
        assert.deepEqual(log.since(st.evictedThrough).events.map(e => e.seq), [5, 6, 7],
            `边界上应连续给出，实际 ${JSON.stringify(log.since(st.evictedThrough).events.map(e => e.seq))}`)
    })
})

describe('replayThenLive：补发 + 直播不丢不重', () => {
    test('补发游标之后的历史，并接续后来的事件', () => {
        const log = mk()
        for (let i = 1; i <= 3; i++) {
            log.record(i, 'delta', `c${i}`)
        }
        const got = []
        const {cancel, result} = log.replayThenLive(1, (it) => got.push(it.seq))
        assert.equal(result.gap, null)
        assert.deepEqual(got, [2, 3], '先补发')
        log.record(4, 'delta', 'c4')
        assert.deepEqual(got, [2, 3, 4], '再直播')
        cancel()
        log.record(5, 'delta', 'c5')
        assert.deepEqual(got, [2, 3, 4], 'cancel 后不再收')
    })

    test('下发过程中新到的事件不能重复、也不能倒序', () => {
        const log = mk()
        for (let i = 1; i <= 3; i++) {
            log.record(i, 'delta', 'a')
        }
        const got = []
        /**
         * 故意在回调里再记一条：模拟"边下发边产生"的重入（写帧的 await 期间 run 还在跑）。
         * 有 `seen` 去重才不会既收到两次 4、又在下一轮把 4 再发一遍。
         */
        log.replayThenLive(1, (it) => {
            got.push(it.seq)
            if (it.seq === 2 && !log.stats().closed) {
                log.record(4, 'delta', 'r')
            }
        })
        assert.deepEqual(got, [2, 3, 4], `实际 ${JSON.stringify(got)}`)
        assert.equal(new Set(got).size, got.length, '不能有重复号')
        assert.deepEqual(got, [...got].sort((a, b) => a - b), '不能有倒序帧：前端会当成两次回答')
    })

    test('gap 时一条都不发，并且订阅自己关掉（不留下永不回收的回调）', () => {
        const log = mk({maxEvents: 2})
        for (let i = 1; i <= 4; i++) {
            log.record(i, 'delta', 'a')
        }
        const got = []
        const {result} = log.replayThenLive(1, (it) => got.push(it.seq))
        assert.ok(result.gap, '必须报 gap')
        assert.deepEqual(got, [], '报 gap 就不给半套事件')
        log.record(5, 'delta', 'b')
        assert.deepEqual(got, [], 'gap 路径不应继续直播')
    })

    test('游标超前（客户端已收全）时补发空集、仍接直播', () => {
        const log = mk()
        log.record(1, 'delta', 'a')
        const got = []
        const {result} = log.replayThenLive(9, (it) => got.push(it.seq))
        assert.equal(result.gap, null)
        assert.deepEqual(got, [])
        log.record(2, 'delta', 'b')
        assert.deepEqual(got, [2])
    })
})

describe('不变量 4 相关：心跳不入日志，订阅者不影响主流程', () => {
    test('日志只由 record 写入——ping 走的是另一条路径，这里没有它的入口', () => {
        const log = mk()
        log.record(1, 'meta', 'm')
        /** 心跳注释帧不产生业务事件：本模块根本没有 ping 方法，形状本身就是保证 */
        assert.equal(typeof log.ping, 'undefined', '若将来加了 ping，必须让它不入日志')
        assert.deepEqual(log.since(0).events.map(e => e.event), ['meta'])
    })

    test('subscribe 收到后续事件；取消后不再收', () => {
        const log = mk()
        const seen = []
        const off = log.subscribe((it) => seen.push(it.seq))
        log.record(1, 'delta', 'a')
        log.record(2, 'delta', 'b')
        off()
        log.record(3, 'delta', 'c')
        assert.deepEqual(seen, [1, 2])
    })

    test('订阅者抛错不能打断记录（日志是旁路观测）', () => {
        const log = mk()
        log.subscribe(() => {
            throw new Error('订阅者坏了')
        })
        const seen = []
        log.subscribe((it) => seen.push(it.seq))
        assert.doesNotThrow(() => log.record(1, 'delta', 'a'))
        assert.deepEqual(seen, [1], '坏订阅者不能连累好订阅者')
        assert.equal(log.size(), 1)
    })

    test('close 之后清订阅，stats 可读（runStats 的诊断口径）', () => {
        const log = mk({maxEvents: 4})
        log.record(1, 'delta', 'a')
        log.record(2, 'delta', 'b')
        assert.equal(log.isOpen(), true)
        log.close()
        assert.equal(log.isOpen(), false)
        const st = log.stats()
        assert.equal(st.retained, 2)
        assert.equal(st.cap, 4)
        assert.equal(st.lastSeq, 2)
        assert.equal(st.closed, true)
        assert.equal(st.messageCode, 'mc-test')
        assert.equal(st.evictedThrough, 0, '没淘汰过就该是 0')
    })

    test('默认上限存在且可注入更小的值（测试与 prod 同一套代码路径）', () => {
        assert.ok(Number.isInteger(DEFAULT_MAX_EVENTS) && DEFAULT_MAX_EVENTS > 0)
        assert.equal(mk({maxEvents: 0}).stats().cap, DEFAULT_MAX_EVENTS, '0/负数不能把上限变成 0')
        assert.equal(mk({maxEvents: '3'}).stats().cap, 3, '字符串数字要认（配置来自 env）')
    })

    test('resetForTest 式的隔离：两个日志互不影响', () => {
        const a = mk()
        const b = mk()
        a.record(1, 'delta', 'a')
        assert.equal(b.size(), 0)
        assert.equal(b.latest(), 0)
    })
})
