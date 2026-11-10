/**
 * @fileOverview 多流并发下的停机抢救复验（P-10 / PR-E0.5 的最后一道验收）
 * @module evals/platform-probes/multi-inflight-rescue-probe
 * @description
 * 为什么要单独写这一条：`shutdown-forensics-probe` 只开**一条**流（它的 conversationCode 是单个），
 * 而我上一轮给它传 `--count=3` 时它**没有报错、按一条跑了**——
 * 一个会静默忽略未知参数的装置，会把"我测过了"变成"我什么都没测"。
 * 本题要答的是并发形态下的问题：**同时有几条在途时，是不是每条都被接住**，
 * 所以判据只用每条会话自己的档案与账本（不依赖日志归属，也不依赖单一 pod）。
 *
 * 分桶（每个桶都是独立结论，不许合并成"看起来没问题"）：
 * - `完整落档`        客户端 done + 档案 finish + 字数一致
 * - `带正文中断`      客户端 abort/done + 档案 abort 且 answerLen>0（这正是 PR-E0.5 要的结果）
 * - `空 abort(缺陷)`  档案 abort 但 answerLen=0 ⇒ 兜底在无正文时抢写了（v1.41 定位过的缺陷，再出现就是回归）
 * - `无档案(缺陷)`    档案没有行 ⇒ 回到"这一轮从未发生过"
 * - `账本未收尾(缺陷)` llmUsage 仍 processing ⇒ 遗弃扫描会把它算成损失
 * - `闸拒绝(未到达)`   HTTP 200 但 content-type 是 JSON ⇒ 从未进入应用，**不算损失也不该混进上五桶**
 *
 * 用法（在 `src/` 下）：
 *   $env:KUBECONFIG='<dev kubeconfig>'
 *   node evals/platform-probes/multi-inflight-rescue-probe.mjs --count=3 --stagger=12000 --restartAt=40000 --out=<路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'

const argv = process.argv.slice(2)
/**
 * 未知参数一律拒绝启动（就是为上一轮那次静默忽略立的规矩）。
 * @param {String} n 参数名
 * @param {String} d 默认值
 * @returns {String} 值
 */
function val(n, d) {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const KNOWN = ['count', 'stagger', 'restartAt', 'watch', 'settleMs', 'out', 'base', 'token', 'kubeconfig', 'ns', 'deploy', 'olderThanHint', 'recheck']
const unknown = argv.filter(a => a.startsWith('--') && !KNOWN.includes(a.split('=')[0].replace(/^--/, '')))
if (unknown.length) {
    console.error(JSON.stringify({
        probe: 'multi-inflight-rescue', note: '拒绝启动',
        原因: `未知参数 ${unknown.join(' ')}；这台装置不认识它们，静默忽略会把"我测过了"变成"我什么都没测"`,
        认识: KNOWN,
    }))
    process.exit(2)
}

const require2 = createRequire(import.meta.url)
const BASE = process.env.PROBE_BASE || val('base', 'https://api.xxzx.paretop.net/llm')
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || val('token', 'menglb%3Aa4ee9660d66011f1acd8b13c0b88ab1d'))
const KUBECONFIG = process.env.KUBECONFIG || val('kubeconfig', '')
const NS = val('ns', 'xxzx')
const DEPLOY = val('deploy', 'llm-api-http')
const COUNT = Number(val('count', 3))
const STAGGER_MS = Number(val('stagger', 12000))
const RESTART_AT_MS = Number(val('restartAt', 40000))
const WATCH_MS = Number(val('watch', 150000))
const OUT = val('out', '')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 守卫按**实际是否需要集群**来判：`--recheck=` 全程不碰 kubectl，
 * 这时候还要求 KUBECONFIG，就等于把"零成本复查"这条路自己堵死。
 */
const isRecheckRun = argv.some(a => a.startsWith('--recheck='))
if (!KUBECONFIG && !isRecheckRun) {
    console.error(JSON.stringify({probe: 'multi-inflight-rescue', note: '拒绝启动', reason: 'no KUBECONFIG: kubectl 会退化连 localhost:8080，那次的"没发生滚动"是装置问题不是结论'}))
    process.exit(2)
}
if (!Number.isFinite(COUNT) || COUNT < 1 || COUNT > 6) {
    console.error(JSON.stringify({probe: 'multi-inflight-rescue', note: '拒绝启动', reason: `count=${COUNT} 需 1..6（并发条数受 limits_concurrentRunsPerUser 约束，太多会全被闸挡回）`}))
    process.exit(2)
}

const LINES = []
/**
 * @description 自己落文件再打印
 * @param {String} note 事件
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'multi-inflight-rescue', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

/**
 * @description 跑 kubectl（失败原文带回）
 * @param {Array<String>} args 参数
 * @returns {{ok: Boolean, out: String}} 结果
 */
function kc(args) {
    try {
        return {ok: true, out: execFileSync('kubectl', ['--kubeconfig', KUBECONFIG, '-n', NS, ...args],
            {encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})}
    } catch (e) {
        return {ok: false, out: String(e?.stderr || e?.message || e).replace(/\s+/g, ' ').slice(0, 220)}
    }
}

const QUERY = (i) => `请连续写一篇 11000 字以上的长文（第 ${i} 篇），主题是"发版那一刻同时存在的几条连接各自后来怎样了"：`
    + '信号、端点摘除、被截断的回答、以及它们各自留下了什么记录。要求分七章，每章有具体场景与对话，不要调用工具，一次性写完。'

const rows = []
/**
 * 信号时刻。声明必须留在这里：上一次编辑把 `let tSignal = 0` 随旧代码块一起删了，
 * 而 `node --check` 抓不到这种错（ESM 严格模式下赋值给未声明变量是**运行时**才炸）。
 */
let tSignal = 0
/**
 * @description 打一条长流
 * @param {Number} i 序号
 * @returns {Promise<Object>} 读数
 */
async function stream(i) {
    const conversationCode = `mir-${Date.now()}-${i}`
    const t0 = Date.now()
    let chars = 0, lastSeq = 0, end = 'unknown', http = 0, ct = '', error = '', messageCode = ''
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': TOKEN},
            body: JSON.stringify({query: QUERY(i), conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: AbortSignal.timeout(300000),
        })
        http = r.status
        ct = String(r.headers.get('content-type') || '')
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
                        chars += (JSON.parse(raw)?.content || '').length
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'done' || ev === 'abort' || ev === 'error') {
                    end = ev
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
    const row = {轮: i, conversationCode, messageCode, 本地起: new Date(t0).toISOString(),
        本地止: new Date().toISOString(), 墙钟ms: Date.now() - t0, 字符: chars, 末帧seq: lastSeq,
        用户侧: end, http, ct, err: error, 距信号ms: tSignal ? Date.now() - tSignal : null}
    rows.push(row)
    log(`第 ${i} 轮结束`, row)
    return row
}

/**
 * `--recheck=<会话码,逗号分隔>`：**零模型调用**的复查档。
 * 用途很具体：上一版探针把"档案写得好好的"读成"字段没写"（扁平键），
 * 而重跑一次真实滚动要花三条长流。复查一个读法错误不该花钱。
 * 复查时没有客户端侧数据（那些流早已结束），所以 用户侧 标成 `(recheck)`，
 * 分桶只依据档案与账本——这也顺带证明：**这些判据不依赖客户端观测**。
 */
const RECHECK = (val('recheck', '') || '').split(',').map(x => x.trim()).filter(Boolean)
if (RECHECK.length) {
    for (let i = 0; i < RECHECK.length; i++) {
        rows.push({轮: i + 1, conversationCode: RECHECK[i], 用户侧: '(recheck)', 字符: null, ct: 'text/event-stream', http: 200})
    }
    log('复查模式', {条数: RECHECK.length, 说明: '不发起任何模型调用，只按同一套判据复查已有会话'})
}

log('开窗', {BASE, ns: NS, deploy: DEPLOY, count: COUNT, staggerMs: STAGGER_MS, restartAtMs: RESTART_AT_MS, watchMs: WATCH_MS})
if (!RECHECK.length) {
    const tasks = []
    const tLaunch = Date.now()
    for (let i = 1; i <= COUNT; i++) {
        tasks.push(stream(i))
        await new Promise(res => setTimeout(res, STAGGER_MS))
    }
    /** 等到"第一条流已经跑了 restartAt 毫秒"再触发滚动，保证信号落在多条流中间 */
    const waitMore = RESTART_AT_MS - (Date.now() - tLaunch)
    if (waitMore > 0) {
        await new Promise(res => setTimeout(res, waitMore))
    }
    tSignal = Date.now()
    const rr = kc(['rollout', 'restart', `deploy/${DEPLOY}`])
    log('已触发滚动', {ok: rr.ok, 此刻在途条数: tasks.length, 已启动ms: Date.now() - tLaunch, 输出: String(rr.out).trim().slice(0, 110)})
    const settled = await Promise.allSettled(tasks)
    log('全部流结束', {完成: settled.filter(x => x.status === 'fulfilled').length, 总计: settled.length})
}

await new Promise(res => setTimeout(res, Number(val('settleMs', 15000))))

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const {MongoClient} = require2('mongodb')
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))

/**
 * extInfo 里的字段必须按**嵌套对象**读。
 * 我在同一个会话里犯过两次同样的错：投影 `'extInfo.interruptedBy': 1` 返回的是
 * `{extInfo:{interruptedBy:...}}`，而代码去读扁平键 `m['extInfo.interruptedBy']` ⇒ 恒 undefined，
 * 于是把"字段写得好好的"读成"字段没写"（`abort-archive-probe` 一次、本探针一次）。
 * 顶层字段（如 `answerTokens`）也别去 extInfo 里找——那是另一处读错位置。
 * @param {Object} m 档案行
 * @param {String} k extInfo 内的键
 * @returns {*} 值或 null
 */
function extOf(m, k) {
    if (!m) {
        return null
    }
    return m.extInfo?.[k] ?? m[`extInfo.${k}`] ?? null
}

const verdict = []
for (const r of rows) {
    const m = (await db.collection('message').find({conversationCode: r.conversationCode}, {projection: {
        _id: 0, progress: 1, answerLen: {$strLenCP: {$ifNull: ['$answer', '']}},
        answerTokens: 1, extInfo: 1,
    }}).toArray())[0]
    const u = (await db.collection('llmUsage').find({conversationCode: r.conversationCode}, {projection: {
        _id: 0, progress: 1, modelCalls: 1, completionTokens: 1, estCompletionTokens: 1, estPromptTokens: 1,
    }}).toArray())[0]
    const interruptedBy = extOf(m, 'interruptedBy')
    const recoveredBy = extOf(m, 'recoveredBy')
    let bucket
    if (r.ct.includes('application/json') && r.http === 200) {
        bucket = '闸拒绝(未到达)'
    } else if (!m) {
        bucket = '无档案(缺陷)'
    } else if (m.progress === 'abort' && !(m.answerLen > 0)) {
        bucket = '空 abort(缺陷)'
    } else if (m.progress === 'abort' && !interruptedBy) {
        /**
         * 有正文、有 abort，但**没有打断来源**：这就是"一字段两义"回来了——
         * 事后没人分得清这是用户按的还是发版切的，所以它单独成一桶，不许混进"带正文中断"。
         */
        bucket = '缺打断来源(缺陷)'
    } else if (m.progress === 'abort') {
        bucket = '带正文中断'
    } else if (m.progress === 'finish') {
        bucket = r.用户侧 === 'done' && m.answerLen === r.字符 ? '完整落档' : '落档与客户端不一致'
    } else {
        bucket = `档案${m.progress}`
    }
    verdict.push({
        轮: r.轮, 分桶: bucket, 用户侧: r.用户侧, 客户端字数: r.字符,
        档案: m ? {
            progress: m.progress, answerLen: m.answerLen, interruptedBy, recoveredBy,
            /**
             * 这条档是谁写的。v1.43 留下的问题是"档案比 abort 事件晚 1 秒"却判不出来源
             * （抢救 vs 早停），当时只能靠再跑一次真实滚动去猜；这个字段就是那次欠的账。
             */
            writtenBy: extOf(m, 'writtenBy'),
            顶层answerTokens: m.answerTokens ?? null,
        } : null,
        账本: u ? {progress: u.progress, modelCalls: u.modelCalls, completionTokens: u.completionTokens, estCompletionTokens: u.estCompletionTokens || 0} : null,
        账本未收尾: !u || u.progress === 'processing',
        距信号ms: r.距信号ms, 墙钟ms: r.墙钟ms, http: r.http, contentType: r.ct, err: r.err,
    })
}
await client.close()

const 桶计数 = verdict.reduce((a, x) => {
    a[x.分桶] = (a[x.分桶] || 0) + 1
    return a
}, {})
const 缺陷 = verdict.filter(x => /缺陷/.test(x.分桶))
const 未收尾 = verdict.filter(x => x.账本未收尾 && x.分桶 !== '闸拒绝(未到达)')
log('逐条对照', {删除信号时刻: new Date(tSignal).toISOString(), 明细: verdict})
log('判定', {
    分桶: 桶计数,
    /**
     * 档案来源分布。这是本题最想知道的一行：
     * rescue 多 ⇒ 兜底在干活（正文来得晚）；early-stop 多 ⇒ 停止位真的传到了帧间；
     * unattributed 出现 ⇒ 说明有条路径我还没接线，得回去补标记，而不是当成"正常"。
     *
     * ⚠️ 分桶标签必须区分两件不同的事（上一版我把它们混成一桶，读起来像"档案丢了"）：
     *   `(无档案)`                = message 行根本不存在 ⇒ 真缺陷
     *   `(无writtenBy)`           = 行在，只是写于 §25 v1.44 之前 ⇒ 版本边界，不是缺陷
     */
    档案来源: verdict.reduce((a, x) => {
        const k = x.档案 ? (x.档案.writtenBy || '(无writtenBy，行早于v1.44上线)') : '(无档案)'
        a[k] = (a[k] || 0) + 1
        return a
    }, {}),
    闸拒绝条数: 桶计数['闸拒绝(未到达)'] || 0,
    缺陷条数: 缺陷.length,
    缺陷明细: 缺陷.map(x => `第${x.轮}轮:${x.分桶}`),
    账本未收尾条数: 未收尾.length,
    结论: 缺陷.length === 0 && 未收尾.length === 0
        ? `✅ 并发 ${verdict.length} 条流全部被接住：${JSON.stringify(桶计数)}`
            + '（闸拒绝单列，不算损失，也不进上面的判据）'
        : `❌ 仍有缺陷：${缺陷.map(x => `第${x.轮}轮 ${x.分桶}`).join(', ')}`
            + (未收尾.length ? `；账本未收尾 ${未收尾.length} 条` : ''),
})
process.exit(缺陷.length === 0 && 未收尾.length === 0 ? 0 : 1)
