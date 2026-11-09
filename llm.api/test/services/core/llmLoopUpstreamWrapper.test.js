import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {canFallbackTo, withUpstreamRetry} from '../../../services/core/llmLoop.js'

/**
 * `withUpstreamRetry` 是"要不要再花一次钱"的执行体，所以它必须被当成有状态的东西来测：
 * 光测决策函数不够——包装器如果把 `markFirstByte` 的时序搞错，决策再对也会重复吐字。
 * 这里的 sleep 全部注入成"只记时长不真等"，测试跑完就能看见退避序列。
 */

const CFG = {enabled: true, maxAttempts: 3, baseMs: 300, capMs: 4000, fallbackModel: 'relay_qwen_flash'}

/**
 * @description 造一个"前 N 次抛错、之后成功"的 invoke
 * @param {Number} failTimes 前几次失败
 * @param {Object} [opts] 错误形态与是否在下发前标记首字节
 * @returns {{invoke: Function, calls: Array, waits: Array}} 装置
 */
function scripted(failTimes, {errorStatus = 503, markByteAt = -1, markFirstByte = false} = {}) {
    const calls = []
    let n = 0
    const invoke = async ({attempt, usingFallback, markFirstByte: mark}) => {
        n++
        calls.push({attempt, usingFallback})
        if (n === markByteAt && mark) {
            /** 模拟"已经吐了字才挂"：这是唯一必须禁止重试的形态 */
            mark()
        }
        if (n <= failTimes) {
            throw Object.assign(new Error(`http ${errorStatus}`), {status: errorStatus})
        }
        return {ok: true, attempt, usingFallback}
    }
    return {invoke, calls}
}

const mkSleep = (waits) => async (ms) => {
    waits.push(ms)
}

describe('withUpstreamRetry：重试时序', () => {
    test('成功就不重试，也不记任何等待', async () => {
        const waits = []
        const s = scripted(0)
        const ret = await withUpstreamRetry({invoke: s.invoke, cfg: CFG, sleep: mkSleep(waits), rng: () => 1})
        assert.equal(ret.attempts, 1)
        assert.deepEqual(ret.value, {ok: true, attempt: 1, usingFallback: false})
        assert.deepEqual(waits, [])
    })

    test('暂时性错误重试到成功，退避次数 = 尝试数 - 1', async () => {
        const waits = []
        const s = scripted(2)
        const ret = await withUpstreamRetry({invoke: s.invoke, cfg: CFG, sleep: mkSleep(waits), rng: () => 1})
        assert.equal(ret.attempts, 3)
        assert.equal(waits.length, 2)
        assert.deepEqual(waits, [600, 1200], '指数退避：rng=1 时应为 base*2^n')
        assert.equal(s.calls.length, 3)
    })

    /** 本 PR 最重要的一条：吐过字之后失败，一次都不许再打 */
    test('已下发首字节后失败：立即抛出，不重试、不换档', async () => {
        const waits = []
        const s = scripted(1, {markByteAt: 1})
        await assert.rejects(() => withUpstreamRetry({
            invoke: s.invoke, cfg: CFG, sleep: mkSleep(waits), rng: () => 1,
        }), /http 503/)
        assert.equal(s.calls.length, 1, '只打了一次')
        assert.deepEqual(waits, [])
    })

    test('永久错误不重试：400 的"上下文超长"重试一万次也是超长', async () => {
        const calls = []
        await assert.rejects(() => withUpstreamRetry({
            invoke: async ({attempt}) => {
                calls.push(attempt)
                throw Object.assign(new Error('This model\'s maximum context length is 32768 tokens'), {status: 400})
            },
            cfg: CFG, sleep: async () => {}, rng: () => 1,
        }))
        assert.deepEqual(calls, [1])
    })

    test('客户端断开不重试，且原样抛出同一个错误对象（上层要靠它分 abort 语义）', async () => {
        const thrown = []
        const abortErr = Object.assign(new Error('The user aborted a request.'), {name: 'AbortError'})
        await assert.rejects(() => withUpstreamRetry({
            invoke: async () => {
                throw abortErr
            },
            cfg: CFG, sleep: async () => {},
        }), (e) => {
            thrown.push(e)
            return e === abortErr
        })
        assert.equal(thrown[0], abortErr, '不能被包装成新错误：describeError 的 abort 判定依赖原对象')
    })

    test('试尽主档后换一次档，且换档后失败不再回退主档', async () => {
        const waits = []
        const s = scripted(99)
        await assert.rejects(() => withUpstreamRetry({
            invoke: s.invoke, cfg: CFG, sleep: mkSleep(waits), rng: () => 1,
        }))
        /** 主档 3 次 + 备选 1 次 = 4 次，不会来回横跳 */
        assert.equal(s.calls.length, 4)
        assert.deepEqual(s.calls.map(c => c.usingFallback), [false, false, false, true])
        assert.equal(waits.length, 2, '换档本身不等待')
    })

    test('换档可行性被拦时：不进换档，直接失败（不换到一个装不下的档位）', async () => {
        const s = scripted(99)
        const notes = []
        await assert.rejects(() => withUpstreamRetry({
            invoke: s.invoke,
            cfg: CFG,
            sleep: async () => {},
            rng: () => 1,
            fallbackUsable: () => ({ok: false, reason: '装不下：need 90000 > have 32768'}),
            log: (o) => notes.push(o),
        }))
        assert.equal(s.calls.length, 3, '主档试尽即止，一次换档都没打')
        assert.equal(s.calls.every(c => !c.usingFallback), true)
        assert.ok(notes.some(n => n.note === '换档被可行性检查拦住'), '拦下来必须留痕，不能静默降级')
    })

    test('没配备选时只重试主档，且 log 里每一步都有 action 可查', async () => {
        const notes = []
        const s = scripted(99)
        await assert.rejects(() => withUpstreamRetry({
            invoke: s.invoke, cfg: {...CFG, fallbackModel: ''}, sleep: async () => {},
            rng: () => 1, log: (o) => notes.push(o),
        }))
        assert.equal(s.calls.length, 3)
        assert.deepEqual(notes.map(n => n.action), ['retry', 'retry', 'fail'])
    })

    test('enabled=false 时一次失败就抛（默认行为与改造前完全一致）', async () => {
        const s = scripted(1)
        await assert.rejects(() => withUpstreamRetry({invoke: s.invoke, cfg: {}, sleep: async () => {}}))
        assert.equal(s.calls.length, 1)
    })
})

describe('canFallbackTo：换档前必须核窗口', () => {
    test('装得下才换', () => {
        const target = {model: 'qwen-flash', contextWindow: 65536, maxTokens: 32768}
        assert.equal(canFallbackTo({tokens: 20000, target, slackTokens: 4096}).ok, true)
    })

    test('装不下就拒绝：这是把"可重试的 503"变成"必然失败的 400"的那条路', () => {
        const target = {model: 'qwen-low', contextWindow: 32768, maxTokens: 16384}
        const r = canFallbackTo({tokens: 20000, target, slackTokens: 4096})
        assert.equal(r.ok, false)
        assert.match(r.reason, /装不下/)
    })

    test('没有目标档位 / 窗口未知都不许换', () => {
        assert.equal(canFallbackTo({tokens: 1, target: null}).reason, 'no-target')
        assert.equal(canFallbackTo({tokens: 1, target: {model: 'x'}}).reason, 'target-window-unknown')
    })
})
