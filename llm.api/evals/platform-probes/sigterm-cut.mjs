/**
 * @fileOverview 停机切断实验（带"切断是否真的发生"自检）
 * @module evals/platform-probes/sigterm-cut
 * @description
 * 上一版实验把 `kubectl delete` 失败当成"切过了"，于是长流当然跑完——**读数是假的**。
 * 这版把"切断确实发生"做成硬前置：删除命令必须成功，且 pod 必须进入 Terminating/消失，
 * 否则直接判"实验无效"（退出码 3），不许输出任何关于宽限是否有效的结论。
 *
 * 用法（需已 port-forward 到 13099，pod 名与 grace 由参数给）：
 *   node evals/platform-probes/sigterm-cut.mjs --grace=20 --cutAfter=12000
 */
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const argv = process.argv.slice(2)

/**
 * @description 取 `--name=value`
 * @param {String} n 名
 * @param {String} d 默认
 * @returns {String} 值
 */
function val(n, d) {
    const hit = argv.find(a => a.startsWith('--' + n + '='))
    return hit ? hit.substring(n.length + 3) : d
}

const GRACE = val('grace', '20')
const CUT_AFTER_MS = Number(val('cutAfter', 12000))
const POD = val('pod', 'llm-api-sigtest')
const BASE = val('base', 'http://127.0.0.1:13099')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const log = (note, obj) => console.log(JSON.stringify({probe: 'sigterm-cut', grace: GRACE, note, ...obj}))
const userInfo = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '切断实验'})).toString('base64')

/**
 * @description 跑 kubectl，失败时把错误原文带回来（不静默）
 * @param {Array<String>} args 参数
 * @param {Number} [timeout] 超时
 * @returns {{ok: Boolean, out: String}} 结果
 */
function kc(args, timeout = 90000) {
    try {
        return {ok: true, out: execFileSync('kubectl', ['-n', 'xxzx', ...args],
            {encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})}
    } catch (e) {
        return {ok: false, out: String(e?.stderr || e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}
    }
}

/**
 * @description 设备通电自检
 * @returns {Promise<Boolean>} 可达
 */
async function preflight() {
    try {
        const r = await fetch(`${BASE}/core/chat/runStats`, {
            method: 'POST', headers: {'Content-Type': 'application/json', 'user-info': userInfo}, body: '{}',
        })
        const j = await r.json().catch(() => null)
        log('自检', {http: r.status, code: j?.code})
        return r.status === 200 && j?.code === 0
    } catch (e) {
        log('自检失败', {err: String(e?.message || e).slice(0, 100)})
        return false
    }
}
if (!await preflight()) {
    process.exit(2)
}

const conversationCode = `sigcut-${GRACE}-${Date.now()}`

/**
 * @description 打一条长流
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
                query: '请连续写一篇 3500 字以上的长文，主题是数据中心里的一次平滑发布：信号、端点摘除、以及那些没人接管的请求。要求分章节，不要调用工具，一次性写完。',
                conversationCode,
                options: {channel: 'xxzx_common', protocol: 2, cache: false},
            }),
            signal: AbortSignal.timeout(200000),
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
                    error = raw.slice(0, 100)
                }
            }
        }
        if (end === 'unknown') {
            end = 'closed-without-terminal-event'
        }
    } catch (e) {
        end = 'exception'
        error = String(e?.message || e).slice(0, 100)
    }
    return {墙钟ms: Date.now() - t0, 字符: chars, 末帧seq: lastSeq, end, error}
}

const p = streamOnce()
await new Promise(r => setTimeout(r, CUT_AFTER_MS))
log('发起切断', {已跑ms: CUT_AFTER_MS, gracePeriod: GRACE})
const del = kc(['delete', 'pod', POD, `--grace-period=${GRACE}`, '--wait=false'])
/**
 * **切断是否真的发生了**——必须证明，不能假定。
 * 两个证据：删除命令成功，且 pod 的 deletionTimestamp 出现（或 pod 消失）。
 */
let cutConfirmed = false
let delTs = ''
if (del.ok) {
    for (let i = 0; i < 8; i++) {
        const st = kc(['get', 'pod', POD, '-o', 'jsonpath={.metadata.deletionTimestamp}'], 20000)
        if (!st.ok) {
            cutConfirmed = true
            delTs = '(pod 已消失)'
            break
        }
        if (st.out.trim()) {
            cutConfirmed = true
            delTs = st.out.trim()
            break
        }
        await new Promise(r => setTimeout(r, 1500))
    }
} else {
    log('删除命令失败', {错误: del.out})
}
log('切断确认', {cutConfirmed, deletionTimestamp: delTs})
const got = await p
if (!cutConfirmed) {
    log('判定', {
        结论: '❌ **实验无效：切断没有发生**。这次的"流跑完"不能用来评价任何停机行为——'
            + '上一版就是把删除失败当成切过了，得出了"修法有效"的假结论。',
        流: got,
    })
    process.exit(3)
}

/* 等落库，再回查档案 */
await new Promise(r => setTimeout(r, 8000))
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
    {$project: {_id: 0, progress: 1, answerLen: {$strLenCP: {$ifNull: ['$answer', '']}}}},
]).toArray()
const usage = await client.db(dbName).collection('llmUsage').find({conversationCode},
    {projection: {_id: 0, progress: 1, modelCalls: 1, upstreamAttempts: 1}}).toArray()
await client.close()

const 档案 = msg.length ? msg[0] : null
log('判定', {
    流: got,
    档案: 档案 || '(无行)',
    账本: usage,
    结论: got.end === 'done' && 档案?.progress === 'finish'
        ? `✅ grace=${GRACE}s 下：SIGTERM 在途的流跑完（${got.字符} 字）且落档 finish ⇒ 该 grace 容得下这一轮`
        : `❌ grace=${GRACE}s 下 run 蒸发：流 ${got.end}（${got.字符} 字、墙钟 ${got.墙钟ms}ms）、档案${档案 ? 档案.progress : '无行'} ⇒ `
            + '信号到不到应用是一回事，**grace 容不容得下剩余时长是另一回事**，两个都得满足',
})
process.exit(0)
