/**
 * @fileOverview 客户端中途断开后，这一轮有没有被"及时停止 + 带正文落档"
 * @module evals/platform-probes/abort-archive-probe
 * @description
 * 这是 PR-E0.5 的验收题，来自 2026-11-10 的现场取证（`shutdown-forensics-probe`）：
 * 断开之后应用**继续送了 45 秒 / 10,772 字**，档案一行没写，账本停在 `processing`。
 * 根因两条，都在这里验：
 *   1. `drainAssistantStream` 没有停止判据 ⇒ 断开不停生成（花钱且没人看）；
 *   2. `signal.aborted` 的检查点全在 drain 之后 ⇒ 到不了 `persistTurn`，正文与终态一起丢。
 *
 * 与停机实验的区别：这里**不动 pod**，只把客户端连接掐掉。
 * 所以它测的是"用户按停止"这一侧，成本低（一条流），且能在改代码前后直接对比。
 *
 * 判据（全部从账本与档案读，不看日志）：
 * - `message.progress` 必须是 `abort`（不是 `finish`，也不是没有行）
 * - `message.answer` 字数必须 > 0：早停时已生成的正文要留住，否则"停止=这轮没发生过"
 * - `extInfo.interruptedBy` 必须是 `client-disconnect`（停机期间才是 `process-lost`）
 * - `llmUsage.progress` 必须已终态（停在 `processing` 就是还没修好）
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/abort-archive-probe.mjs --abortAfter=20000 --out=<路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || val('base', 'https://api.xxzx.paretop.net/llm')
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || val('token', 'menglb%3Aa4ee9660d66011f1acd8b13c0b88ab1d'))
const ABORT_AFTER_MS = Number(val('abortAfter', 20000))
const OUT = val('out', '')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const LINES = []
/**
 * @description 自己落文件再打印（中文键名不能走 PowerShell 重定向）
 * @param {String} note 事件
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'abort-archive', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

const conversationCode = `aab-${Date.now()}`
const QUERY = '请连续写一篇 12000 字以上的长文，主题是"按下停止键之后，那半截回答去了哪里"：'
    + '连接、生成、落档与审计。要求分八章，每章都要有具体场景与对话，不要调用工具，一次性写完。'

let chars = 0
let lastSeq = 0
let sawTerminal = ''
let clientOutcome = 'unknown'
const t0 = Date.now()
const controller = new AbortController()
const timer = setTimeout(() => {
    log('掐断客户端', {abortAfterMs: ABORT_AFTER_MS, 已收字数: chars, 末帧seq: lastSeq})
    controller.abort()
}, ABORT_AFTER_MS)

log('开窗', {BASE, conversationCode, abortAfterMs: ABORT_AFTER_MS})
try {
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': TOKEN},
        body: JSON.stringify({query: QUERY, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
        signal: controller.signal,
    })
    const dec = new TextDecoder()
    let buf = ''
    for await (const cv of r.body) {
        buf += dec.decode(cv, {stream: true})
        let k
        while ((k = buf.indexOf('\n\n')) >= 0) {
            const f = buf.slice(0, k)
            buf = buf.slice(k + 2)
            const t = f.trim()
            if (!t || t.startsWith(':')) {
                continue
            }
            const seq = Number((/^id:(\d+)/m.exec(t)?.[1]) || 0)
            if (seq > lastSeq) {
                lastSeq = seq
            }
            const ev = /event:(\S+)/.exec(t)?.[1] || 'delta'
            const raw = (/data:([\s\S]+)/.exec(t)?.[1] || '').replace(/\n/g, '')
            if (ev === 'delta') {
                try {
                    chars += (JSON.parse(raw)?.content || '').length
                } catch (e) { /* 忽略 */ }
            } else if (ev === 'done' || ev === 'abort' || ev === 'error') {
                sawTerminal = ev
            }
        }
    }
    clientOutcome = sawTerminal || 'closed-without-terminal-event'
} catch (e) {
    clientOutcome = 'aborted-by-client'
    if (!/abort/i.test(String(e?.name || '') + String(e?.message || ''))) {
        clientOutcome = `exception:${String(e?.message || e).slice(0, 60)}`
    }
} finally {
    clearTimeout(timer)
}
/**
 * 断开之后**还要观察多久服务端才停**：靠"客户端已断之后是否还收到新帧"来判不成立（客户端已经不读了），
 * 所以这里改用账本的终态时间：`updateTime - abort 时刻` 就是服务端继续花的力气。
 */
const clientStoppedAt = Date.now()
log('客户端侧结束', {结果: clientOutcome, 收到字数: chars, 末帧seq: lastSeq, 墙钟ms: clientStoppedAt - t0})

await new Promise(r => setTimeout(r, Number(val('settleMs', 20000))))

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const {MongoClient} = require2('mongodb')
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))
const u = (await db.collection('llmUsage').find({conversationCode}, {projection: {
    _id: 0, progress: 1, insertTime: 1, updateTime: 1, modelCalls: 1, upstreamAttempts: 1,
    promptTokens: 1, completionTokens: 1, estPromptTokens: 1, latencyMs: 1,
}}).toArray())[0]
const m = (await db.collection('message').find({conversationCode}, {projection: {
    _id: 0, progress: 1, error: 1, 'extInfo.interruptedBy': 1,
    answerLen: {$strLenCP: {$ifNull: ['$answer', '']}},
}}).toArray())[0]
const cps = await db.collection('sessionCheckpoint').find({conversationCode},
    {projection: {_id: 0, phase: 1, seq: 1, updateTime: 1}}).sort({seq: 1}).toArray()
await client.close()

const 继续花了多久 = u?.updateTime ? Math.max(0, Date.parse(u.updateTime.toISOString?.() || 0) - clientStoppedAt) : null
const 判定 = []
if (!m) {
    判定.push('❌ 档案无行 ⇒ "断开即丢"未修复')
} else {
    if (m.progress !== 'abort') {
        判定.push(`❌ 档案 progress=${m.progress}，应为 abort（把不完整说成 ${m.progress} 是骗人）`)
    }
    if (!(m.answerLen > 0)) {
        判定.push('❌ 档案正文 0 字 ⇒ 早停时没把已生成的内容并进去（drain 早退的返回值没被并入 answerContent）')
    }
    if (m['extInfo.interruptedBy'] !== 'client-disconnect') {
        判定.push(`⚠️ interruptedBy=${JSON.stringify(m['extInfo.interruptedBy'])}，期望 client-disconnect（原因必须另存一列，不能压进 progress）`)
    }
    if (m.progress === 'abort' && m.answerLen > 0 && m['extInfo.interruptedBy'] === 'client-disconnect') {
        判定.push(`✅ 断开被及时停止并带正文落档：${m.answerLen} 字、interruptedBy=${m['extInfo.interruptedBy']}`)
    }
}
if (!u) {
    判定.push('❌ 账本无行（`llmUsageLive` 被关了？那这条验收本身就查不出来）')
} else if (u.progress === 'processing') {
    判定.push('❌ 账本仍停 processing ⇒ 终态没收尾，遗弃扫描会把这条当真损失')
} else {
    判定.push(`✅ 账本已终态：progress=${u.progress}`)
}
log('读数', {
    档案: m || null,
    账本: u || null,
    检查点: cps.map(c => `${c.phase}#${c.seq}@${c.updateTime?.toISOString?.()}`),
    客户端: {结果: clientOutcome, 收到字数: chars, 末帧seq: lastSeq},
    断开后服务端继续耗时ms: 继续花了多久,
    说明: '收到字数 与 档案字数 应当接近：差得多说明"断开后还在生成并丢弃"没修好（档案多于客户端=正常，'
        + '因为服务端把断开前已在管道里的内容也收进了正文）',
})
log('判定', {结论: 判定.join('；'), 通过: 判定.some(x => x.startsWith('✅')) && !判定.some(x => x.startsWith('❌'))})
process.exit(判定.some(x => x.startsWith('❌')) ? 1 : 0)
