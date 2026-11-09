import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    classifyUpstreamError,
    backoffMs,
    upstreamRetryDecision,
    UPSTREAM_RETRYABLE_STATUS,
} from '../../../services/core/llmLoop.js'

/**
 * PR-0.5 的重试决策穷举。
 * 这个函数决定"要不要再花一次钱、以及要不要换个模型"，所以每一条边界都必须被钉住：
 * 漏一条 = 生产上要么疯狂重试烧钱，要么一次抖动就整轮失败。
 */

const err = (o) => ({kind: 'api', message: '', status: null, ...o})

describe('classifyUpstreamError：哪些错误重试有意义', () => {
    test('暂时性状态码可重试', () => {
        for (const s of UPSTREAM_RETRYABLE_STATUS) {
            const r = classifyUpstreamError(err({status: s, message: `http ${s}`}))
            assert.equal(r.retryable, true, `${s} 应可重试`)
            assert.equal(r.reason, `status-${s}`)
        }
    })

    test('鉴权/请求本身的错误不可重试：重试只会把额度再烧一遍', () => {
        for (const s of [400, 401, 403, 404, 422]) {
            assert.equal(classifyUpstreamError(err({status: s})).retryable, false, `${s} 不该重试`)
        }
    })

    test('拿不到状态码的传输层错误算可重试（relay 抖动最常见就是这种）', () => {
        const r = classifyUpstreamError(err({kind: 'api', message: 'socket hang up'}))
        assert.deepEqual({retryable: r.retryable, reason: r.reason}, {retryable: true, reason: 'transport'})
    })

    test('客户端断开绝不重试：否则"用户关了页面"会变成"服务端替他重试三轮"', () => {
        const r = classifyUpstreamError({kind: 'abort', message: 'The user aborted a request.', status: null})
        assert.equal(r.retryable, false)
        assert.equal(r.reason, 'abort')
    })

    /**
     * 这条是整个分类器里最容易写错的地方：
     * "上下文超长"通常伴随 400，如果只看状态码就会进退避重试，
     * 结果是**同一份必然失败的请求烧三次钱**，而且三轮都必然失败。
     */
    test('永久错误优先于状态码判定：超长/配额/内容策略直接放弃', () => {
        const cases = [
            {status: 400, message: 'This model\'s maximum context length is 32768 tokens'},
            {status: 400, message: 'context length exceeded, please shorten'},
            {status: 429, message: 'Insufficient quota'},
            {status: 503, message: 'Invalid API key provided'},
            {status: 400, message: 'response flagged by content_policy'},
        ]
        for (const c of cases) {
            const r = classifyUpstreamError(err(c))
            assert.equal(r.retryable, false, `${c.message} 不该重试`)
            assert.equal(r.permanent, true, `${c.message} 应标成 permanent，好让上层知道该走压缩/报错`)
            assert.equal(r.reason, 'permanent')
        }
    })

    test('529（Anthropic 的过载码）在可重试集合里', () => {
        assert.ok(UPSTREAM_RETRYABLE_STATUS.includes(529))
    })
})

describe('backoffMs：满抖动而不是"固定等一会儿"', () => {
    test('rng 注入后是确定值，且随 attempt 指数增长', () => {
        assert.equal(backoffMs({attempt: 1, baseMs: 300, rng: () => 1}), 300)
        assert.equal(backoffMs({attempt: 2, baseMs: 300, rng: () => 1}), 600)
        assert.equal(backoffMs({attempt: 3, baseMs: 300, rng: () => 1}), 1200)
    })

    test('有上限，不会指数爆到几十秒', () => {
        assert.equal(backoffMs({attempt: 12, baseMs: 300, capMs: 4000, rng: () => 1}), 4000)
    })

    /**
     * 满抖动要能取到 0：多实例同时挂时，如果最小等待是 exp/2（equal jitter），
     * 所有实例仍会在同一个半秒窗口里一起打回去。
     */
    test('满抖动的区间是 [0, exp]，不是 [exp/2, exp]', () => {
        assert.equal(backoffMs({attempt: 3, baseMs: 300, rng: () => 0}), 0)
        assert.equal(backoffMs({attempt: 3, baseMs: 300, rng: () => 0.5}), 600)
        assert.equal(backoffMs({attempt: 3, baseMs: 300, rng: () => 1}), 1200)
    })

    test('rng 越界被夹住（防实现把 1.7 之类的值传进来）', () => {
        assert.equal(backoffMs({attempt: 1, baseMs: 300, rng: () => 9}), 300)
        assert.equal(backoffMs({attempt: 1, baseMs: 300, rng: () => -3}), 0)
    })
})

describe('upstreamRetryDecision：重试 / 换档 / 放弃', () => {
    const cfg = {enabled: true, maxAttempts: 3, baseMs: 300, capMs: 4000, fallbackModel: 'relay_qwen_flash'}

    test('默认关：不配 enabled 就一次都不重试（行为必须与改造前完全一致）', () => {
        assert.deepEqual(upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 1}),
            {action: 'fail', delayMs: 0, reason: 'disabled', attempt: 1})
        assert.equal(upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 1, cfg: {}}).reason, 'disabled')
    })

    /** 本 PR 的边界条款，单独钉一次 */
    test('下发过首字节绝不重试——哪怕错误本身完全可重试', () => {
        const r = upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 1, firstByteSent: true, cfg})
        assert.deepEqual({action: r.action, reason: r.reason}, {action: 'fail', reason: 'first-byte-sent'})
    })

    test('首字节前的暂时性错误才重试，并带上退避时长', () => {
        const r = upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 1, cfg, rng: () => 1})
        assert.equal(r.action, 'retry')
        assert.equal(r.delayMs, 600, '第 2 次的指数值')
        assert.equal(r.reason, 'status-503')
    })

    test('429 的 Retry-After 优先于本地退避，但夹在 capMs 内', () => {
        const short = upstreamRetryDecision({errorInfo: err({status: 429}), attempt: 1, cfg, retryAfterMs: 800, rng: () => 1})
        assert.equal(short.delayMs, 800, '上游说了什么时候再来，比猜测准')
        const huge = upstreamRetryDecision({errorInfo: err({status: 429}), attempt: 1, cfg, retryAfterMs: 300000, rng: () => 1})
        assert.equal(huge.delayMs, 4000, '不能因为上游说 5 分钟就把在线请求挂那儿，那是排队不是重试')
    })

    test('试尽 maxAttempts 后换档，且只换一次（不递归换档成环）', () => {
        const r = upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 3, cfg, rng: () => 1})
        assert.equal(r.action, 'fallback')
        assert.equal(r.reason, 'status-503-exhausted')
    })

    test('没配 fallbackModel 时试尽即失败（不能凭空发明一个备选）', () => {
        const r = upstreamRetryDecision({errorInfo: err({status: 503}), attempt: 3, cfg: {...cfg, fallbackModel: ''}, rng: () => 1})
        assert.equal(r.action, 'fail')
        assert.match(r.reason, /attempts-exhausted/)
    })

    test('maxAttempts=1 等于关掉重试但仍保留换档能力', () => {
        const r = upstreamRetryDecision({errorInfo: err({status: 502}), attempt: 1, cfg: {...cfg, maxAttempts: 1}, rng: () => 1})
        assert.equal(r.action, 'fallback')
    })

    test('永久错误不会因为"还有次数"就被重试', () => {
        const r = upstreamRetryDecision({
            errorInfo: err({status: 400, message: 'maximum context length exceeded'}),
            attempt: 1, cfg, rng: () => 1,
        })
        assert.deepEqual({action: r.action, reason: r.reason}, {action: 'fail', reason: 'permanent'})
    })

    test('未知 kind 不重试（宁可少试，不可瞎试）', () => {
        const r = upstreamRetryDecision({errorInfo: {kind: 'unknown', message: 'boom'}, attempt: 1, cfg})
        assert.equal(r.action, 'fail')
        assert.equal(r.reason, 'unknown')
    })
})
