import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'
import {
    attachEventLog, finishEventLog, resetForTest, eventLogStats,
} from '../../services/core/session/runRegistry.js'
import {createRunEventLog} from '../../services/core/session/runEventLog.js'
import {GAP_CODE} from '../../services/core/session/runEventLog.js'

/**
 * `POST /core/chat/stream/resume`（PR-C / D34 的可用性下限）。
 *
 * 用 `build(t)` 起真 app + `inject`：路由里的判定（身份、归属、gap）都在写 SSE 头之前，
 * 所以能被离线跑到。**只有"续上直播"那一半需要 dev 实测**——那要求 run 真的还在跑，
 * 不是 inject 能造的。这条界线在这里说清楚，免得把"路由测试通过"读成"续接已验证"。
 *
 * 最要紧的三条断言：
 * 1. **重放帧带的是原始号**（`id:16`…）：换成新号客户端下次就带错游标；
 * 2. **gap 是结构化响应体而不是半套事件**：给了半套正文，前端会把它当成完整回答；
 * 3. **越权 403**：日志里存的是这一轮的原始帧，含用户刚问的话与模型答的内容。
 */

const ui = (userCode) => Buffer.from(JSON.stringify({userCode, realName: '续接测试'})).toString('base64')

/**
 * @description 造一轮"已经结束"的日志并挂进登记表
 * @param {Object} opt 参数
 * @param {String} opt.messageCode 本轮标识
 * @param {Number} [opt.frames] 帧数（最后一帧是 done）
 * @param {String} [opt.userCode] 归属用户
 * @param {Object} [opt.logOpt] 传给 createRunEventLog
 * @returns {Object} 日志句柄
 */
function seed({messageCode, frames = 20, userCode = 'resume-owner', logOpt = {}} = {}) {
    const log = createRunEventLog({messageCode, ...logOpt})
    log.record(1, 'meta', JSON.stringify({type: 'meta', messageCode}))
    for (let i = 2; i < frames; i++) {
        log.record(i, 'delta', `c${i}`)
    }
    log.record(frames, 'done', 'done')
    attachEventLog(messageCode, log, {userCode, conversationCode: 'conv-1'})
    finishEventLog(messageCode)
    log.close()
    return log
}

describe('入口闸门', () => {
    test('无身份 ⇒ 401（内部路径不能当成已鉴权，D57）', async (t) => {
        const app = await build(t)
        resetForTest()
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            payload: {messageCode: 'mc-x', lastSeq: 0},
        })
        assert.equal(res.statusCode, 401, `实际 ${res.statusCode}: ${res.payload}`)
    })

    test('缺游标 ⇒ 400，而不是按 0 处理（按 0 就是全量重放，等于免费的流量放大）', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-nocursor', frames: 6})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-nocursor'},
        })
        assert.equal(res.statusCode, 400, `实际 ${res.statusCode}: ${res.payload}`)
        assert.match(res.json().msg, /游标/)
    })

    test('负数/小数游标 ⇒ 400', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-bad', frames: 6})
        for (const lastSeq of [-1, 1.5, 'x']) {
            const res = await app.inject({
                method: 'POST',
                url: '/core/chat/stream/resume',
                headers: {'user-info': ui('resume-owner')},
                payload: {messageCode: 'mc-bad', lastSeq},
            })
            assert.equal(res.statusCode, 400, `lastSeq=${JSON.stringify(lastSeq)} ⇒ ${res.statusCode}: ${res.payload}`)
        }
    })

    test('未知 messageCode ⇒ 404 + 机器可读码 + 快照指引（不假装续上了）', async (t) => {
        const app = await build(t)
        resetForTest()
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-never-existed', lastSeq: 3},
        })
        assert.equal(res.statusCode, 404, `实际 ${res.statusCode}: ${res.payload}`)
        const body = res.json()
        assert.equal(body.code, 'EVENT_LOG_UNAVAILABLE')
        assert.match(body.snapshotUrl, /mc-never-existed/)
        /**
         * 体里的 statusCode 必须与 HTTP 状态一致。`preSerialization` 会给没写 statusCode 的载荷
         * **补 200**（项目既有约定，`agentTask` 那些路由都显式写），dev 实测就抓到我这条 404 的
         * 响应体写着 `"statusCode":200` ——与 §2D.2 记过的"鉴权失败对外是 200"同一类形状。
         */
        assert.equal(body.statusCode, 404, `响应体在谎报状态：${res.payload}`)
    })

    test('别人的 messageCode ⇒ 403', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-owner', frames: 8, userCode: 'a-owner'})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('b-intruder')},
            payload: {messageCode: 'mc-owner', lastSeq: 1},
        })
        assert.equal(res.statusCode, 403, `实际 ${res.statusCode}: ${res.payload}`)
        assert.match(res.json().msg, /无权/)
    })
})

describe('正常续接：重放必须带原始号', () => {
    test('从中间游标续：收到 16..20，号与事件名都是那一轮当时的', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-ok', frames: 20})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-ok', lastSeq: 15},
        })
        assert.equal(res.statusCode, 200, `实际 ${res.statusCode}: ${res.payload}`)
        assert.match(res.headers['content-type'], /text\/event-stream/)
        assert.equal(res.headers['x-run-last-seq'], '20', '游标超前与否要能由头判断')

        const ids = [...res.payload.matchAll(/^id:(\d+)$/gm)].map(m => Number(m[1]))
        assert.deepEqual(ids, [16, 17, 18, 19, 20], `重放号必须原样，实际 ${JSON.stringify(ids)}`)
        assert.ok(/^event:done$/m.test(res.payload), '结束帧必须在（否则前端不知道流结束了）')
        assert.deepEqual(ids, [...ids].sort((a, b) => a - b), '不能倒序')
    })

    test('游标 0（一个都没收到）⇒ 从头完整重放', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-zero', frames: 5})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-zero', lastSeq: 0},
        })
        assert.equal(res.statusCode, 200, res.payload)
        const ids = [...res.payload.matchAll(/^id:(\d+)$/gm)].map(m => Number(m[1]))
        assert.deepEqual(ids, [1, 2, 3, 4, 5])
    })

    test('Last-Event-ID 头可以替代体里的 lastSeq（浏览器原生重连的形状）', async (t) => {
        const app = await build(t)
        resetForTest()
        seed({messageCode: 'mc-hdr', frames: 6})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner'), 'last-event-id': '4'},
            payload: {messageCode: 'mc-hdr'},
        })
        assert.equal(res.statusCode, 200, res.payload)
        assert.deepEqual([...res.payload.matchAll(/^id:(\d+)$/gm)].map(m => Number(m[1])), [5, 6])
    })
})

describe('gap：一等返回，不给半套事件', () => {
    test('游标落在被淘汰的区间 ⇒ 410 + EVENT_BUFFER_EXPIRED + 不含任何 delta 正文', async (t) => {
        const app = await build(t)
        resetForTest()
        /** maxEvents=3：灌 12 帧后最早几帧已被淘汰，客户端拿 lastSeq=1 来续就必须报 gap */
        const log = createRunEventLog({messageCode: 'mc-gap', maxEvents: 3})
        for (let i = 1; i <= 12; i++) {
            log.record(i, 'delta', `正文片段${i}`)
        }
        log.record(13, 'done', 'done')
        attachEventLog('mc-gap', log, {userCode: 'resume-owner'})
        finishEventLog('mc-gap')
        log.close()

        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-gap', lastSeq: 1},
        })
        assert.equal(res.statusCode, 410, `实际 ${res.statusCode}: ${res.payload}`)
        assert.match(res.headers['content-type'], /application\/json/, 'gap 走 JSON，不是一段半截流')
        const body = res.json()
        assert.equal(body.code, GAP_CODE)
        assert.equal(body.since, 1)
        assert.ok(body.oldest > 1, `oldest 应已在淘汰线之后，实际 ${body.oldest}`)
        assert.equal(body.messageCode, 'mc-gap')
        assert.match(body.snapshotUrl, /messageCode=mc-gap/, '必须给得出快照重建的去处')
        assert.equal(body.statusCode, 410, `gap 的响应体不能写着 200：${res.payload}`)
        assert.ok(!/正文片段/.test(JSON.stringify(body)), 'gap 响应里不能夹着任何正文')
    })

    test('游标仍在保留范围内 ⇒ 正常补发（gap 不是"一律拒绝"）', async (t) => {
        const app = await build(t)
        resetForTest()
        const log = createRunEventLog({messageCode: 'mc-gap2', maxEvents: 4})
        for (let i = 1; i <= 8; i++) {
            log.record(i, 'delta', 'x')
        }
        log.record(9, 'done', 'done')
        attachEventLog('mc-gap2', log, {userCode: 'resume-owner'})
        finishEventLog('mc-gap2')
        log.close()
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-gap2', lastSeq: 6},
        })
        assert.equal(res.statusCode, 200, `实际 ${res.statusCode}: ${res.payload}`)
        assert.deepEqual([...res.payload.matchAll(/^id:(\d+)$/gm)].map(m => Number(m[1])), [7, 8, 9])
    })
})

describe('与闸、与其他表互不干扰', () => {
    test('续接不消耗闸额度、不动抢救表（它只是读日志）', async (t) => {
        const app = await build(t)
        resetForTest()
        const before = eventLogStats()
        seed({messageCode: 'mc-quiet', frames: 4})
        const res = await app.inject({
            method: 'POST',
            url: '/core/chat/stream/resume',
            headers: {'user-info': ui('resume-owner')},
            payload: {messageCode: 'mc-quiet', lastSeq: 1},
        })
        assert.equal(res.statusCode, 200, res.payload)
        const st = await app.inject({
            method: 'POST',
            url: '/core/chat/runStats',
            headers: {'user-info': ui('resume-owner')},
            payload: {},
        })
        assert.equal(st.statusCode, 200, st.payload)
        const d = st.json().data
        assert.equal(d.active, 0, '续接不该让闸的 active 变')
        assert.ok(d.eventLog, 'runStats 必须能看到日志表的读数（不然内存涨了没人知道）')
        assert.equal(typeof d.eventLog.bytes, 'number')
        assert.equal(d.eventLog.enabled, true)
        assert.ok(d.eventLog.retained >= before.retained)
    })
})
