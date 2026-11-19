/**
 * @fileOverview 长入参与截断声明的端到端复现（离线、零真实 token）
 * @module evals/platform-probes/tool-args-truncation-probe
 * @description
 * 这条探针回答的是一个长期只有代码分支、没有数据的问题：`argsTruncated=true` 到底会不会发生，
 * 以及发生时**档案与流是否说同一批数**。
 * 真实流量里此前最好的入参样本只有 234 字符（上限 `limits.toolArgsChars=4000`），
 * 而让模型自己写一段 4000 字符以上的工具参数并不可靠——所以把它做成可控输入。
 *
 * 配套：`fake-relay-abort.mjs --argsChars=6000 --rounds=2 --delay=300`
 * 第一轮交回一个 5988 字符的 `memory_search` 入参（只读工具，不碰外部服务），第二轮直接答。
 *
 * 用法：
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13014 --delay=300 --rounds=2 --argsChars=6000
 *   $env:PORT=12014; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13014/v1'; node server.js
 *   $env:PROBE_BASE='http://127.0.0.1:12014'; node evals/platform-probes/tool-args-truncation-probe.mjs
 *   # 要在界面上点这一行时加 --user=menglb：默认探针账号不会出现在登录用户的会话列表里
 *
 * 判据（只读元数据，不打印入参正文——它可能含用户问题回声）：
 * - `argsChars` 是原文真实长度且 > 上限；
 * - `argsTruncated === true`；
 * - 实际存下来的 `args` 长度 <= 上限；
 * - 流侧 `tool_result` 帧的 `argsChars`/`argsTruncated` 与档案**完全一致**（同源，不许两套数）。
 *
 * 2026-11-12 实测：`argsChars=5988`、`argsTruncated=true`、存下 4000，流侧同一批数（一致）。
 * 界面侧那条判据在 console 仓库 `segments.test.ts`（同批推进到四端与底座）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require2 = createRequire(path.join(SRC, 'server.js'))
const {MongoClient} = require2('mongodb')
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
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12014'
const TARGET = Number(process.env.ARGS || 6000)
const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} def 缺省
 * @returns {String} 值
 */
function val(n, def) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : def
}
const cc = `args-truncation-${TARGET}-${Date.now()}`
/**
 * `--user=menglb`：把这一行写成**界面上点得到**的归属。
 * 默认用探针账号，因为那不该出现在别人的会话列表里；
 * 但要做"截断声明在面板上真的说出来了"这类点击验证时，
 * UI 的侧栏只会列当前登录用户的会话——所以这个开关是点击验证的前提，
 * 不是绕过归属：只有对**自己的账号**才该用它。
 */
const USER_CODE = val('user', 'args-truncation-probe')
const ui = Buffer.from(JSON.stringify({userCode: USER_CODE, realName: '长入参复现'})).toString('base64')
const res = await fetch(`${BASE}/core/chat/stream`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
    body: JSON.stringify({
        query: '请调用工具检索一下记忆，然后一句话告诉我结果；不要自己编造内容。',
        conversationCode: cc,
        options: {channel: 'micro_common', protocol: 2, cache: false},
    }),
})
const raw = await res.text()
const evs = {}
for (const m of raw.matchAll(/event:(\S+)/g)) evs[m[1]] = (evs[m[1]] || 0) + 1
/** 流侧 tool_result 里的入参声明（协议 2 才会下发；没下发就是 null，不猜） */
let streamArgs = null
for (const m of raw.matchAll(/data:\s*(\{[^\n]*"role":"tool"[^\n]*\})/g)) {
    try {
        const o = JSON.parse(m[1])
        if (o.args !== undefined || o.argsChars !== undefined) {
            streamArgs = {argsChars: o.argsChars, argsTruncated: o.argsTruncated, argsLen: typeof o.args === 'string' ? o.args.length : null}
        }
    } catch (e) {
        /** 帧被截断拼不上时不猜 */
    }
}
await new Promise((r) => setTimeout(r, 4000))
const client = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000})
const db = client.db((process.env.MONGO_DB || 'llm-api'))
const cap = Number((/toolArgsChars: parseInt\(process\.env\['limits_toolArgsChars'\] \|\| (\d+)\)/.exec(cfgSrc) || [])[1] || 0)
const row = await db.collection('message').findOne({conversationCode: cc}, {projection: {progress: 1, extInfo: 1}})
const e = (row && row.extInfo) || {}
const tc = (e.toolCalls || []).map((t) => ({
    name: t.name,
    argsChars: t.argsChars,
    argsTruncated: t.argsTruncated,
    storedArgsLen: typeof t.args === 'string' ? t.args.length : (t.args === undefined ? '(无 args 键)' : typeof t.args),
    /** trace 条目的 result 侧只有正文本身，长度在这里算出来，不外泄内容 */
    resultLen: typeof t.result === 'string' ? t.result.length : (t.result === undefined ? '(无 result 键)' : typeof t.result),
}))
console.log(JSON.stringify({conversationCode: cc, 事件名: evs, 流侧入参声明: streamArgs, 上限: cap, 目标入参长度: TARGET, progress: row ? row.progress : null, iter: e.iterationCount, 工具元数据: tc}, null, 1))
const declaredOk = tc.length > 0 && tc.some((t) => t.argsTruncated === true && typeof t.argsChars === 'number' && t.argsChars > cap)
const storedOk = tc.length > 0 && tc.every((t) => typeof t.storedArgsLen === 'number' && t.storedArgsLen <= cap)
console.log('判定：' + (declaredOk && storedOk
    ? '通过 ⇒ 截断真的发生，且档案同时写下真实长度与标记（不是留一截看不出的字符串）'
    : `未通过：declaredOk=${declaredOk} storedOk=${storedOk}（工具条目为空说明这一枪根本没走工具轮）`))
if (streamArgs && tc[0]) {
    const same = streamArgs.argsChars === tc[0].argsChars && streamArgs.argsTruncated === tc[0].argsTruncated
    console.log('流侧与档案是否同源：' + (same ? '一致' : `不一致 ⇒ 两套数，必须修：流=${JSON.stringify(streamArgs)} 档=${JSON.stringify(tc[0])}`))
}
await client.close()
process.exit(declaredOk && storedOk ? 0 : 3)
