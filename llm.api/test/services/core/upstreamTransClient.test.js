import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {createTransClient} from '../../../services/core/upstreamTransClient.js'
import {parseRetryAfterMs} from '../../../services/core/llmLoop.js'

/**
 * 翻译链路上游客户端的用例。
 * 它存在的意义就是"此前 4 处直连绕过了退避与熔断"，所以断言全部围绕
 * **有没有真的经过那两层**，以及**与 chat 主循环的口径是否一致**。
 */

const MODEL = {key: 'relay_common_flash', apiKey: 'k', baseURL: 'http://relay:3009/v1'}

/**
 * @description 造一套可记录的假件
 * @param {Object} [opt] 选项
 * @returns {Object} 部件
 */
function fake(opt = {}) {
    const seen = {rawOpts: null, retryArgs: null, createArgs: null, keyOfCalls: [], logs: []}
    const raw = {
        chat: {
            completions: {
                create: async (body, opts) => {
                    seen.createArgs = {body, opts}
                    if (opt.rawThrows) {
                        throw opt.rawThrows
                    }
                    return {choices: [{message: {content: '译文'}}]}
                },
            },
        },
    }
    return {
        seen,
        modelConfig: opt.modelConfig || MODEL,
        makeRaw: (opts) => {
            seen.rawOpts = opts
            return raw
        },
        retryCfg: opt.retryCfg || {enabled: true, maxAttempts: 3, baseMs: 1, capMs: 2},
        breaker: opt.breaker === null ? null : (opt.breaker || {
            allow: () => ({allowed: true, reason: 'closed', retryAfterMs: 0, phase: 'closed'}),
            recordFailure: () => ({}),
            recordSuccess: () => ({}),
            snapshot: () => ({enabled: true, 出口: []}),
            config: {enabled: true},
        }),
        keyOf: ({modelConfig}) => {
            seen.keyOfCalls.push(modelConfig.key)
            return `key:${modelConfig.key}`
        },
        withUpstreamRetry: async (args) => {
            seen.retryArgs = args
            const value = await args.invoke({attempt: 1, usingFallback: false, markFirstByte: () => {}})
            return {value, attempts: 1, usingFallback: false}
        },
        parseRetryAfterMs,
        log: (e) => seen.logs.push(e),
    }
}

describe('createTransClient', () => {
    test('缺 modelConfig 必须立刻报错，不能悄悄造一个无 key 的客户端', () => {
        const f = fake()
        assert.throws(() => createTransClient({...f, modelConfig: null}), /modelConfig/)
    })

    test('启用退避时 SDK 隐式重试必须显式设 0（否则"我们的重试 × SDK 的重试"叠乘）', () => {
        const on = createTransClient(fake({}))
        const seen = []
        const raw = {chat: {completions: {create: async () => ({})}}}
        const f2 = fake({retryCfg: {enabled: true}})
        f2.makeRaw = (o) => {
            seen.push(o)
            return raw
        }
        createTransClient(f2)
        assert.equal(seen[0].maxRetries, 0)

        const f3 = fake({retryCfg: {enabled: false}})
        const seen3 = []
        f3.makeRaw = (o) => {
            seen3.push(o)
            return raw
        }
        createTransClient(f3)
        assert.equal(seen3[0].maxRetries, undefined, '未启用退避时不动 SDK 默认（保持改造前行为）')
        assert.ok(on)
    })

    test('create 必须经过 withUpstreamRetry，并把原始响应当作结果返回', async () => {
        const f = fake()
        const client = createTransClient(f)
        const ret = await client.chat.completions.create({model: 'm', stream: false}, {timeout: 1234})
        assert.equal(ret.choices[0].message.content, '译文')
        assert.ok(f.seen.retryArgs, '没有经过退避包装 ⇒ 这次收编是假的')
        assert.deepEqual(f.seen.createArgs.body, {model: 'm', stream: false})
        assert.deepEqual(f.seen.createArgs.opts, {timeout: 1234}, 'SDK 选项要原样透传')
    })

    test('翻译不换档：即便全局配了 fallbackModel，这里也必须被强制清空', async () => {
        const f = fake({retryCfg: {enabled: true, maxAttempts: 3, fallbackModel: 'relay_qwen_pro'}})
        const client = createTransClient(f)
        await client.chat.completions.create({})
        assert.equal(f.seen.retryArgs.cfg.fallbackModel, '',
            '换档会改变译文风格；翻译不是必须成功的主链路，宁可失败也不悄悄换口味')
    })

    test('熔断键按当次档位算：VL 档与 flash 档各记各的出口', async () => {
        const f = fake({modelConfig: {key: 'relay_qwen_vl_pro', apiKey: 'k', baseURL: 'http://vl:3009/v1'}})
        const client = createTransClient(f)
        await client.chat.completions.create({})
        /**
         * 键是**惰性求值**的（真实包装器在每次尝试前才调 `breakerKeyOf`），
         * 所以这里必须按真实用法去调它，而不是期待 create() 过程中已经有人调过——
         * 上一版就是这么错的：假包装器不会主动调，于是记录恒为空，断言"失败得很有道理"。
         */
        assert.equal(f.seen.retryArgs.breakerKeyOf(), 'key:relay_qwen_vl_pro')
        assert.deepEqual(f.seen.keyOfCalls, ['relay_qwen_vl_pro'])
    })

    test('没给熔断器时也要能工作（只走退避），且不许造出假的 keyOf', async () => {
        const f = fake({breaker: null})
        const client = createTransClient(f)
        await client.chat.completions.create({})
        assert.equal(f.seen.retryArgs.breaker, null)
        assert.equal(f.seen.retryArgs.breakerKeyOf, undefined)
    })

    test('Retry-After 走同一个解析器（与 chat 主循环同口径，不另写一套）', async () => {
        const f = fake()
        const client = createTransClient(f)
        await client.chat.completions.create({})
        const fn = f.seen.retryArgs.retryAfterMsOf
        assert.equal(typeof fn, 'function')
        assert.equal(fn({headers: {'retry-after': '2'}}), 2000)
        assert.equal(fn({}), 0)
    })

    test('上游抛错时原样上抛（上层要按 describeError 的 kind 决定落库形态，不许在中间层吞掉）', async () => {
        const boom = new Error('upstream 503')
        boom.status = 503
        const raw = {chat: {completions: {create: async () => { throw boom }}}}
        const f = fake()
        f.makeRaw = () => raw
        f.withUpstreamRetry = async (args) => {
            const value = await args.invoke({attempt: 1, usingFallback: false, markFirstByte: () => {}})
            return {value}
        }
        const client = createTransClient(f)
        await assert.rejects(() => client.chat.completions.create({}), /upstream 503/)
    })
})
