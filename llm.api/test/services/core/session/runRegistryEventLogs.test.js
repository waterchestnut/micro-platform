import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    admitRun, releaseRun, resetForTest, snapshot,
    attachEventLog, getEventLog, getEventLogEntry, finishEventLog, detachEventLog,
    sweepEventLogs, eventLogStats,
} from '../../../../services/core/session/runRegistry.js'
import {createRunEventLog} from '../../../../services/core/session/runEventLog.js'

/**
 * 事件日志表（PR-C 的 `/resume` 数据源）。
 *
 * 最要紧的一条是**闸关着也能查到**：`limits_concurrentRuns` 默认 0，此时 `runs` 恒空。
 * 如果日志挂在 `runs` 上，`/resume` 在默认配置下永远查不到任何一轮，
 * 而我写单测时多半会先 `admitRun` 再测——**全绿上线一个从来没生效的功能**，
 * 这个形状本仓已经犯过一次（`archives` 的文件头注释记的就是它）。
 */

/**
 * @description 每条用例前清表（表是模块级的，跨用例会互相看见）
 * @returns {void}
 */
function fresh() {
    resetForTest()
}

/**
 * @description 造一个带若干帧的日志
 * @param {Object} [opt] 参数
 * @param {Number} [opt.frames] 帧数
 * @param {Number} [opt.perFrameChars] 每帧字符数
 * @returns {Object} 日志句柄
 */
function mkLog({frames = 3, perFrameChars = 10} = {}) {
    const log = createRunEventLog({messageCode: 'any'})
    for (let i = 1; i <= frames; i++) {
        log.record(i, i === frames ? 'done' : 'delta', 'x'.repeat(perFrameChars))
    }
    return log
}

describe('挂载与查找', () => {
    test('闸关着（默认）也挂得上、查得到 —— 这张表必须独立于 runs', () => {
        fresh()
        assert.equal(snapshot().active, 0, '前提：没开闸时 runs 确实是空的')
        assert.equal(attachEventLog('mc-a', mkLog(), {userCode: 'u1'}), true)
        assert.ok(getEventLog('mc-a'), '闸关着也必须查得到日志')
        assert.equal(snapshot().active, 0, '并且完全没有污染闸的计数')
    })

    test('挂不上时必须返回 false（不能悄悄丢）', () => {
        fresh()
        assert.equal(attachEventLog('', mkLog()), false, '没有 messageCode')
        assert.equal(attachEventLog('mc-b', null), false, '没有 log')
        assert.equal(attachEventLog('mc-c', {record: () => {}}), false, 'log 不合接口（缺 since）')
        assert.equal(eventLogStats().retained, 0)
    })

    test('归属随日志存下来（续接判越权用，此刻库里可能还没有这条 message）', () => {
        fresh()
        attachEventLog('mc-d', mkLog(), {userCode: 'u9', conversationCode: 'conv-9'})
        const e = getEventLogEntry('mc-d')
        assert.equal(e.userCode, 'u9')
        assert.equal(e.conversationCode, 'conv-9')
        assert.equal(e.finishedAt, 0, '没标结束就是 0，不能是 undefined：淘汰器靠这个数区分在途')
    })

    test('同一个 messageCode 重挂是替换（同一轮重开流，旧日志已失效）', () => {
        fresh()
        attachEventLog('mc-e', mkLog({frames: 2}))
        attachEventLog('mc-e', mkLog({frames: 5}))
        assert.equal(eventLogStats().retained, 1)
        assert.equal(getEventLog('mc-e').latest(), 5)
    })

    test('detach 幂等，且摘掉后查不到', () => {
        fresh()
        attachEventLog('mc-f', mkLog())
        assert.equal(detachEventLog('mc-f'), true)
        assert.equal(detachEventLog('mc-f'), false, '重复摘不报错也不返回真')
        assert.equal(getEventLog('mc-f'), null)
    })
})

describe('TTL：结束后才计时，过期就地清', () => {
    test('未标结束的条目不会因 TTL 消失（在途 run 的数据源删不得）', async () => {
        fresh()
        attachEventLog('mc-g', mkLog(), {ttlMs: 30})
        await new Promise(r => setTimeout(r, 60))
        assert.ok(getEventLog('mc-g'), '在途：TTL 不该动它')
        assert.equal(eventLogStats().inflight, 1)
    })

    test('标结束之后过 TTL 就查不到，并且 dropped.ttl 计数上升', async () => {
        fresh()
        attachEventLog('mc-h', mkLog(), {ttlMs: 30})
        assert.ok(finishEventLog('mc-h'), 'finish 要交还日志句柄')
        await new Promise(r => setTimeout(r, 60))
        assert.equal(getEventLog('mc-h'), null)
        assert.equal(eventLogStats().dropped.ttl, 1, `过期必须被计数，实际 ${JSON.stringify(eventLogStats().dropped)}`)
    })

    test('ttlMs 非法时取默认值（0 不能变成"立刻丢"）', () => {
        fresh()
        attachEventLog('mc-i', mkLog(), {ttlMs: 0})
        const e = getEventLogEntry('mc-i')
        assert.ok(e.ttlMs >= 1000, `应回落到默认量级，实际 ${e.ttlMs}`)
    })

    test('finish 一个没挂过的键返回 null，不抛', () => {
        fresh()
        assert.equal(finishEventLog('nope'), null)
    })
})

describe('有界：条数与字节都只丢已结束的，绝不丢在途的', () => {
    test('超条数时从"最早结束的"开始丢', () => {
        fresh()
        for (let i = 1; i <= 5; i++) {
            attachEventLog(`mc-${i}`, mkLog())
        }
        /** 只让前 4 个结束：第 5 个仍在途 */
        for (let i = 1; i <= 4; i++) {
            finishEventLog(`mc-${i}`)
        }
        sweepEventLogs({maxRuns: 2})
        const st = eventLogStats()
        assert.equal(st.inflight, 1, `在途的必须留着，实际 ${JSON.stringify(st)}`)
        assert.ok(st.retained <= 2, `已结束的最多留 2 个，实际 ${st.retained}`)
        assert.equal(st.dropped.count, 3, `丢弃要计数，实际 ${JSON.stringify(st.dropped)}`)
    })

    test('在途的即使超字节预算也不丢（丢它等于删掉这轮的数据源）', () => {
        fresh()
        attachEventLog('big-inflight', mkLog({frames: 50, perFrameChars: 100}))
        attachEventLog('small-finished', mkLog({frames: 2}))
        finishEventLog('small-finished')
        sweepEventLogs({maxTotalBytes: 10})
        assert.ok(getEventLog('big-inflight'), '在途的大日志也要留着')
        assert.equal(getEventLog('small-finished'), null, '能丢的只有已结束的')
        assert.equal(eventLogStats().dropped.bytes, 1)
    })

    test('字节预算读的是真实留存字节，不是帧数', () => {
        fresh()
        attachEventLog('mc-bytes', mkLog({frames: 4, perFrameChars: 25}))
        const st = eventLogStats()
        assert.equal(st.bytes, 100, `4 帧 × 25 字符 = 100，实际 ${st.bytes}`)
    })

    test('sweep 返回 scanned/dropped（探针要能验证"确实扫过"）', () => {
        fresh()
        for (let i = 1; i <= 3; i++) {
            attachEventLog(`mc-s${i}`, mkLog())
            finishEventLog(`mc-s${i}`)
        }
        const r = sweepEventLogs({maxRuns: 1})
        assert.equal(r.scanned, 3)
        assert.equal(r.dropped, 2)
        assert.equal(eventLogStats().retained, 1)
    })

    test('attach 时自动 sweep（不需要调用方记得清）', () => {
        fresh()
        for (let i = 1; i <= 3; i++) {
            attachEventLog(`mc-auto${i}`, mkLog())
            finishEventLog(`mc-auto${i}`)
        }
        /** 默认上限远大于 3，所以这条只验证"不抛且都在"，不验证默认值大小 */
        assert.equal(eventLogStats().retained, 3)
        assert.equal(eventLogStats().attached, 3)
    })
})

describe('stats 的形状就是 runStats 的读数口径', () => {
    test('键齐全且是数字（前端与探针按名字取值）', () => {
        fresh()
        attachEventLog('mc-k', mkLog())
        const st = eventLogStats()
        for (const k of ['attached', 'retained', 'inflight', 'finished', 'bytes']) {
            assert.equal(typeof st[k], 'number', `${k} 必须是数字：${JSON.stringify(st)}`)
        }
        for (const k of ['ttl', 'count', 'bytes']) {
            assert.equal(typeof st.dropped[k], 'number', `dropped.${k} 必须是数字`)
        }
        assert.equal(st.inflight + st.finished, st.retained, '在途 + 已结束 = 总数，对不上就是分类漏了')
    })

    test('resetForTest 把表与计数一起清（否则用例之间互相污染）', () => {
        fresh()
        attachEventLog('mc-r', mkLog())
        finishEventLog('mc-r')
        sweepEventLogs({maxRuns: 0})
        resetForTest()
        const st = eventLogStats()
        assert.equal(st.retained, 0)
        assert.equal(st.attached, 0)
        assert.equal(st.dropped.ttl, 0)
    })
})
