/**
 * @fileOverview PR-E0.4 的行为验证：关闭时正在跑的 run 会怎样
 * @module evals/platform-probes/shutdown-midrun-probe
 * @description
 * 这条验证要回答的是 §2B.3 的原始问题：**发版那一刻正在生成的那一轮，用户和档案会看到什么**。
 *
 * Windows 上 SIGTERM 不能可靠送到 Node 的信号监听器（`process.kill` 走 TerminateProcess），
 * 所以这里不装信号，而是**直接调用与监听器完全相同的那一句 `app.close()`**——
 * `closeWithGrace` 的监听体只有一行 `await app.close()`，两者等价，
 * 于是"close 会不会等在途请求、检查点与 message 行落不落"这两个真问题照样能测。
 *
 * 用法（在 `src/` 下）：
 *   $env:checkpoint_enabled='true'; node evals/platform-probes/shutdown-midrun-probe.mjs
 *
 * 只写自己新建的 conversationCode。
 */
import appService from '../../app.js'
import Fastify from 'fastify'
import {accessLoggerOptions} from '../../logger/index.js'

const PORT = Number(process.env.PROBE_PORT || 12012)
const USER = {userCode: 'menglb', realName: '探针'}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const log = (note, obj) => console.log(JSON.stringify({probe: 'shutdown-midrun', note, ...obj}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const app = Fastify({logger: accessLoggerOptions})
await app.register(appService)
await app.listen({port: PORT, host: '127.0.0.1'})
log('服务已起', {port: PORT})

const conversationCode = `smr-${Date.now()}`

/**
 * @description 起一条流，读到第一个 delta 就返回（不读完）
 * @returns {Promise<{abort: Function, stats: Object}>} 控制句柄与统计
 */
async function startStream() {
    const ac = new AbortController()
    const stats = {chars: 0, events: 0, frames: [], done: false, closedAt: null}
    const firstDelta = new Promise(resolve => {
        ;(async () => {
            try {
                const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/stream`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': b64(USER)},
                    body: JSON.stringify({
                        query: '请写一篇 600 字左右的散文，主题是深夜的图书馆，要求分段、有细节。',
                        conversationCode,
                        options: {channel: 'xxzx_common', protocol: 2, cache: false},
                    }),
                    signal: ac.signal,
                })
                const dec = new TextDecoder()
                let buf = ''
                for await (const cv of r.body) {
                    buf += dec.decode(cv, {stream: true})
                    let i
                    while ((i = buf.indexOf('\n\n')) >= 0) {
                        const f = buf.slice(0, i); buf = buf.slice(i + 2)
                        const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                        const data = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
                        stats.events++
                        stats.frames.push(ev)
                        if (ev === 'delta') {
                            try { stats.chars += (JSON.parse(data)?.content || '').length } catch { /* 忽略 */ }
                            resolve()
                        } else if (ev === 'done') {
                            stats.done = true
                            resolve()
                        } else if (ev === 'error') {
                            stats.error = data.slice(0, 120)
                            resolve()
                        }
                    }
                }
            } catch (e) {
                stats.aborted = String(e?.message || e).slice(0, 80)
                resolve()
            } finally {
                stats.closedAt = Date.now()
            }
        })()
    })
    return {abort: () => ac.abort(), stats, firstDelta}
}

const s = await startStream()
await Promise.race([s.firstDelta, sleep(20000)])
const atClose = {chars: s.stats.chars, events: s.stats.events}
log('已收到首个 delta，开始模拟停机', {已收字符: atClose.chars, 帧数: atClose.events})

const t0 = Date.now()
await app.close()
const closeMs = Date.now() - t0
log('app.close 返回', {close耗时ms: closeMs, 流是否自然收尾: s.stats.done, 结束时字符: s.stats.chars, 帧: [...new Set(s.stats.frames)]})

/* 档案侧：这一轮到底留下了什么。
 * 注意**不能用 messageDac 读**：上面的 app.close() 已经把模块级共享连接关掉了，
 * 那样读会拿到 "Client must be connected"，看着像"档案没落"，其实是探针自己把连接关了。
 * 这里另建一条临时连接读两张表。 */
await sleep(1500)
const {default: mongoose} = await import('mongoose')
const cfg = llm.config.mongodbConfig
const conn = await mongoose.createConnection(cfg.uri, {...cfg.options, autoIndex: false}).asPromise()
const doc = await conn.collection('message').find({conversationCode}).sort({insertTime: -1}).limit(1).next()
const cps = await conn.collection('sessionCheckpoint').find({conversationCode}, {projection: {phase: 1, seq: 1}}).toArray()
await conn.close()

const msg = doc ? {
    progress: doc.progress,
    answerLen: (doc.answer || '').length,
    loopExit: doc.extInfo?.loopExit,
    iterationCount: doc.extInfo?.iterationCount,
    modelCalls: doc.extInfo?.usage?.modelCalls,
} : null

log('档案', {
    message: msg,
    检查点: {行数: cps.length, 阶段: cps.reduce((a, c) => ({...a, [c.phase]: (a[c.phase] || 0) + 1}), {})},
})

const waited = s.stats.chars > atClose.chars || s.stats.done
log('结论', {
    close_等在途请求: waited,
    有message行: !!msg,
    message是完成态: msg?.progress === 'finish',
    有检查点: cps.length > 0,
    判定: waited && msg
        ? `✅ app.close() 会等在途 SSE 跑完（close 用 ${closeMs}ms），这一轮落了档${cps.length ? '并留下检查点' : ''} ⇒ 45s 宽限确实把"发版截断"变成了"跑完再走"`
        : `❌ 在途 run 没有被等完（close ${closeMs}ms，流${s.stats.done ? '自然收尾' : '被打断'}）⇒ 宽限或 Fastify 的 close 语义与预期不符，需要重新设计`,
})
process.exit(0)
