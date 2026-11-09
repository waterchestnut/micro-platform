/**
 * @fileOverview 入口修法对照实验：PID 1 换成 pm2-runtime 后，在途长流能不能跑完并落档
 * @module evals/platform-probes/sigterm-runtime-experiment
 * @description
 * P-10 的实测（第 8 轮）证明 dev/prod 的关闭链**从来没生效过**：容器 PID 1 是 `bash /start`，
 * SIGTERM 只到 bash，PM2 的 worker 从未收到信号，于是 k8s 的宽限期与应用的 `close-with-grace`
 * 都是空转 —— 两条正在生成的流在 SIGTERM 那一刻同时 `terminated`，`message` 表里连行都没有。
 *
 * 本实验把修法（`exec pm2-runtime $APP --kill-timeout 40000`）放在一个**隔离 pod** 上验证：
 *   1. 打一条长流（约 50s）
 *   2. 在途 25s 时 `kubectl delete pod`（grace 60s，等于一次真实发版的信号）
 *   3. 看这条流是跑完（done）还是被打断（terminated）
 *   4. 回查 `message`：那一轮有没有落成 `finish`
 *
 * 用法（在 `src/` 下，需要已 port-forward 到 13099）：
 *   node evals/platform-probes/sigterm-runtime-experiment.mjs
 */
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:13099'
const NAMESPACE = process.env.PROBE_NS || 'xxzx'
const POD = process.env.PROBE_POD || 'llm-api-sigtest'
const CUT_AFTER_MS = Number(process.env.PROBE_CUT_AFTER_MS || 25000)
const log = (note, obj) => console.log(JSON.stringify({probe: 'sigterm-runtime', note, ...obj}))
/** 直连 pod 没有网关，鉴权按本项目的信任模型走 user-info */
const userInfo = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '信号实验'})).toString('base64')

/**
 * @description 通电自检：先确认 BASE 真的可达，否则整轮实验什么都没测到
 * @returns {Promise<Boolean>} 是否可用
 * @description
 * 这条不是形式主义：上一版实验的 60ms `fetch failed` 来自一个**绑定失败却没退出的 port-forward**
 * （旧进程还占着端口），差点被读成"修法无效"。
 * 判据必须能区分"应用被打断"和"我根本没连上"。
 */
async function preflight() {
    try {
        const r = await fetch(`${BASE}/core/chat/runStats`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'user-info': userInfo},
            body: JSON.stringify({}),
        })
        const j = await r.json().catch(() => null)
        log('自检', {http: r.status, code: j?.code, gateEnabled: j?.data?.gateEnabled})
        return r.status === 200
    } catch (e) {
        log('自检失败', {err: String(e?.message || e).slice(0, 120), 提示: 'port-forward 没起来或端口被旧进程占用'})
        return false
    }
}

if (!await preflight()) {
    process.exit(2)
}

const conversationCode = `sigexp-${Date.now()}`
log('开始', {BASE, POD, conversationCode, 切断延迟ms: CUT_AFTER_MS})

/**
 * @description 打一条长流并记录它的命运
 * @returns {Promise<Object>} 读数
 */
async function streamOnce() {
    const t0 = Date.now()
    let chars = 0, lastSeq = 0, end = 'unknown', error = ''
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': userInfo},
            body: JSON.stringify({
                query: '请连续写一篇 3000 字以上的长文，主题是数据中心里的一次平滑发布：为什么信号会丢、谁会接手。要求分章节、不要调用工具、一次性写完。',
                conversationCode,
                options: {channel: 'xxzx_common', protocol: 2, cache: false},
            }),
            signal: AbortSignal.timeout(180000),
        })
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const t = f.trim()
                if (!t || t.startsWith(':')) {
                    continue
                }
                const seq = Number((/^id:(\d+)/m.exec(f)?.[1]) || 0)
                if (seq > lastSeq) {
                    lastSeq = seq
                }
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                const raw = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
                if (ev === 'delta') {
                    try {
                        chars += (JSON.parse(raw)?.content || '').length
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'done' || ev === 'abort') {
                    end = ev
                } else if (ev === 'error') {
                    end = 'error'
                    error = raw.slice(0, 120)
                }
            }
        }
        if (end === 'unknown') {
            end = 'closed-without-terminal-event'
        }
    } catch (e) {
        end = 'exception'
        error = String(e?.message || e).slice(0, 120)
    }
    return {conversationCode, 墙钟ms: Date.now() - t0, 字符: chars, 末帧seq: lastSeq, end, error}
}

const p = streamOnce()
await new Promise(r => setTimeout(r, CUT_AFTER_MS))
log('切断：删除实验 pod（等价于一次发版的 SIGTERM）', {已跑ms: CUT_AFTER_MS})
const delT0 = Date.now()
let delOut = ''
try {
    delOut = execFileSync('kubectl', ['-n', NAMESPACE, 'delete', 'pod', POD, '--grace-period=60', '--wait=false'],
        {encoding: 'utf8', timeout: 120000})
} catch (e) {
    delOut = String(e?.message || e).slice(0, 160)
}
log('删除命令返回', {输出: delOut.trim(), 耗时ms: Date.now() - delT0})

const got = await p
log('流的命运', got)

/* 等落库收尾，再回查档案 */
await new Promise(r => setTimeout(r, 6000))
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const {MongoClient} = require2('mongodb')
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const dbName = d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
const msg = await client.db(dbName).collection('message').aggregate([
    {$match: {conversationCode}},
    {$project: {_id: 0, progress: 1, answerLen: {$strLenCP: {$ifNull: ['$answer', '']}}, 'extInfo.loopExit': 1}},
]).toArray()
const usage = await client.db(dbName).collection('llmUsage').find({conversationCode},
    {projection: {_id: 0, modelCalls: 1, upstreamAttempts: 1, upstreamRetried: 1, progress: 1}}).toArray()
await client.close()

log('档案回查', {message: msg, llmUsage: usage})
const 跑完 = got.end === 'done'
const 落档 = msg.length > 0 && msg[0].progress === 'finish'
log('判定', {
    用户侧: got.end,
    档案侧: msg.length ? msg[0].progress : '(无行)',
    结论: 跑完 && 落档
        ? `✅ 修法有效：SIGTERM 在途的流跑完了（${got.字符} 字、末帧 seq=${got.末帧seq}），`
            + '且档案落成 finish ⇒ "PID 1 必须换成会转发信号的进程 + kill_timeout > 应用 delay"这一条是真修法，'
            + '不是把宽限期数字调大就能解决的'
        : (跑完 && !落档
            ? '⚠️ 流跑完了但档案没落 ⇒ 问题在落库路径而不是信号投递，需要再看 persistTurn'
            : `❌ 修法无效或被别的时限截住：流在 ${got.墙钟ms}ms 时 ${got.end}（${got.error}）；`
                + '要查 kill_timeout 是否真被 PM2 采纳、以及 close-with-grace 的 delay 与 k8s grace 的大小关系'),
})
process.exit(跑完 && 落档 ? 0 : 1)
