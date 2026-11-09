/**
 * @fileOverview PR-0.5 的端到端验证：假 relay 上区分"首字节前失败"与"首字节后失败"
 * @module evals/platform-probes/upstream-retry-probe
 * @description
 * 单元测试证明的是决策函数与包装器的逻辑；这条探针证明的是**接线**：
 * `llmChat` 是否真的把 `markFirstByte` 打在"下发之前"，以及重试是否真的只在首字节前发生。
 *
 * 做法：起一个假的 OpenAI 兼容 relay（HTTP），按剧本回 503 或回 SSE；本地起 llm.api 打真实请求，
 * 看三件事：① relay 收到几次请求（=重试次数）② 客户端内容有没有重复（重复=红线被破）
 * ③ 默认关时是否**一次都不重发**（保证不配就等于现状）。
 *
 * 用法（在 `src/` 下，三个场景各起一个进程）：
 *   foreach($n in 1,2,3){ node evals/platform-probes/upstream-retry-probe.mjs --scenario=$n }
 *
 * 场景：1=首字节前 503 两次（应重试并拿到完整答案）；2=同剧本但不开重试（必须只打 1 次）；
 *       3=吐了一半内容再断开（**绝不允许重发**）。
 *
 * 两条让"装置没通电"再也混不过去的自检（v1.27 那次 0/6 的教训）：
 * - `relay收到请求 === 0` 直接判失败：说明 env 没生效、请求打到别处去了；
 * - 探针会先把生效的 baseURL 打进日志，肉眼可核对它指的是假 relay 而不是真 relay。
 */
import http from 'node:http'

const PORT = Number(process.env.PROBE_PORT || 12016)
const RELAY_PORT = Number(process.env.PROBE_RELAY_PORT || 3099)
const SCENARIO = Number((process.argv.find(a => a.startsWith('--scenario=')) || '').split('=')[1] || 1)
const log = (note, obj) => console.log(JSON.stringify({probe: 'upstream-retry', note, ...obj}))

/** 让所有相关档位都指向假 relay：不这么做，"重试"根本无从发生 */
const RELAY_BASE = `http://127.0.0.1:${RELAY_PORT}/v1`
Object.assign(process.env, {
    upstreamRetry_enabled: 'true',
    upstreamRetry_maxAttempts: '3',
    upstreamRetry_baseMs: '10',
    upstreamRetry_capMs: '20',
    relay_common_pro_baseURL: RELAY_BASE,
    relay_common_pro_apiKey: 'sk-fake',
    relay_qwen_flash_baseURL: RELAY_BASE,
    relay_qwen_flash_apiKey: 'sk-fake',
    relay_deepseek_pro_baseURL: RELAY_BASE,
    relay_deepseek_pro_apiKey: 'sk-fake',
})
if (SCENARIO === 2) {
    process.env.upstreamRetry_enabled = 'false'
}

/**
 * @description 场景定义
 * @param {Number} n 场景号
 * @returns {Object} 剧本与期望
 */
function scenarioOf(n) {
    if (n === 2) {
        return {name: '不开重试（现状基线）', desc: '同样前 2 次 503，但 enabled=false', failTimes: 2, failAfterByte: false}
    }
    if (n === 3) {
        return {name: '已吐字后断开', desc: '第 1 次吐一半再断（红线：不许重试）', failTimes: 1, failAfterByte: true}
    }
    /**
     * 场景 4/5 是为了一条"没人记着的既有行为"而加的：
     * 关掉我们的重试之后 relay 仍然收到 3 次请求 ⇒ **OpenAI SDK 自己默认重试 2 次**。
     * 4 证明它的次数，5 证明它与我们的重试会**相乘**（3×3=9 次上游调用）。
     */
    if (n === 4) {
        return {name: 'SDK 隐式重试（我们这边全关）', desc: '一直 503 且 enabled=false ⇒ 看 SDK 自己打几次', failTimes: 99, failAfterByte: false, expectMaxRetries: 0}
    }
    if (n === 5) {
        return {name: '两层重试相乘', desc: '一直 503、我们的 maxAttempts=3 ⇒ 看 relay 实际收到几次', failTimes: 99, failAfterByte: false}
    }
    return {name: '首字节前 503 两次', desc: '前 2 次 503、第 3 次成功 ⇒ 应重试且内容不重复', failTimes: 2, failAfterByte: false}
}

const sc = scenarioOf(SCENARIO)

/**
 * @description 起假 relay
 * @param {Number} failTimes 前几次返回 503
 * @param {Boolean} failAfterByte 是否在吐字之后直接断开连接
 * @returns {Promise<{server: Object, stats: Object}>} 装置与计数
 */
function makeFakeRelay(failTimes, failAfterByte) {
    const stats = {requests: 0, models: []}
    const server = http.createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => {
            raw += c
        })
        req.on('end', async () => {
            stats.requests++
            try {
                stats.models.push(JSON.parse(raw).model)
            } catch (e) {
                stats.models.push('?')
            }
            if (stats.requests <= failTimes) {
                if (!failAfterByte) {
                    res.writeHead(503, {'Content-Type': 'application/json'})
                    return res.end(JSON.stringify({error: {message: 'upstream unavailable', type: 'api_error'}}))
                }
                res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'})
                res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"前半段"}}]}\n\n')
                await new Promise(r => setTimeout(r, 30))
                return res.destroy()
            }
            res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'})
            res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"答案正文"}}]}\n\n')
            res.write('data: {"choices":[{"index":0,"delta":{"content":"，只有一份"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":5,"total_tokens":16}}\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
        })
    })
    return new Promise(resolve => server.listen(RELAY_PORT, '127.0.0.1', () => resolve({server, stats})))
}

const fake = await makeFakeRelay(sc.failTimes, sc.failAfterByte)

/* env 必须先设好，再动态装 app：`conf/llmModel.js` 在导入期就把 baseURL 算完了 */
const {default: appService} = await import('../../app.js')
const {accessLoggerOptions} = await import('../../logger/index.js')
const {default: Fastify} = await import('fastify')

log('装置通电自检', {假relay: RELAY_BASE, 场景: SCENARIO, 剧本: sc.desc, 重试配置: {
    enabled: process.env.upstreamRetry_enabled, maxAttempts: process.env.upstreamRetry_maxAttempts,
}})

const app = Fastify({logger: accessLoggerOptions})
await app.register(appService)
await app.listen({port: PORT, host: '127.0.0.1'})

const conversationCode = `urp${SCENARIO}-${Date.now()}`
const frames = []
let content = ''
try {
    const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'text/event-stream',
            'user-info': Buffer.from(JSON.stringify({userCode: 'menglb', realName: '探针'})).toString('base64'),
        },
        body: JSON.stringify({
            query: '请用固定四个字回答：测试通过',
            conversationCode,
            options: {channel: 'xxzx_common', protocol: 2, cache: false},
        }),
        signal: AbortSignal.timeout(60000),
    })
    const dec = new TextDecoder()
    let buf = ''
    for await (const cv of r.body) {
        buf += dec.decode(cv, {stream: true})
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
            const f = buf.slice(0, i); buf = buf.slice(i + 2)
            const ev = (/event:(\S+)/.exec(f)?.[1] || 'delta')
            frames.push(ev)
            if (ev === 'delta') {
                try {
                    content += (JSON.parse((/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, ''))?.content || '')
                } catch (e) { /* 忽略 */ }
            } else if (ev === 'error') {
                log('收到 error 帧', {内容: (/data:([\s\S]+)/.exec(f)?.[1] || '').slice(0, 200)})
            }
        }
    }
} catch (e) {
    frames.push(`exception:${String(e?.message || e).slice(0, 80)}`)
} finally {
    await app.close()
}

const got = {
    scenario: SCENARIO,
    名称: sc.name,
    relay收到请求: fake.stats.requests,
    打到relay的模型: [...new Set(fake.stats.models)],
    客户端内容: content,
    帧: [...new Set(frames)],
    重复吐字: (content.match(/答案正文/g) || []).length > 1,
}
fake.server.close()

/**
 * 期望值。三个场景的期望来自两条**取证到的事实**，不是猜的：
 * - SDK 默认 `maxRetries=2` ⇒ 我们这层关掉时，一次调用内部最多打 relay 3 次（场景 2/4）。
 *   **基线不是 1，是 3**：把它写成 1 就会得出"重试层生效了/没生效"的错误结论。
 * - 我们这层开着时 client 的 `maxRetries` 被置 0 ⇒ relay 次数就等于我们的 attempts，两层不相乘（场景 1/5）。
 */
function expectationOf(n) {
    if (n === 2) {
        return {ok: (g) => g.relay收到请求 === 3, why: '关掉我们这层 ⇒ 只剩 SDK 的 2 次隐式重试（=3 次请求），与改造前一致'}
    }
    if (n === 3) {
        return {ok: (g) => g.relay收到请求 === 1, why: '已吐字的失败绝不重发'}
    }
    if (n === 4) {
        return {ok: (g) => g.relay收到请求 === 3 && g.帧.some(f => /error|exception/.test(f)), why: '一直 503 且我们这层关 ⇒ SDK 打满 3 次后整轮失败'}
    }
    if (n === 5) {
        return {ok: (g) => g.relay收到请求 === 3, why: '一直 503、maxAttempts=3 ⇒ 只由我们这层出 3 次，不再相乘成 9'}
    }
    return {ok: (g) => g.relay收到请求 >= 3 && !g.重复吐字 && g.客户端内容.includes('答案正文'), why: '前 2 次 503、第 3 次成功 ⇒ 重试后拿到完整且不重复的答案'}
}

const exp = expectationOf(SCENARIO)
/** 装置自检：0 次请求说明 env 没生效（请求打到真 relay 去了），这种失败绝不能被读成"重试没触发" */
const pass = got.relay收到请求 > 0 && !got.客户端内容.includes('测试通过') && exp.ok(got)
log('结果', {
    ...got,
    期望: exp.why,
    判定: pass
        ? `✅ 场景${SCENARIO}（${sc.name}）符合预期`
        : `❌ 场景${SCENARIO}（${sc.name}）不符合预期：${JSON.stringify(got)}`,
})
process.exit(pass ? 0 : 1)

