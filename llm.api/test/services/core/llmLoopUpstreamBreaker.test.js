import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {withUpstreamRetry, describeError} from '../../../services/core/llmLoop.js'
import {createBreaker} from '../../../services/core/upstreamBreaker.js'

/**
 * `withUpstreamRetry` 与熔断器接线的用例。
 * 单独一份文件的理由：这些断言关于**顺序与副作用**，不是关于判据本身——
 * 判据在 upstreamBreaker.test.js 里已经钉住了，这里钉的是"什么时候问、问完算不算数"。
 */

const cfg = {enabled: true, maxAttempts: 3, baseMs: 1, capMs: 2, fallbackModel: ''}
const K = 'http://relay:3009'

/**
 * @description 造一个可注入时钟的熔断器
 * @param {Object} [over] 覆盖项
 * @returns {Object} {breaker, tick, events}
 */
function mk(over = {}) {
    let t = 1000
    const events = []
    const breaker = createBreaker({
        cfg: {enabled: true, failureThreshold: 2, openMs: 1000, ...over},
        now: () => t,
        log: (e) => events.push(e),
    })
    return {breaker, events, tick: (ms) => { t += ms }}
}

/**
 * @description 造一个按脚本失败/成功的 invoke
 * @param {Array<Object>} script 每项 {fail: errorInfo|Error | ok: true}
 * @returns {Object} {fn, calls}
 */
function scripted(script) {
    const calls = []
    return {
        calls,
        fn: async ({attempt, usingFallback}) => {
            calls.push({attempt, usingFallback})
            const step = script[Math.min(calls.length - 1, script.length - 1)]
            if (step.ok) {
                return 'value'
            }
            const e = new Error(step.message || 'boom')
            e.name = 'APIError'
            if (step.status) {
                e.status = step.status
            }
            if (step.kind) {
                e.kind = step.kind
            }
            throw e
        },
    }
}

describe('withUpstreamRetry × 熔断器', () => {
    test('熔断中：一次都不许打出去（问在 invoke 之前，不是失败之后再补判）', async () => {
        const {breaker} = mk()
        breaker.recordFailure({key: K})
        breaker.recordFailure({key: K})
        const inv = scripted([{ok: true}])
        await assert.rejects(
            () => withUpstreamRetry({
                invoke: inv.fn, cfg, breaker, breakerKeyOf: () => K, sleep: async () => {},
            }),
            (e) => {
                assert.equal(e.name, 'UpstreamCircuitOpenError')
                assert.equal(e.status, 503)
                assert.ok(e.retryAfterMs > 0, '调用方要能给出 Retry-After')
                assert.match(e.message, /UpstreamCircuitOpen/)
                return true
            })
        assert.equal(inv.calls.length, 0, '熔断中还发请求 = 这段接线白做')
    })

    test('被自己拒掉的请求不得计入熔断：否则打开之后靠自我拒绝永远关不上', async () => {
        const {breaker} = mk()
        breaker.recordFailure({key: K})
        breaker.recordFailure({key: K})
        const before = breaker.snapshot().出口[0].failures
        await assert.rejects(() => withUpstreamRetry({
            invoke: async () => 'never', cfg, breaker, breakerKeyOf: () => K,
        }))
        const after = breaker.snapshot().出口[0].failures
        assert.equal(after, before, '自我拒绝不能再推进失败计数')
    })

    test('每次尝试前都问一次：中途被别的并发打开，本次不再 hammer', async () => {
        const {breaker} = mk({failureThreshold: 1})
        const inv = scripted([{status: 503, message: 'down'}, {ok: true}])
        await assert.rejects(() => withUpstreamRetry({
            invoke: inv.fn,
            cfg: {...cfg, maxAttempts: 3},
            breaker,
            breakerKeyOf: () => K,
            sleep: async () => {},
        }))
        assert.equal(inv.calls.length, 1, '第 1 次失败即打开 ⇒ 第 2 次必须在门外被拒')
    })

    test('不计入的错误（上下文超长）不能把出口判死', async () => {
        const {breaker} = mk()
        const inv = scripted([
            {status: 400, message: "This model's maximum context length is 8192 tokens"},
            {status: 400, message: "This model's maximum context length is 8192 tokens"},
            {status: 400, message: "This model's maximum context length is 8192 tokens"},
        ])
        await assert.rejects(() => withUpstreamRetry({
            invoke: inv.fn, cfg, breaker, breakerKeyOf: () => K, sleep: async () => {},
        }))
        const s = breaker.snapshot().出口[0]
        assert.equal(s.failures, 0, '请求级错误不该推进出口健康计数')
        assert.equal(s.phase, 'closed')
    })

    test('重试中途打开 ⇒ 下一次尝试被拒在门外，本轮以熔断错误结束（这就是"停止 hammering"）', async () => {
        const {breaker, events} = mk()
        const inv = scripted([{message: 'connect ECONNREFUSED'}, {message: 'connect ECONNREFUSED'}, {ok: true}])
        await assert.rejects(() => withUpstreamRetry({
            invoke: inv.fn, cfg, breaker, breakerKeyOf: () => K, sleep: async () => {},
        }), (e) => {
            assert.equal(e.name, 'UpstreamCircuitOpenError')
            return true
        })
        /**
         * 只打了 2 次：第 2 次失败把电路打开，第 3 次就不该再发出去。
         * 如果这里看到 3 次，说明"打开之后继续重试"——那正是 §2B 要治的病。
         */
        assert.equal(inv.calls.length, 2)
        assert.ok(events.some(e => e.note === 'breaker opened'), '打开这件事必须留痕')
    })

    test('半开探测成功 ⇒ 通过主循环闭合电路（不是只靠直接调用 recordSuccess）', async () => {
        const {breaker, tick} = mk()
        breaker.recordFailure({key: K})
        breaker.recordFailure({key: K})
        tick(1000)
        const inv = scripted([{ok: true}])
        const ret = await withUpstreamRetry({
            invoke: inv.fn, cfg, breaker, breakerKeyOf: () => K, sleep: async () => {},
        })
        assert.equal(ret.value, 'value')
        assert.equal(breaker.snapshot().出口[0].phase, 'closed')
    })

    test('换档时用当次那一档的出口键：失败不能记到主档头上', async () => {
        const {breaker} = mk({failureThreshold: 5})
        const MAIN = 'http://main:3009'
        const ALT = 'http://alt:4000'
        const keysSeen = []
        /** 两档都失败：主档试尽 ⇒ 换档 ⇒ 备选档也失败 ⇒ 本轮以原错误结束 */
        const inv = scripted([{status: 503, message: 'main down'}, {status: 503, message: 'alt down'}])
        await assert.rejects(() => withUpstreamRetry({
            invoke: inv.fn,
            cfg: {...cfg, maxAttempts: 1, fallbackModel: 'relay_alt'},
            breaker,
            breakerKeyOf: ({usingFallback}) => {
                const k = usingFallback ? ALT : MAIN
                keysSeen.push(k)
                return k
            },
            fallbackUsable: () => ({ok: true, reason: ''}),
            sleep: async () => {},
        }))
        assert.deepEqual(keysSeen, [MAIN, ALT], '换档前后必须各用自己那一档的出口')
        const snap = Object.fromEntries(breaker.snapshot().出口.map(x => [x.key, x.failures]))
        assert.equal(snap[MAIN], 1, '主档只该记 1 次')
        assert.equal(snap[ALT], 1, '备选档那次失败不能记到主档上')
    })

    test('不传 breaker 时行为与改造前逐字一致（渐进上线的前提）', async () => {
        const inv = scripted([{status: 503, message: 'down'}, {ok: true}])
        const ret = await withUpstreamRetry({
            invoke: inv.fn, cfg, sleep: async () => {}, errorInfoOf: describeError,
        })
        assert.equal(ret.attempts, 2)
        assert.equal(inv.calls.length, 2)
    })

    test('键算不出来（空串）时不许凭空拒：放行给正常错误处理', async () => {
        const {breaker} = mk()
        const inv = scripted([{ok: true}])
        const ret = await withUpstreamRetry({
            invoke: inv.fn, cfg, breaker, breakerKeyOf: () => '', sleep: async () => {},
        })
        assert.equal(ret.value, 'value')
        assert.equal(inv.calls.length, 1)
    })
})
