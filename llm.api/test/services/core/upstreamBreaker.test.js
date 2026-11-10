import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    resolveBreakerConfig,
    breakerKeyFor,
    breakerCountsFailure,
    createBreaker,
    getBreaker,
    __resetBreakerForTest,
    BREAKER_DEFAULTS,
    BREAKER_MIN_OPEN_MS,
    BREAKER_MAX_OPEN_MS,
} from '../../../services/core/upstreamBreaker.js'
import {classifyUpstreamError} from '../../../services/core/llmLoop.js'

/**
 * 熔断器的用例。
 * 每条都对应一个**会让熔断本身变成事故**的形状：
 * 误计请求级错误 ⇒ 一个超长请求把所有人的会话判死；半开放多条 ⇒ hammering 只是延后；
 * env 是字符串 ⇒ 参数静默失效（`FASTIFY_CLOSE_GRACE_DELAY` 那条老路）。
 */

describe('resolveBreakerConfig', () => {
    test('默认必须是"关"：会改变现网请求结果的开关不能默认生效', () => {
        const c = resolveBreakerConfig({})
        assert.equal(c.enabled, false)
        assert.equal(c.failureThreshold, BREAKER_DEFAULTS.failureThreshold)
        assert.equal(c.openMs, BREAKER_DEFAULTS.openMs)
    })

    test('字符串 "true" 不算开（配置类型不严判就会静默走成另一条路）', () => {
        assert.equal(resolveBreakerConfig({cfg: {enabled: 'true'}}).enabled, false)
        assert.equal(resolveBreakerConfig({cfg: {enabled: true}}).enabled, true)
    })

    test('env 出来的字符串数字必须换算成 number，并且要留 notes', () => {
        const c = resolveBreakerConfig({cfg: {enabled: true, failureThreshold: '2', openMs: '20000'}})
        assert.equal(typeof c.failureThreshold, 'number')
        assert.equal(typeof c.openMs, 'number')
        assert.equal(c.failureThreshold, 2)
        assert.equal(c.openMs, 20000)
    })

    test('垃圾值退回默认并留痕，不许静默变 NaN', () => {
        const c = resolveBreakerConfig({cfg: {enabled: true, failureThreshold: 'abc', openMs: '30s'}})
        assert.equal(c.failureThreshold, BREAKER_DEFAULTS.failureThreshold)
        assert.equal(c.openMs, BREAKER_DEFAULTS.openMs)
        assert.equal(c.notes.length, 2)
        assert.ok(c.notes.every(n => typeof n === 'string'))
    })

    test('openMs 有上下限：太小会反复吞在途请求，太大等于一次故障永久拒绝', () => {
        assert.equal(resolveBreakerConfig({cfg: {openMs: 1}}).openMs, BREAKER_MIN_OPEN_MS)
        assert.equal(resolveBreakerConfig({cfg: {openMs: 99999999}}).openMs, BREAKER_MAX_OPEN_MS)
        assert.equal(resolveBreakerConfig({cfg: {openMs: 0}}).openMs, BREAKER_DEFAULTS.openMs, '0 视为未设')
    })
})

describe('breakerKeyFor', () => {
    test('12 个同出口的模型档必须收敛到同一个键（否则 D39 的"假装能救"原样复现）', () => {
        const keys = ['pro', 'flash', 'low', 'qwen', 'deepseek', 'vl'].flatMap(family =>
            ['pro', 'flash', 'low'].map(tier =>
                breakerKeyFor({baseURL: 'http://172.17.203.28:3009/v1', modelKey: `relay_${family}_${tier}`})))
        assert.equal(new Set(keys).size, 1, keys.join(','))
    })

    test('不同端口/协议是不同出口，不许捆在一起熔断', () => {
        assert.notEqual(
            breakerKeyFor({baseURL: 'http://172.17.203.28:3009/v1'}),
            breakerKeyFor({baseURL: 'http://172.17.203.28:3010/v1'}))
        assert.notEqual(
            breakerKeyFor({baseURL: 'https://relay.example.com/v1'}),
            breakerKeyFor({baseURL: 'http://relay.example.com/v1'}))
    })

    test('路径不同但同源仍算同一出口（网关整体不可用才是这里要救的）', () => {
        assert.equal(breakerKeyFor({baseURL: 'http://h:3009/v1'}), breakerKeyFor({baseURL: 'http://h:3009/embeddings'}))
    })

    test('坏 URL / 空值不许抛错，也不许退化成同一个空键', () => {
        assert.equal(breakerKeyFor({baseURL: 'not a url', modelKey: 'x'}).startsWith('raw:'), true)
        assert.equal(breakerKeyFor({baseURL: '', modelKey: 'relay_qwen_pro'}), 'unknown:relay_qwen_pro')
        assert.equal(breakerKeyFor({baseURL: '', modelKey: ''}), '')
    })
})

describe('breakerCountsFailure', () => {
    const cls = (e) => classifyUpstreamError(e)

    test('网关级信号计入：5xx、429、无状态码的传输错误', () => {
        for (const e of [{status: 503, message: 'upstream down'}, {status: 429, message: 'slow down'}, {kind: 'api', message: 'ECONNREFUSED'}]) {
            assert.equal(breakerCountsFailure({errorInfo: e, cls: cls(e)}).counts, true, JSON.stringify(e))
        }
    })

    test('请求自身的问题不计入：上下文超长不能把所有人的会话判死', () => {
        for (const e of [
            {status: 400, message: 'This model\'s maximum context length is 8192 tokens'},
            {status: 400, message: 'content filtered by policy'},
        ]) {
            const r = breakerCountsFailure({errorInfo: e, cls: cls(e)})
            assert.equal(r.counts, false, JSON.stringify(e))
        }
    })

    test('abort 绝不计入：用户关页面不该熔断别人的会话', () => {
        const e = {kind: 'abort', message: 'AbortError'}
        const r = breakerCountsFailure({errorInfo: e, cls: cls(e)})
        assert.equal(r.counts, false)
        assert.equal(r.reason, 'abort')
    })

    test('key/额度坏了算网关级（12 档共用一把 key，这是出口级事实）', () => {
        assert.equal(breakerCountsFailure({errorInfo: {status: 401, message: 'nope'}, cls: cls({status: 401, message: 'nope'})}).counts, true)
        assert.equal(breakerCountsFailure({errorInfo: {status: 400, message: 'Invalid API key'}, cls: {}}).counts, true)
        assert.equal(breakerCountsFailure({errorInfo: {status: 400, message: 'Insufficient quota'}, cls: {}}).counts, true)
    })
})

describe('熔断状态机', () => {
    const mk = (over = {}) => {
        let t = 1000
        const br = createBreaker({
            cfg: {enabled: true, failureThreshold: 3, openMs: 1000, ...over},
            now: () => t,
        })
        return {br, tick: (ms) => { t += ms }, at: () => t}
    }
    const K = 'http://relay:3009'

    test('未达阈值不打开；达阈值打开并给出 retryAfterMs', () => {
        const {br, tick} = mk()
        br.recordFailure({key: K})
        br.recordFailure({key: K})
        assert.equal(br.allow({key: K}).allowed, true)
        br.recordFailure({key: K})
        const a = br.allow({key: K})
        assert.equal(a.allowed, false)
        assert.equal(a.reason, 'open')
        assert.equal(a.retryAfterMs, 1000)
        tick(400)
        assert.equal(br.allow({key: K}).retryAfterMs, 600, '剩余时间必须递减，否则调用方拿不到可用的 Retry-After')
    })

    test('成功清零计数：失败的"连续性"才是信号，总量不是', () => {
        const {br} = mk()
        br.recordFailure({key: K})
        br.recordFailure({key: K})
        br.recordSuccess({key: K})
        br.recordFailure({key: K})
        br.recordFailure({key: K})
        assert.equal(br.allow({key: K}).allowed, true, '中间成功过，不该累计成熔断')
    })

    test('到期只放一条探测，第二条必须仍被拒', () => {
        const {br, tick} = mk()
        for (let i = 0; i < 3; i++) {
            br.recordFailure({key: K})
        }
        tick(1000)
        assert.equal(br.allow({key: K}).reason, 'half-open-probe')
        const second = br.allow({key: K})
        assert.equal(second.allowed, false)
        assert.equal(second.reason, 'probe-in-flight', '半开放多条等于把 hammering 延后一轮，不是熔断')
    })

    test('探测失败立刻重新打开（不再等满阈值）；探测成功则闭合', () => {
        const {br, tick} = mk()
        for (let i = 0; i < 3; i++) {
            br.recordFailure({key: K})
        }
        tick(1000)
        br.allow({key: K})
        br.recordFailure({key: K})
        assert.equal(br.allow({key: K}).allowed, false, '半开探测失败必须马上重开')
        assert.equal(br.allow({key: K}).phase, 'open')

        tick(1000)
        assert.equal(br.allow({key: K}).reason, 'half-open-probe')
        br.recordSuccess({key: K})
        assert.equal(br.allow({key: K}).allowed, true)
        assert.equal(br.snapshot().出口[0].phase, 'closed')
    })

    test('不计入的失败绝不能推进阈值', () => {
        const {br} = mk()
        for (let i = 0; i < 10; i++) {
            br.recordFailure({key: K, counts: false, reason: 'permanent'})
        }
        assert.equal(br.allow({key: K}).allowed, true)
        assert.equal(br.snapshot().出口[0].failures, 0)
    })

    test('关着的时候什么都不做（默认状态的失效方向必须是"不做事"）', () => {
        const {br} = mk({})
        const off = createBreaker({cfg: {enabled: false}})
        for (let i = 0; i < 50; i++) {
            off.recordFailure({key: K})
        }
        assert.equal(off.allow({key: K}).allowed, true)
        assert.equal(off.allow({key: K}).reason, 'breaker-disabled')
        assert.equal(br.config.enabled, true)
    })

    test('算不出键时放行而不是拒：凭空把全部流量捆在一起熔断更糟', () => {
        const {br} = mk()
        assert.equal(br.allow({key: ''}).allowed, true)
        assert.equal(br.allow({key: ''}).reason, 'no-key')
    })

    test('不同出口互不牵连：坏的那个不能拖死好的', () => {
        const {br} = mk()
        const BAD = 'http://bad:1'
        const OK = 'http://ok:1'
        for (let i = 0; i < 3; i++) {
            br.recordFailure({key: BAD})
        }
        assert.equal(br.allow({key: BAD}).allowed, false)
        assert.equal(br.allow({key: OK}).allowed, true)
    })

    test('snapshot 要能直接贴进 /runStats（相位、失败数、打开多久都在）', () => {
        const {br, tick} = mk()
        for (let i = 0; i < 3; i++) {
            br.recordFailure({key: K})
        }
        tick(500)
        const s = br.snapshot()
        assert.equal(s.enabled, true)
        assert.equal(s.failureThreshold, 3)
        assert.equal(s.出口[0].phase, 'open')
        assert.equal(s.出口[0].failures, 3)
        assert.equal(s.出口[0].openedAgoMs, 500)
    })
})

describe('getBreaker 单例', () => {
    test('同一配置复用同一实例；配置变了必须重建（否则改了 env 还拿旧参数）', () => {
        __resetBreakerForTest()
        const a = getBreaker({cfg: {enabled: true, failureThreshold: 3, openMs: 2000}})
        const b = getBreaker({cfg: {enabled: true, failureThreshold: 3, openMs: 2000}})
        assert.equal(a, b)
        const c = getBreaker({cfg: {enabled: true, failureThreshold: 9, openMs: 2000}})
        assert.notEqual(a, c)
        assert.equal(c.config.failureThreshold, 9)
        __resetBreakerForTest()
    })
})
