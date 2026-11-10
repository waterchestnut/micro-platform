/**
 * @fileOverview 停机现场取证：连接是谁拆的、应用到底有没有走到落档
 * @module evals/platform-probes/shutdown-forensics-probe
 * @description
 * 为什么需要这条探针：v1.37 对"被切断的 run 为什么没有档案"给了一个**错误的因果**
 * （我写成"代码把拆连接当用户取消 ⇒ 什么都不留"）。重读 `llmChat.js:734-789` 后知道
 * `persistTurn('abort')` 是会写 `message` 行并带上已有 `answerContent` 的，
 * `:888-890` 与 `:1138-1140` 两处 `signal.aborted` 都会调它 ⇒ 真实情况只能是**那条路径没被跑到**。
 * 到底是"应用没收到 socket close"还是"收到了但没走到检查点就被 SIGKILL"，
 * 用 SSE 客户端和账本都区分不出来——**只有应用自己的日志能回答**（`root.js:70-75` 会打
 * `request closed execChat request.raw.aborted:...`）。
 *
 * 装置要点（都是前面几轮踩出来的）：
 * - 先定位**真正服务这条流的 pod**（用 messageCode 去各 pod 的 app.log 里找），
 *   否则"哪个 pod 的日志里没 close 事件"毫无意义。
 * - 日志在容器本地文件（dev 没挂卷），所以必须在旧容器还活着的时候抢读；
 *   `exec` 失败即视为容器已消失，把失败原文记下来，不当成"没有事件"。
 * - 只用 ASCII 关键字去 grep：中文字面量经过 PowerShell 会被代码页转坏（本轮已被咬过一次）。
 * - 不自动补打、不为了追信号再花一次调用。
 *
 * 用法（在 `src/` 下）：
 *   $env:KUBECONFIG='<dev kubeconfig>'
 *   node evals/platform-probes/shutdown-forensics-probe.mjs --cutAfter=40000 --out=<路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'

const require2 = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || val('base', 'https://api.xxzx.paretop.net/llm')
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || 'menglb%3Aa4ee9660d66011f1acd8b13c0b88ab1d')
const KUBECONFIG = process.env.KUBECONFIG || val('kubeconfig', '')
const NS = val('ns', 'xxzx')
const DEPLOY = val('deploy', 'llm-api-http')
const LOG_FILE = val('log', '/app/log/app/app.log')
const CUT_AFTER_MS = Number(val('cutAfter', 40000))
const WATCH_MS = Number(val('watch', 100000))
const OUT = val('out', '')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const LINES = []
/**
 * @description 自己落文件再打印
 * @param {String} note 事件
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'shutdown-forensics', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}
if (!KUBECONFIG) {
    log('拒绝启动', {reason: 'no KUBECONFIG: kubectl would fall back to localhost:8080 and every "no event" reading would be fake'})
    process.exit(2)
}

/**
 * @description 跑 kubectl
 * @param {Array<String>} args 参数
 * @returns {{ok: Boolean, out: String}} 结果
 */
function kc(args) {
    try {
        return {ok: true, out: execFileSync('kubectl', ['--kubeconfig', KUBECONFIG, '-n', NS, ...args],
            {encoding: 'utf8', timeout: 45000, maxBuffer: 24 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})}
    } catch (e) {
        return {ok: false, out: String(e?.stderr || e?.message || e).replace(/\s+/g, ' ').slice(0, 200)}
    }
}

/**
 * @description 取 pod 列表
 * @returns {Array<Object>} pods
 */
function pods() {
    const r = kc(['get', 'pods', '-l', `app=${DEPLOY}`, '-o', 'json'])
    if (!r.ok) {
        throw new Error(r.out)
    }
    return JSON.parse(r.out).items.map(p => ({
        name: p.metadata.name,
        uid: p.metadata.uid,
        del: p.metadata.deletionTimestamp || '',
        restarts: p.status?.containerStatuses?.[0]?.restartCount ?? -1,
    }))
}

let initial
try {
    initial = pods()
} catch (e) {
    log('拒绝启动', {reason: String(e.message).slice(0, 160)})
    process.exit(2)
}
if (initial.length < 1) {
    log('拒绝启动', {reason: 'no pods matched'})
    process.exit(2)
}

const conversationCode = `sfx-${Date.now()}`
let messageCode = ''
let clientChars = 0
let clientEnd = 'unknown'
let clientError = ''
let lastSeq = 0
const QUERY = '请连续写一篇 14000 字以上的长文，主题是深夜一次平滑发布里被拆掉的那条连接：它从哪一层断开、'
    + '服务端有没有察觉、以及那些没写完的回答最后去了哪里。要求分八章，每章有具体场景与对话，不要调用工具，一次性写完。'

const t0 = Date.now()
/** 信号时刻要先声明再赋值：流如果在 8 秒内就出错，`log('客户端结束')` 会踩到后面才声明的 const ⇒ TDZ */
let tSignal = 0
log('开窗', {BASE, ns: NS, deploy: DEPLOY, conversationCode, cutAfterMs: CUT_AFTER_MS,
    pods: initial.map(p => `${p.name}@del=${p.del || 'none'}(restarts=${p.restarts})`)})

/**
 * 打流：与 rollout-drop-probe 同一套鉴权头
 */
const streamTask = (async () => {
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': TOKEN},
            body: JSON.stringify({query: QUERY, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: AbortSignal.timeout(420000),
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
                if (ev === 'meta') {
                    try {
                        messageCode = JSON.parse(raw)?.messageCode || messageCode
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'delta') {
                    try {
                        clientChars += (JSON.parse(raw)?.content || '').length
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'done' || ev === 'abort') {
                    clientEnd = ev
                } else if (ev === 'error') {
                    clientEnd = 'error'
                    clientError = raw.slice(0, 120)
                }
            }
        }
        if (clientEnd === 'unknown') {
            clientEnd = 'closed-without-terminal-event'
        }
    } catch (e) {
        clientEnd = 'exception'
        clientError = String(e?.message || e).slice(0, 140)
    }
    log('客户端结束', {end: clientEnd, chars: clientChars, 末帧seq: lastSeq, 距信号ms: tSignal ? Date.now() - tSignal : null,
        墙钟ms: Date.now() - t0, err: clientError})
})()

await new Promise(r => setTimeout(r, 8000))
if (!messageCode) {
    log('拒绝继续', {reason: '8s 内没拿到 meta.messageCode ⇒ 无法定位服务 pod，本次不触发滚动（不花无谓的钱）'})
    process.exit(2)
}

/** 定位真正服务这条流的 pod：messageCode 只在它自己的日志里出现 */
let serving = null
for (const p of initial) {
    const g = kc(['exec', p.name, '--', 'sh', '-c', `tail -n 400 ${LOG_FILE} | grep -c ${messageCode}`])
    const n = Number(String(g.out).trim())
    log('找服务 pod', {pod: p.name, ok: g.ok, 命中次数: Number.isFinite(n) ? n : g.out.slice(0, 60)})
    if (g.ok && n > 0) {
        serving = p
    }
}
if (!serving) {
    log('拒绝继续', {reason: `没有任何 pod 的日志含 messageCode=${messageCode} ⇒ 装置没通电，不做滚动`})
    process.exit(2)
}

/**
 * 在途时采样本进程的抢救表与闸计数。
 * 为什么必须在**触发滚动之前**采：`archives` 只有 run 正在跑时才非空，
 * 上一轮我等流跑完才去看，得到 `archiving=0`、`active=0`，
 * **等于什么都没证明**（§25 v1.40）——而"闸关着时抢救表非空"正是 `runs`/`archives` 分表的全部意义。
 *
 * 端口写死 12008：那是**容器内** fastify 的监听端口（来自 /app/.env），
 * 不是本探针进程的 env——上一版我误用过 `process.env.PORT`，那会取到我随手设的 12007。
 * 走 127.0.0.1 只是为了定位到**具体那个 pod**（闸与抢救表都是单进程的），
 * 身份头照给：`/runStats` 现在有身份校验了（v1.41），公网一侧另由网关拦 token
 * （实测无凭据请求返回 `code:4002 token无效`）。
 * @param {String} podName 目标 pod
 * @returns {Object} 读数
 */
function sampleRunStats(podName) {
    /**
     * 必须带 user-info：`/runStats` 已补上身份校验（v1.41）。
     * 上一版我能空着头调通，靠的是那条缺陷本身——**用缺陷当便利，缺陷修掉时工具就跟着红了**。
     * 头值是 base64(JSON)，与 `plugins/init-params.js` 的解析口径一致。
     */
    const ui = Buffer.from(JSON.stringify({userCode: 'menglb', realName: 'shutdown-forensics'})).toString('base64')
    const g = kc(['exec', podName, '--', 'sh', '-c',
        `wget -q -O - --header='Content-Type: application/json' `
        + `--header='user-info: ${ui}' --post-data='{}' `
        + 'http://127.0.0.1:12008/core/chat/runStats'])
    if (!g.ok) {
        return {ok: false, err: String(g.out).slice(0, 140)}
    }
    try {
        const j = JSON.parse(String(g.out).trim())
        return {ok: true, ...(j.data || {})}
    } catch (e) {
        return {ok: false, err: `解析失败: ${String(g.out).slice(0, 120)}`}
    }
}

const inFlight = sampleRunStats(serving.name)
log('在途采样 runStats', {
    pod: serving.name,
    读数: {active: inFlight.active, archiving: inFlight.archiving, limit: inFlight.limit, gateEnabled: inFlight.gateEnabled, shutdown: inFlight.shutdown},
    这条证明什么: inFlight.ok
        ? `在途时 archiving=${inFlight.archiving}、active=${inFlight.active} ⇒ 抢救表独立于闸登记表（闸关着时后者恒空）`
        : '采样失败：不能据此判断分表设计是否成立，必须重采',
})

tSignal = Date.now()
const rr = kc(['rollout', 'restart', `deploy/${DEPLOY}`])
log('已触发滚动', {ok: rr.ok, 定位到的服务pod: serving.name, 输出: String(rr.out).trim().slice(0, 100)})

/**
 * 抢读旧容器日志：直到容器消失或 WATCH_MS 到点。
 * 只 grep ASCII 关键字（`request closed` 来自 root.js:71，`SSE` 来自 :128，`aborted=` 同上）。
 */
const events = []
const tWatchEnd = Date.now() + WATCH_MS
let execFails = 0
while (Date.now() < tWatchEnd) {
    const g = kc(['exec', serving.name, '--', 'sh', '-c',
        `tail -n 1500 ${LOG_FILE} | grep -E 'request closed|aborted=|ERROR|WARN' | tail -30`])
    if (!g.ok) {
        execFails++
        events.push({atMsFromSignal: Date.now() - tSignal, 采集失败: g.out.slice(0, 120)})
        log('采集失败（容器可能已消失）', {atMsFromSignal: Date.now() - tSignal, 错误: g.out.slice(0, 120)})
        break
    }
    const rows = String(g.out).split(/\r?\n/).filter(x => x.trim())
    for (const r of rows) {
        events.push({atMsFromSignal: Date.now() - tSignal, 行: r.slice(0, 300)})
    }
    log('本轮日志', {atMsFromSignal: Date.now() - tSignal, 行数: rows.length})
    const snap = pods().find(x => x.uid === serving.uid)
    if (!snap || snap.restarts > serving.restarts) {
        events.push({atMsFromSignal: Date.now() - tSignal, 容器变化: snap ? `restarts ${serving.restarts}→${snap.restarts}` : 'pod 已消失'})
        log('容器已消失或重启', {atMsFromSignal: Date.now() - tSignal})
        break
    }
    await new Promise(r => setTimeout(r, 5000))
}

await Promise.allSettled([streamTask])

/* 账本与档案 */
await new Promise(r => setTimeout(r, 8000))
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const {MongoClient} = require2('mongodb')
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))
const u = (await db.collection('llmUsage').find({conversationCode}, {projection: {
    _id: 0, progress: 1, insertTime: 1, updateTime: 1, modelCalls: 1, completionTokens: 1, estPromptTokens: 1,
}}).toArray())[0]
const m = (await db.collection('message').find({conversationCode}, {projection: {
    _id: 0, progress: 1, error: 1, 'extInfo.interruptedBy': 1, answerLen: {$strLenCP: {$ifNull: ['$answer', '']}},
}}).toArray())[0]
const cps = await db.collection('sessionCheckpoint').find({conversationCode},
    {projection: {_id: 0, phase: 1, seq: 1}}).sort({seq: 1}).toArray()
await client.close()

const sawClose = events.some(e => /request closed/.test(e.行 || ''))
const sawSseEnd = events.some(e => /aborted=/.test(e.行 || ''))
log('读数', {
    客户端: {end: clientEnd, chars: clientChars, 距信号ms: clientEnd === 'unknown' ? null : '见上一条', 墙钟ms: Date.now() - t0},
    档案: m || null, 账本: u || null, 检查点: cps.map(c => `${c.phase}#${c.seq}`),
    日志事件: events,
})
log('判定', {
    应用是否看到连接被拆: sawClose ? '是（日志里有 request closed）' : '否（整个观察窗内没有该事件）',
    应用是否走到收尾日志: sawSseEnd ? '是（有 aborted= 那行）' : '否',
    是否落档: m ? `是，progress=${m.progress}、答案 ${m.answerLen} 字` : '否（message 无行）',
    结论: !sawClose && !m
        ? '⇒ 机制是**网关先拆客户端、应用毫不知情**：它继续生成（在花钱），直到 kubelet SIGKILL；'
            + 'abort 路径从没被触发，所以"不落档"不是策略选择，而是**根本没跑到**。'
        : sawClose && !m
            ? '⇒ 应用看到了断开，但没走到 `persistTurn`（被 SIGKILL 抢先或在 await 上游里没回到检查点）'
            : sawClose && m
                ? `⇒ 应用看到断开并落了档（progress=${m.progress}）⇒ 现有代码是够的，问题在别处`
                : '⇒ 读数不足以判机制（应用没看到断开但落了档，这种组合要单独查）',
    采集失败次数: execFails,
})
process.exit(0)
