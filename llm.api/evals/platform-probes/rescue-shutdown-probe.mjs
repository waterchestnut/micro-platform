/**
 * @fileOverview `PERSIST_VIA.RESCUE` 的可达性复现（停机时 run 卡在归档等待里）
 * @module evals/platform-probes/rescue-shutdown-probe
 * @description
 * 这个落库点此前**在 dev 与 cw2pc 都没有现场样本**。原因不是没走到过发版，
 * 而是**正常返回的上游永远走不到它**：close-with-grace 会把在途 SSE 等完
 * （`shutdown-midrun-probe` 实测过这一点并判为"修法有效"），run 于是走 `loop-exit`/`normal` 落 `finish`；
 * 而 rescue 的条件是"**停机已开始，1 秒归档等待里 run 还没到落库点，且手里已经有正文**"。
 *
 * 所以复现需要三件事同时成立：
 * 1. 有正文（没正文时**按设计不写**——写 0 字 abort 会挡住随后真正的 finish，v1.41 的读数定的规矩）；
 * 2. 停机被触发。Windows 送不出可靠的 SIGTERM，所以这里按**信号路径真正执行的那两句**执行：
 *    `beginShutdown()` 然后 `closeWithRescue({app, delayMs})`（`server.js` 的 closeWithGrace 监听体就是这个顺序）。
 *    直接调裸 `app.close()` 走不到抢救分支（实测：close 20s 未返回、库里 0 行）；
 *    漏掉 `beginShutdown()` 则 `isClosing()` 为假，`interruptedBy` 会被探针自己写成 `client-disconnect`
 *    ——那是仪器造成的假归因，不是被测代码的行为。
 * 3. 剩下的按期望点分岔：
 *    - `rescue`：下一轮上游调用**卡住不返回**（`--stallRound`）⇒ 1 秒归档等待里 run 到不了落库点；
 *    - `finalize-interrupted`：`maxIterations=1` 让第二次调用成为**收尾调用**，再让它
 *      **在停止位之后还送一帧**（`--finalizeTailMs`）⇒ `drained.stopped` 置起。
 *      这一条是 2026-11-13 用客户端 abort 复现失败后读代码定下的：`shouldStop` 是"每帧之前"问，
 *      客户端断开会让正在 await 的那帧直接抛错，所以**只有优雅关闭能走到这里**。
 *
 * 用法（在 `src/` 下）：
 *   # rescue
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13020 --rounds=2 --stallRound=1 --delay=200
 *   $env:PROBE_RELAY='http://127.0.0.1:13020/v1'; node evals/platform-probes/rescue-shutdown-probe.mjs --expect=rescue
 *   # finalize-interrupted
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13022 --rounds=2 --delay=200 --finalizeDelay=200 --finalizeTailMs=3000
 *   $env:PROBE_RELAY='http://127.0.0.1:13022/v1'; $env:PROBE_PORT=12023; node evals/platform-probes/rescue-shutdown-probe.mjs --expect=finalize-interrupted
 *
 * 判据（只读枚举与长度，不打印正文）：`progress=abort`、`writtenBy=` 期望点、
 * `interruptedBy=process-lost`；rescue 还要求 `answerLen>0`（有正文才允许抢救落档）。
 */
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = Number(process.env.PROBE_PORT || 12021)
const RELAY = process.env.PROBE_RELAY || 'http://127.0.0.1:13020/v1'
/** 必须在导入配置之前把 relay 指过去，否则"重试/卡住"根本没发生（装置没通电） */
Object.assign(process.env, {PORT: String(PORT), LLM_RELAY_BASE_URL: RELAY, llmUsageLive_enabled: 'true'})
const log = (note, obj) => console.log(JSON.stringify({probe: 'rescue-shutdown', note, ...obj}))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
function val(n, d) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}

const {default: appService} = await import(pathToFileURL(path.join(SRC, 'app.js')).href)
const {default: Fastify} = await import('fastify')
const {accessLoggerOptions} = await import(pathToFileURL(path.join(SRC, 'logger/index.js')).href)
const {default: llm} = await import(pathToFileURL(path.join(SRC, 'conf/system.config.js')).href)
const {beginShutdown} = await import(pathToFileURL(path.join(SRC, 'services/core/session/shutdownState.js')).href)
const {closeWithRescue} = await import(pathToFileURL(path.join(SRC, 'services/core/session/shutdownSequence.js')).href)

/**
 * 期望的落库点：`rescue` 让收尾调用之前的那一轮卡住；`finalize-interrupted` 让**收尾调用**
 * 在停止位之后还送一帧。两者共用同一套停机装置，只差假中继怎么答。
 */
const EXPECT = val('expect', 'rescue')
/**
 * `maxIterations=1` 是让"第二次上游调用必须是收尾调用"的那个开关。
 * 上一枪用 2 ⇒ 第二轮是**普通迭代**，中继正常交回正文、`loopExit=break` 就收尾了，
 * 收尾调用从未发生（读数：中继日志没有 `是收尾调用=true`，库里 `writtenBy=normal`）。
 * 给 1 之后：循环到顶且正文为空 ⇒ `finalizationDecision` 判 `force-final` ⇒ 真的发起收尾调用。
 */
const MAX_ITER = Number(val('maxIterations', EXPECT === 'rescue' ? 2 : 1))
/** 停机前的观察窗口：rescue 等的是"第一轮卡住"，finalize 等的是"收尾调用的第一帧已到手" */
const TAIL_WAIT = Number(val('tailWait', 1500))
/** close 宽限：`budgetMs = max(1000, delayMs - 5000)` ⇒ 停止位落在停机后约 1s，抢救落在约 2s */
const CLOSE_DELAY = Number(val('closeDelay', 4000))

const app = Fastify({logger: accessLoggerOptions})
await app.register(appService)
await app.listen({port: PORT, host: '127.0.0.1'})
log('装置通电自检', {env中继: process.env.LLM_RELAY_BASE_URL, 端口: PORT, 说明: '真正的通电证据是假中继日志里的 hit 与 stalled 行'})

const ui = Buffer.from(JSON.stringify({userCode: 'menglb', realName: 'rescue 复现'})).toString('base64')
/** 会话码带期望点：两种枪都往同一张表写行，不带区分就没法按批核对（只写自己新建的会话） */
const cc = `${EXPECT}-${Date.now()}`
const ac = new AbortController()
const stats = {chars: 0, frames: [], done: false}
;(async () => {
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
            body: JSON.stringify({
                query: '请先给一段正文，然后继续调用工具确认，最后再总结。',
                conversationCode: cc,
                options: {channel: 'micro_common', protocol: 2, cache: false, maxIterations: MAX_ITER},
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
                stats.frames.push(ev)
                if (ev === 'delta') {
                    try {
                        stats.chars += (JSON.parse(data)?.content || '').length
                    } catch (e) { /* 分片不完整就跳过 */ }
                } else if (ev === 'done') {
                    stats.done = true
                }
            }
        }
    } catch (e) {
        stats.err = String((e && e.message) || e).slice(0, 60)
    }
})()

/**
 * 等到"手里有正文"再触发停机——这句话在两种期望下含义不同，都必须成立：
 * - rescue：正文来自第一轮（卡住的是第二轮），停机时 run 手里有内容 ⇒ 允许抢救落档；
 * - finalize-interrupted：`maxIterations=1` 时**唯一可能产生正文的调用就是收尾调用**，
 *   所以 `chars>0` 恰好等于"收尾调用的第一帧已到手"，这正是需要盯住的那个时刻。
 */
for (let i = 0; i < 60 && stats.chars === 0; i += 1) {
    await sleep(200)
}
log('已有正文，准备触发停机', {期望: EXPECT, maxIterations: MAX_ITER, 已收字符: stats.chars, 帧: [...new Set(stats.frames)].join(','), 等正文ms: stats.chars ? 'ok' : 'timeout', 停机前观察ms: TAIL_WAIT})
await sleep(TAIL_WAIT)
const t0 = Date.now()
/**
 * 触发的是**信号路径真正调用的那两句**：`beginShutdown()` → `closeWithRescue()`。
 * - 少了前者：`isClosing()` 为假 ⇒ `interruptedBy` 会被写成 `client-disconnect`，归因是探针造的；
 * - 只调裸 `app.close()`：走不到抢救分支（读数：close 20s 未返回、库里 0 行）——
 *   那不是"rescue 不可达"，是按错了门铃。
 * `closeWithRescue` 先 `app.close()`，预算内没关完才 `archiveAllInflight`（置停止位 + 等 run 自己落档）。
 */
beginShutdown({signal: 'manual'})
const seq = await closeWithRescue({app, delayMs: CLOSE_DELAY, log: (m, obj) => log('序列', {...obj, msg: String(m).slice(0, 60)})})
const closeMs = Date.now() - t0
log('停机返回情况', {timedOut: seq.timedOut, 预算ms: seq.budgetMs, 抢救条数: (seq.archived || []).length, close耗时ms: closeMs, 流自然收尾: stats.done, 结束时字符: stats.chars})
ac.abort()
await sleep(2000)

/** 档案侧必须另建连接：app.close() 已经把共享连接关掉，用它读会得到"Client must be connected"的假阴性 */
const {default: mongoose} = await import('mongoose')
const cfg = llm.mongodbConfig
/**
 * 拼法必须和本仓库其它探针一致：`mongodbConfig.uri` 里**不含凭据**，
 * user/pass 在 options 上。直接用 cfg.uri 会连不上，然后读出一句假的"没有落库行"
 * ——这跟"读错库"是同一类错误：仪器没通电时读数毫无意义。
 */
const authedUri = String(cfg.uri).replace(/^mongodb:\/\//, `mongodb://${cfg.options.user || ''}${cfg.options.pass ? ':' + cfg.options.pass : ''}@`)
const conn = await mongoose.createConnection(authedUri, {...cfg.options, autoIndex: false}).asPromise()
const doc = await conn.collection('message').find({conversationCode: cc}).sort({insertTime: -1}).limit(1).next()
await conn.close()
const e = (doc && doc.extInfo) || {}
const out = {
    有行: !!doc,
    progress: doc ? doc.progress : null,
    writtenBy: e.writtenBy || null,
    interruptedBy: e.interruptedBy === undefined ? '(无键)' : e.interruptedBy,
    loopExit: e.loopExit || null,
    answerLen: doc ? String(doc.answer || '').length : 0,
    errorKind: doc && doc.error ? String(doc.error).split(':')[0] : '(空)',
}
console.log(JSON.stringify(out))
/**
 * 判定（`--expect=rescue|finalize-interrupted`）：同一个停机入口，两种期望落库点，
 * 区别只在假中继怎么答——卡住后续轮 vs 停止位之后再送一帧。
 * 两点都要求 `answerLen>0`：**"抢救必须带走已经生成的正文"是这两个落库点共同的成立前提**，
 * 落成 abort 却 0 字的话，这条样本反而证明修法失效（v1.41 就是这么改过来的）。
 */
const ok = out.有行 && out.progress === 'abort' && out.writtenBy === EXPECT
    && out.interruptedBy === 'process-lost' && out.answerLen > 0
console.log('判定：' + (ok
    ? `通过：${EXPECT} 有了现场样本（interruptedBy=${out.interruptedBy}, answerLen=${out.answerLen}, loopExit=${out.loopExit}）`
    : `未通过：期望 writtenBy=${EXPECT}，实际 ${out.writtenBy}`
    + `（interruptedBy=${out.interruptedBy} answerLen=${out.answerLen} loopExit=${out.loopExit} progress=${out.progress}）`
    + '；若实际是 normal/finish，说明这一枪根本没走到那个落库点（看假中继日志的"是收尾调用"与时序）'))
process.exit(ok ? 0 : 3)
