/**
 * @fileOverview 在途 run 能不能跨过旧 pod 的 SIGTERM —— 覆盖判据放进集群时钟域
 * @module evals/platform-probes/inflight-survival-probe
 * @description
 * 这是 P-10 / PR-E0.4 的验收题："发版那一刻正在生成的那一轮，最后落到档案里是什么？"
 *
 * 前面四轮 `rollout-drop-probe` 都没答上，原因不是结论而是**计时装置**：
 * epic 长流约 45–55 秒，而 `rollout restart` 到旧 pod 真的收到 SIGTERM 要 60–130 秒
 * （必须先等新 pod 过 readiness），于是信号永远落在所有流结束之后 ⇒ 每次都判"覆盖不成立"。
 * 更糟的是探针会**自动补打长流**去追信号，一轮追下来白烧了 25 次长生成。
 *
 * 这个探针换三件事：
 * 1. **覆盖判据不用我的笔记本时钟**。改比 `pod.deletionTimestamp` 与该 run 在账本里的
 *    `insertTime`/`updateTime`（都是 pod 自己写的时间，同一个时钟域）。落在区间内就是真覆盖。
 * 2. **流要长到跨过信号间隔**：请求 ~14000 字，墙钟实测 100–140s，信号（60–130s）必然落在里面。
 * 3. **不自动补打**。信号没抓到就报"本窗口无效"，绝不为了追信号再花一次调用。
 *
 * 三档判定（用户侧与档案侧分开看，它们可以不一致）：
 * - `等到完整`：客户端看到 `done` 且档案 `progress=finish` 且字数一致
 * - `被切但落档`：客户端连接断了，档案仍 `finish`（用户少看了后半段，钱与档案都在）
 * - `蒸发`：档案非 finish 或没有行 ⇒ 这才是 P-10 原本描述的那种损失
 *
 * 用法（在 `src/` 下）：
 *   $env:KUBECONFIG='<dev kubeconfig>'; node evals/platform-probes/inflight-survival-probe.mjs --count=2 --out=<路径>
 * 需要授权的动作只有一个：`kubectl rollout restart`（dev 单一应用）。
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
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || val('token', 'menglb%3Aa4ee9660d66011f1acd8b13c0b88ab1d'))
const KUBECONFIG = process.env.KUBECONFIG || val('kubeconfig', '')
const NS = val('ns', 'xxzx')
const DEPLOY = val('deploy', 'llm-api-http')
const COUNT = Number(val('count', 2))
const STAGGER_MS = Number(val('stagger', 8000))
const RESTART_AT_MS = Number(val('restartAt', 6000))
const SIGNAL_WAIT_MS = Number(val('signalWait', 300000))
const OUT = val('out', '')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const LINES = []/**
 * @description 自己落文件再打印（PowerShell 的 `*>` 会把中文键名转烂）
 * @param {String} note 事件名
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'inflight-survival', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}
if (!KUBECONFIG) {
    log('拒绝启动', {原因: '没有 KUBECONFIG ⇒ kubectl 会退化成连 localhost:8080 并失败，那次的"没抓到信号"是装置问题不是结论'})
    process.exit(2)
}
/**
 * `--noRestart`：只做**计时预检**——不触发滚动、不轮询信号，只量一条长流的墙钟。
 * 为什么需要这一步：本探针的整个设计前提是"流比信号间隔长"，
 * 而 `rollout restart` 到旧 pod 收到 SIGTERM 实测要 60–130s。
 * 先量时长再决定铺几条，比铺完发现"又没覆盖上"再烧一轮便宜得多。
 */
const NO_RESTART = argv.includes('--noRestart')
/**
 * 信号来源：`rollout`（真实滚动，会同时摘端点）或 `kill`（只发 SIGTERM，不删 pod、不动端点）。
 * 这两个档回答的是**不同的问题**，所以不许混着用：前者测"用户实际会碰到什么"，
 * 后者测"应用自己收到信号后到底等多久"。
 */
const SIGNAL_VIA = val('signalVia', 'rollout')

/**
 * @description 跑 kubectl（失败原文带回，不静默）
 * @param {Array<String>} args 参数
 * @returns {{ok: Boolean, out: String}} 结果
 */
function kc(args) {
    try {
        return {ok: true, out: execFileSync('kubectl', ['--kubeconfig', KUBECONFIG, '-n', NS, ...args],
            {encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})}
    } catch (e) {
        return {ok: false, out: String(e?.stderr || e?.message || e).replace(/\s+/g, ' ').slice(0, 240)}
    }
}

/**
 * @description 取 pod 快照（含 deletionTimestamp 与容器启动时刻）
 * @returns {Array<Object>} 快照
 */
function pods() {
    const r = kc(['get', 'pods', '-l', `app=${DEPLOY}`, '-o', 'json'])
    if (!r.ok) {
        throw new Error(`kubectl 不可用: ${r.out}`)
    }
    return JSON.parse(r.out).items.map(p => ({
        name: p.metadata.name,
        uid: p.metadata.uid,
        created: p.metadata.creationTimestamp,
        del: p.metadata.deletionTimestamp || '',
        restarts: p.status?.containerStatuses?.[0]?.restartCount ?? -1,
        ready: (p.status?.conditions || []).find(c => c.type === 'Ready')?.status,
    }))
}

let before
try {
    before = pods()
} catch (e) {
    log('拒绝启动', {原因: String(e.message).slice(0, 200)})
    process.exit(2)
}
if (!before.length) {
    log('拒绝启动', {原因: `ns=${NS} 下没有 app=${DEPLOY} 的 pod`})
    process.exit(2)
}
const beforeUids = new Set(before.map(p => p.uid))

const QUERY = '请连续写一篇 14000 字以上的长文，主题是一次深夜的平滑发布：信号如何到达、端点如何摘除、'
    + '以及那些正在生成到一半的回答后来去了哪里。要求分八章，每章都要有具体场景与对话，不要调用工具，不要中途停下来问确认，一次性写完。'

const rows = []
/**
 * @description 打一条长流并记录客户端侧形态
 * @param {Number} i 序号
 * @returns {Promise<Object>} 该轮读数
 */
async function stream(i) {
    const conversationCode = `isv-${Date.now()}-${i}`
    const t0 = Date.now()
    let chars = 0, lastSeq = 0, end = 'unknown', http = 0, ct = '', error = '', messageCode = '', firstByte = 0
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            /** 与 `rollout-drop-probe` 同一套鉴权头（`param-accessToken`）：这里写错一个头名就是整窗 401 */
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': TOKEN},
            body: JSON.stringify({query: QUERY, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: AbortSignal.timeout(420000),
        })
        http = r.status
        ct = String(r.headers.get('content-type') || '')
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            if (!firstByte) {
                firstByte = Date.now() - t0
            }
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
    const row = {轮: i, conversationCode, messageCode, 本地起: new Date(t0).toISOString(), 本地止: new Date().toISOString(),
        墙钟ms: Date.now() - t0, ttfb: firstByte, 字符: chars, 末帧seq: lastSeq, 用户侧: end, http, ct, error}
    rows.push(row)
    log(`第 ${i} 轮结束`, row)
    return row
}

log('开窗', {BASE, ns: NS, deploy: DEPLOY, 条数: COUNT, 间隔ms: STAGGER_MS, 触发延后ms: RESTART_AT_MS,
    改前pod: before.map(p => `${p.name}@${p.created}(restarts=${p.restarts})`)})

const ps = []
for (let i = 1; i <= COUNT; i++) {
    ps.push(stream(i))
    await new Promise(r => setTimeout(r, STAGGER_MS))
}

/* 信号来源：两种，用 `--signalVia` 选。
 * - `rollout`（默认）：真实滚动。信号 = 旧 pod 的 deletionTimestamp。**但它同时会摘端点、断连接**，
 *   所以"流被切"可能来自链路而不是应用。
 * - `kill`：只给每个 pod 的 PID 1 发 SIGTERM（`kubectl exec -- kill 1`），**不删 pod、不动端点**。
 *   这一档专门用来把两件事分开：应用有没有等（kill→断开 ≈ close delay）
 *   vs 链路在删除那一刻就把连接拆了（deletion→断开 ≈ 0s）。
 * 两种都只在流在途时触发一次，绝不因为没抓到就再来一次。
 */
let signal = null
let tRestart = 0
if (!NO_RESTART) {
    await new Promise(r => setTimeout(r, Math.max(0, RESTART_AT_MS - COUNT * STAGGER_MS)))
    tRestart = Date.now()
    let rr
    if (SIGNAL_VIA === 'kill') {
        rr = before.map(p => ({pod: p.name, ...kc(['exec', p.name, '--', 'kill', '1'])}))
        log('已对 PID 1 发 SIGTERM', {
            本地时刻: new Date(tRestart).toISOString(),
            每pod: rr.map(x => ({pod: x.pod, ok: x.ok, out: x.out.trim().slice(0, 60)})),
            说明: '这一档不删 pod、不摘端点：客户端连接若还在，就只能是被应用自己关掉的',
        })
    } else {
        rr = kc(['rollout', 'restart', `deploy/${DEPLOY}`])
        log('已触发滚动', {ok: rr.ok, 本地时刻: new Date(tRestart).toISOString(), 输出: String(rr.out).trim().slice(0, 120)})
    }

    /** 轮询"信号确实到过"的硬证据：滚动看 deletionTimestamp，kill 档看 restartCount 增加 */
    const tSigEnd = Date.now() + SIGNAL_WAIT_MS
    while (!signal && Date.now() < tSigEnd) {
        let snap = []
        try {
            snap = pods()
        } catch (e) {
            log('快照失败', {err: String(e.message).slice(0, 120)})
        }
        if (SIGNAL_VIA === 'kill') {
            const restarted = snap.filter(p => {
                const base = before.find(b => b.uid === p.uid)
                return base && p.restarts > base.restarts
            })
            if (restarted.length) {
                signal = {方式: 'kill', pods: restarted.map(p => `${p.name}:restarts=${p.restarts}`), 延迟ms: Date.now() - tRestart,
                    说明: 'restartCount 增加 ⇒ 容器确实自己退出了（这就是 PID 1 收到并处理了 SIGTERM 的证据）'}
                log('抓到退出证据', signal)
                break
            }
        } else {
            const hit = snap.find(p => beforeUids.has(p.uid) && p.del)
            if (hit) {
                signal = {pod: hit.name, deletionTimestamp: hit.del, 观察到延迟ms: Date.now() - tRestart}
                log('抓到删除信号', signal)
                break
            }
            /** 旧 pod 整个消失也算信号到过（消失只可能因为被删），但要把"没看见删除瞬间"标成弱证据 */
            if (snap.filter(p => beforeUids.has(p.uid)).length === 0) {
                signal = {pod: '(旧 pod 已全部消失)', deletionTimestamp: '(未观测到 deletionTimestamp，弱证据)', 观察到延迟ms: Date.now() - tRestart}
                log('抓到删除信号（弱）', signal)
                break
            }
        }
        await new Promise(r => setTimeout(r, 2000))
    }
    if (!signal) {
        log('未抓到删除信号', {等待ms: SIGNAL_WAIT_MS, 说明: '本窗口无效：不许把"流都跑完了"读成宽限有效'})
    }
} else {
    log('计时预检（未触发滚动）', {说明: '只看长流墙钟是否长于"restart→SIGTERM"的 60–130s，够长再跑正式一轮'})
}

await Promise.allSettled(ps)

/* 档案侧：账本与 message 都是 pod 自己写的时间 ⇒ 覆盖判定与档案判定共用同一个时钟域 */
await new Promise(r => setTimeout(r, 12000))
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
/**
 * 依赖缺失要报成人话。底座仓是 pnpm 布局、`mongodb` 没链接出来，
 * 这里若让它继续走到 `require2('mongodb')`，留下的是 Node 的 MODULE_NOT_FOUND 栈——
 * **那个形状和"查无数据"太像**（本轮已在别的探针上被自己误读过一次）。
 */
let MongoClient
try {
    MongoClient = require2('mongodb').MongoClient
} catch (e) {
    log('拒绝启动', {
        原因: `依赖 mongodb 解析失败（${e.code}）：档案侧读数需要能连库的环境`,
        说明: '底座 pnpm 布局未链接 mongodb 时请回到服务仓跑；这不是"没有数据"',
    })
    process.exit(2)
}
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))

/**
 * 覆盖判据的时钟问题（第一版就踩了）：`updateTime` **只在 touchInflight 时推进**，
 * 单次 attempt 的 run 里 `insertTime` 与 `updateTime` 只差 20ms，于是"信号落在区间内"永远为假——
 * 我差点把"覆盖确实成立、三条流都被切断"读成"没覆盖、本题仍未答"。
 * 现在把客户端窗口折算进 pod 时钟域：用每轮自己的 `insertTime − 本地起` 求偏移（实测 ≈ +41ms），
 * 再判断 `deletionTimestamp` 是否落在 [insertTime, 本地止+偏移] 内。
 * @param {Object} r 该轮读数（含本地起止与账本行）
 * @param {Number|null} delMs 删除信号（集群时钟，毫秒）
 * @returns {Object} {偏移ms, 覆盖成立, 依据}
 */
function coverageOf(r, delMs) {
    if (!r.账本行 || !delMs) {
        return {偏移ms: null, 覆盖成立: null, 依据: r.账本行 ? '(未抓到删除信号)' : '(账本无行)'}
    }
    const skew = Date.parse(r.账本行.insertTime) - Date.parse(r.本地起)
    const endPod = Date.parse(r.本地止) + skew
    const inside = delMs >= Date.parse(r.账本行.insertTime) && delMs <= endPod
    return {
        偏移ms: skew,
        覆盖成立: inside,
        依据: `删除信号落在 pod 时钟区间的${inside ? '内' : '外'}：[${r.账本行.insertTime}, ${new Date(endPod).toISOString()}]`,
    }
}

/**
 * 信号时刻（毫秒）：rollout 档用集群给的 deletionTimestamp；
 * kill 档没有 deletionTimestamp，用发出信号的本地时刻——两档的时钟偏移实测 ≈ 0（-13ms ~ +41ms），
 * 所以这个混用在"判断几十秒量级的等待"上是安全的，但**读数里要标明用的是哪种时刻**。
 */
const delMs = SIGNAL_VIA === 'kill'
    ? (signal ? tRestart : null)
    : (signal && /^\d{4}-/.test(signal.deletionTimestamp) ? Date.parse(signal.deletionTimestamp) : null)
const detail = []
for (const r of rows) {
    const usage = await db.collection('llmUsage').find({conversationCode: r.conversationCode},
        {projection: {_id: 0, progress: 1, insertTime: 1, updateTime: 1, modelCalls: 1, upstreamAttempts: 1, latencyMs: 1, completionTokens: 1}}).toArray()
    const msg = await db.collection('message').find({conversationCode: r.conversationCode},
        {projection: {_id: 0, progress: 1, answerLen: {$strLenCP: {$ifNull: ['$answer', '']}}}}).toArray()
    const u = usage[0] || null
    const m = msg[0] || null
    /**
     * 覆盖判定改用 `coverageOf`（pod 时钟域 + 客户端窗口折算）。
     * 原来这里直接拿 `updateTime` 当"run 结束"，而单 attempt 的 run 不会推进它 ⇒ 区间只有 20ms。
     */
    const cov = coverageOf({...r, 账本行: u}, delMs)
    const bucket = m?.progress === 'finish'
        ? (r.用户侧 === 'done' && m.answerLen === r.字符 ? '等到完整' : '被切但落档')
        : (u ? '到达但未落档' : '蒸发（账本都没有行）')
    detail.push({
        轮: r.轮, 用户侧: r.用户侧, 客户端字符: r.字符, 档案: m?.progress || '(无行)', 档案字数: m?.answerLen ?? 0,
        /**
         * `距信号ms` 是这一轮最要紧的一个数：信号发出后连接还活了多久。
         * ≈0 ⇒ 连接是被拆除方（链路/端点）切的，应用根本没机会等；
         * ≈close delay ⇒ 应用等到了自己的上限才退出；> delay ⇒ 宽限根本没用上。
         */
        距信号ms: delMs ? Date.parse(r.本地止) - delMs : null,
        账本: u?.progress || '(无行)', 账本发起: u?.modelCalls ?? 0, attempts: u?.upstreamAttempts ?? 0,
        墙钟ms: r.墙钟ms, 覆盖成立: cov.覆盖成立, 时钟偏移ms: cov.偏移ms, 覆盖依据: cov.依据, 分桶: bucket,
        账本区间: u ? [u.insertTime?.toISOString?.(), u.updateTime?.toISOString?.()] : null,
        http: r.http, contentType: r.ct, err: r.error,
    })
}
await client.close()

log('逐轮对照', {删除信号: signal?.deletionTimestamp || '(无)', 明细: detail})
const 覆盖 = detail.filter(x => x.覆盖成立 === true)
const 蒸发 = detail.filter(x => x.分桶.startsWith('蒸发') || x.分桶 === '到达但未落档')
const 完整 = detail.filter(x => x.分桶 === '等到完整')
const 墙钟 = detail.map(x => x.墙钟ms).sort((a, b) => a - b)
if (NO_RESTART) {
    log('判定', {
        性质: '计时预检（本轮没有触发滚动，因此不对"宽限是否接得住"下任何结论）',
        墙钟ms: 墙钟,
        要求: '正式一轮需要 流墙钟 > restart→SIGTERM 的 60–130s，否则信号永远落在流结束之后',
        结论: 墙钟.length && 墙钟[0] > 130000
            ? `✅ 最短一条 ${Math.round(墙钟[0] / 1000)}s > 130s ⇒ 铺 ${COUNT} 条首尾相接后，SIGTERM 大概率落在某条流中间`
            : `⚠️ 最短一条 ${Math.round((墙钟[0] || 0) / 1000)}s ≤ 130s ⇒ 正式一轮必须把信号等待窗与流长对上（否则又是"覆盖不成立"）`,
    })
    process.exit(0)
}
log('判定', {
    总轮数: detail.length,
    信号方式: SIGNAL_VIA,
    距信号ms: detail.map(x => x.距信号ms),
    覆盖成立的轮数: 覆盖.length,
    分桶: Object.fromEntries([...new Set(detail.map(x => x.分桶))].map(k => [k, detail.filter(x => x.分桶 === k).length])),
    结论: 覆盖.length === 0
        ? '⚠️ **没有一条流被证明"SIGTERM 时在途" ⇒ 本题仍未答**。不拿"全 done"当宽限有效——那正是前四轮的错。'
        : 蒸发.length === 0
            ? `✅ 覆盖成立 ${覆盖.length} 轮，且这些轮没有一条蒸发（其中 ${完整.length} 轮客户端与档案逐字一致）`
                + ' ⇒ 入口修法（PID 1 = node）+ grace 60 + delay 45000 三者一起，把在途 run 等完了'
            : `❌ 覆盖成立 ${覆盖.length} 轮里仍有 ${蒸发.length} 轮损失（${蒸发.map(x => `第${x.轮}轮:${x.分桶}`).join(', ')}）`
                + ' ⇒ 信号可达≠一定接得住，要看剩余时长是否容得下 grace/宽限',
})
process.exit(覆盖.length === 0 ? 3 : 0)
