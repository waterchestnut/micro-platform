/**
 * @fileOverview 收尾调用被打断的落库点复现（`PERSIST_VIA.FINALIZE_INTERRUPTED`）
 * @module evals/platform-probes/finalize-interrupt-probe
 * @description
 * 这个落库点此前**在 dev 与 cw2pc 都没有任何现场样本**（实测：abort 行的 writtenBy 分布里
 * 只有 loop-exit / backfill / unattributed / error / early-stop，没有 finalize-interrupted，也没有 rescue）。
 * "没有样本"和"没有这条路径"是两件事，但**只有样本能证明它真的会被走到**——
 * 源码级不变量证明的是形状，证明不了可达性。
 *
 * 触发条件（读代码定的，不是猜的）：`runFinalizeCall` 里 `drained.stopped` 为真 ⇒
 * `finalizeInterrupted = true` ⇒ 出口走 `persistTurn('abort', null, {via: FINALIZE_INTERRUPTED})`。
 * 而 `stopped` 来自停止判据 `signal.aborted ? 'aborted' : shutdownStopRequested`，
 * 所以要的是"**打断发生在收尾（无工具补落）调用期间**"。
 *
 * 怎么把它变成可控事件：
 * 1. `options.maxIterations=1` + 假中继每一轮都交回 tool_calls ⇒ 循环到顶（`exhausted`）且正文为空
 *    ⇒ `finalizationDecision` 判为 `force-final`，真的发起收尾调用；
 * 2. 假中继 `--finalizeDelay` 只延迟**没有 `tools` 的那次请求**（收尾调用的特征）⇒ 有稳定窗口；
 * 3. 客户端在窗口内 `AbortController.abort()` ⇒ 收尾调用 stopped ⇒ 该落库点被走到。
 *
 * 用法：
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13018 --rounds=2 --finalizeDelay=6000 --delay=200
 *   $env:PORT=12018; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13018/v1'; node server.js
 *   $env:PROBE_BASE='http://127.0.0.1:12018'; node evals/platform-probes/finalize-interrupt-probe.mjs --cut=2500
 *
 * 判据（只读枚举与计数）：`progress=abort`、`writtenBy=finalize-interrupted`、
 * `interruptedBy=client-disconnect`（本地非关闭期 ⇒ 现场计算得来），且 `unspecified` 计数不因本次增加。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require2 = createRequire(path.join(SRC, 'server.js'))
const {MongoClient} = require2('mongodb')
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
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12018'
const CUT = Number(val('cut', 2500))
const cc = `fintr-${Date.now()}`
const ui = Buffer.from(JSON.stringify({userCode: 'fintr-probe', realName: '收尾打断复现'})).toString('base64')
const cfgSrc = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
/**
 * @description 取字符串常量
 * @param {RegExp} re 规则
 * @param {String} def 缺省
 * @returns {String} 结果
 */
function d(re, def) {
    return (re.exec(cfgSrc) || [])[1] || def
}
const uri = (process.env.MONGO_URI || 'mongodb://x') /* 刀七 fork 适配：底座 conf 是 env-only（MONGO_URI/MONGO_USER/MONGO_PASS），母本从 system.config 抠硬编码回退串的正则在底座必失配——直读环境，启动方注入 .env */
    .replace(/^mongodb:\/\//, (process.env.MONGO_USER ? `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@` : 'mongodb://'))

const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), CUT)
let client = {断开方式: `signal.abort @ ${CUT}ms`}
try {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
        body: JSON.stringify({
            query: '必须调用工具检索记忆，反复调用直到系统告诉你结论；不要自己编造内容。',
            conversationCode: cc,
            options: {channel: 'micro_common', protocol: 3, cache: false, maxIterations: 1},
        }),
        signal: ac.signal,
    })
    const ct = res.headers.get('content-type') || ''
    client.contentType = ct.slice(0, 30)
    if (/event-stream/.test(ct)) {
        const reader = res.body.getReader()
        let n = 0
        while (true) {
            const p = await reader.read()
            if (p.done) break
            n += 1
        }
        client.读到分片数 = n
    }
} catch (e) {
    client.客户端异常 = String((e && e.name) || '') + ':' + String((e && e.message) || '').slice(0, 40)
}
clearTimeout(timer)
console.log(JSON.stringify({客户端: client}))

await new Promise((r) => setTimeout(r, 6000))
const mongo = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000})
try {
    const db = mongo.db((process.env.MONGO_DB || 'llm-api'))
    const row = await db.collection('message').findOne({conversationCode: cc}, {projection: {progress: 1, error: 1, extInfo: 1}})
    const e = (row && row.extInfo) || {}
    const out = {
        有行: !!row,
        progress: row ? row.progress : null,
        writtenBy: e.writtenBy || null,
        interruptedBy: e.interruptedBy === undefined ? '(无键)' : e.interruptedBy,
        loopExit: e.loopExit || null,
        errorKind: row && row.error ? String(row.error).split(':')[0] : '(空)',
        iterationCount: e.iterationCount ?? null,
        modelCalls: (e.usage && e.usage.modelCalls) ?? null,
        段数: Array.isArray(e.segments) ? e.segments.length : null,
    }
    console.log(JSON.stringify(out))
    const unspec = await db.collection('message').countDocuments({'extInfo.interruptedBy': 'unspecified'})
    console.log(JSON.stringify({全库unspecified: unspec}))
    const ok = out.有行 && out.progress === 'abort' && out.writtenBy === 'finalize-interrupted'
        && out.interruptedBy === 'client-disconnect'
    console.log('判定：' + (ok
        ? '通过：finalize-interrupted 这个落库点第一次有了现场样本，且归因是现场计算得来的 client-disconnect'
        : `未通过：writtenBy=${out.writtenBy} interruptedBy=${out.interruptedBy}（说明这一枪没走到收尾调用，或走的是别的路径）`))
    process.exit(ok ? 0 : 3)
} finally {
    await mongo.close()
}
