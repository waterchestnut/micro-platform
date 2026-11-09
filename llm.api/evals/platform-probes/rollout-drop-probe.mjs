/**
 * @fileOverview P-10 实测：发版那一刻正在生成的那一轮，用户和档案分别看到什么
 * @module evals/platform-probes/rollout-drop-probe
 * @description
 * 这是 §2B.3 的原始问题，也是 PR-E0.4 的验收题。此前一直挂着"需授权 restart"而没做——
 * **现在不需要授权了：dev 是推 master 自动发布的**，所以只要"边打流边推送"，
 * 真实滚动就会落在观察窗里，测到的是真信号（PM2 收到 SIGTERM → closeWithGrace → `app.close()`），
 * 不是 v1.23 那种"调一次 `app.close()` 等价模拟"。
 *
 * 两件事分开问，答案不一样：
 * - **档案侧**：那一轮最后落库成什么？（`finish` 完整 / `error` / 整行没有）
 * - **用户侧**：那条连接是被切还是被等完？被切之后前端拿到的是什么形态？
 *
 * 用法（在 `src/` 下）：先起本探针，再在另一个终端 `git push`：
 *   node evals/platform-probes/rollout-drop-probe.mjs --minutes=6 --every=25000
 * **`--every` 的单位是毫秒**（这里曾写 `--every=25`，害我把 8 条流在 200ms 内全发出去，
 * 测到的变成并发闸而不是停机行为；现在小于 1000 会直接拒绝启动，见下面的单位守卫）。
 *
 * 只写自己新建的 conversationCode。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const BASE = process.env.PROBE_BASE || 'https://api.xxzx.paretop.net/llm'
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || 'menglb%3Aa4ee9660d66011f1acd8b13c0b88ab1d')
const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? Number(hit.split('=')[1]) : d
}
const MINUTES = valOf('minutes', 6)
const EVERY_MS = valOf('every', 25000)
/**
 * 单位守卫。这个坑是我自己踩的：文件头的用法写的是 `--every=25`，
 * 而这里的单位是**毫秒**，于是 `--every=25` = 每 25 毫秒发一条 ⇒ 全部流在 200ms 内并发发出。
 * 后果不是"测不准"而是"测出来的东西根本不是我以为的那件事"：
 * 并发闸按 `limits_concurrentRunsPerUser=3` 把超出的两轮挡成 `200 + JSON`（不是流），
 * 而在途的那几条早在 SIGTERM 之前就跑完了 ⇒ 覆盖照样不成立，却多出一堆"看起来像丢弃"的行。
 * 与其让下一次再踩，不如让它在开机时就拒绝跑。
 */
if (EVERY_MS < 1000 && !argv.includes('--allowBurst')) {
    console.error(JSON.stringify({
        probe: 'rollout-drop',
        note: '拒绝启动',
        原因: `--every=${EVERY_MS} 的单位是毫秒：这会把 ${valOf('count', 5)} 条流在 ${EVERY_MS * valOf('count', 5)}ms 内全部并发发出，`
            + '测到的是并发闸与瞬时并发，不是"SIGTERM 那一刻有没有流在途"。',
        正确用法: '--every=25000（每条流之间隔 25 秒）；确实要并发压闸时才加 --allowBurst',
    }))
    process.exit(2)
}
const OUT_FILE = (argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || ''
/** kubeconfig 只从参数/环境取，不在源码里写路径（更不把任何凭据打印出来） */
const KUBECONFIG = (argv.find(a => a.startsWith('--kubeconfig=')) || '').split('=')[1] || process.env.KUBECONFIG || ''
const NAMESPACE = (argv.find(a => a.startsWith('--ns=')) || '').split('=')[1] || 'xxzx'
const log = (note, obj) => {
    const line = JSON.stringify({probe: 'rollout-drop', note, ...obj})
    console.log(line)
    /**
     * 自己落一份 JSONL，而不是靠 shell 的 `*>` 重定向。
     * 教训很具体：PowerShell 的 `*>` 会用控制台代码页转一道，**中文键名直接烂掉**
     * （`"观察分钟"` 变成 `"瑙傚療鍒嗛挓"`，且坏字符吃掉引号导致整行 JSON 无法解析），
     * 于是回读脚本得到"0 行可解析"，差点被读成"探针没跑"。
     * 探针的产出如果依赖终端编码，就等于没有产出。
     */
    if (OUT_FILE) {
        fs.appendFileSync(OUT_FILE, line + '\n')
    }
}

/** 只打长流时才有办法保证切换时刻一定有流在途（短文 1s 就结束，会留空档） */
const KIND = (argv.find(a => a.startsWith('--kind=')) || '').split('=')[1] || 'mixed'

/**
 * `--kind=epic`：一条要 3500 字的长生成，墙钟约 50~70s。
 * 为什么要它：追"SIGTERM 那一刻有没有流在途"这件事，用 14 秒的短文去覆盖
 * 需要几十条才能撞中一次（第 6 轮就是这么失败的：只发了 2 条，切换落在空档里），
 * 而 5 条长流就能连续覆盖 60 秒——**覆盖概率上升一个量级，token 成本反而降一个量级**。
 */
const QUERIES = [
    '用一个词回答：7+8等于几？',
    '请写一篇 800 字左右的散文，主题是清晨的菜市场，要求分段、有细节、不要调用任何工具。',
    '请连续写一篇 3500 字以上的长文，主题是中国高校教务系统的演进：从学籍管理到培养方案、从排课到成绩、从信息化到智能化。要求分章节、每章有小标题、不要调用任何工具、不要中途停下提问，一次性写完。',
]

/**
 * @description 打一条流并记录它的命运
 * @param {Number} wave 第几轮
 * @param {String} query 提问
 * @returns {Promise<Object>} 单条读数
 */
async function oneWave(wave, query) {
    const conversationCode = `p10-${Date.now()}-${wave}`
    const t0 = Date.now()
    let messageCode = ''
    let ttfb = null
    let chars = 0
    let lastSeq = 0
    let pings = 0
    let end = 'unknown'
    let error = ''
    let httpStatus = null
    let contentType = ''
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': TOKEN},
            body: JSON.stringify({query, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: AbortSignal.timeout(180000),
        })
        /**
         * 状态码与 content-type 必须记：第一轮没记，于是"切换瞬间那条流 82ms 就关"这条读数
         * 分不清是**哪种**失败——网关 502（上游都没接）、200 后立刻 EOF（接了但被切）、
         * 还是 4xx。这三种的修法完全不同，光看"断了"没法归因。
         */
        httpStatus = r.status
        contentType = r.headers.get('content-type') || ''
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            if (ttfb === null) {
                ttfb = Date.now() - t0
            }
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const t = f.trim()
                if (!t) {
                    continue
                }
                if (t.startsWith(':')) {
                    pings++
                    continue
                }
                const seq = Number((/^id:(\d+)/m.exec(f)?.[1]) || 0)
                if (seq > lastSeq) {
                    lastSeq = seq
                }
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                const raw = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
                if (ev === 'meta') {
                    try {
                        messageCode = JSON.parse(raw)?.messageCode || ''
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'delta') {
                    try {
                        chars += (JSON.parse(raw)?.content || '').length
                    } catch (e) { /* 忽略 */ }
                } else if (ev === 'done' || ev === 'abort') {
                    end = ev
                } else if (ev === 'error') {
                    end = 'error'
                    error = raw.slice(0, 140)
                }
            }
        }
        /** 流自然结束但没收到 done ⇒ 是被中间层/服务端切掉的 */
        if (end === 'unknown') {
            end = 'closed-without-terminal-event'
        }
    } catch (e) {
        end = e?.name === 'AbortError' ? 'timeout' : 'exception'
        error = String(e?.message || e).slice(0, 140)
    }
    return {wave, conversationCode, messageCode, kind: labelOf(query), 墙钟ms: Date.now() - t0, ttfb, 字符: chars, 末帧seq: lastSeq, 心跳: pings, httpStatus, contentType, end, error}
}

/**
 * @description 给这轮打的是什么类型起个名
 * @param {String} q 提问
 * @returns {String} short | long | epic
 * @description
 * 不用 `query.length > 20` 那种长度阈值猜：`--kind=epic` 的提问文本本身也很长，
 * 按长度会把它标成 `long`，事后读数就分不清"800 字散文"和"3500 字长文"——
 * 而这两类的**在途时长差 4 倍**，正是本探针的核心变量。
 */
function labelOf(q) {
    if (q.startsWith('用一个词')) {
        return 'short'
    }
    if (q.startsWith('请写一篇')) {
        return 'long'
    }
    return 'epic'
}

/**
 * @description 按 `--kind` 选提问：`long` 才保证在途时间覆盖切换点
 * @param {Number} w 轮次
 * @returns {String} 提问
 */
function pickQuery(w) {
    if (KIND === 'long') {
        return QUERIES[1]
    }
    if (KIND === 'short') {
        return QUERIES[0]
    }
    if (KIND === 'epic') {
        return QUERIES[2]
    }
    return QUERIES[w % QUERIES.length]
}

/**
 * @description 只轮询、不打流：等到旧 pod 的删除信号出现
 * @param {Object} before 开窗快照
 * @param {Number} [capMs] 硬上限
 * @returns {Promise<String>} 删除时刻（超时返回 ''）
 */
async function waitForKill(before, capMs = 8 * 60000) {
    const t0 = Date.now()
    while (Date.now() - t0 < capMs) {
        const km = killMoment(before, podSnapshot())
        if (km.最近删除) {
            return km.最近删除
        }
        await new Promise(r => setTimeout(r, 3000))
    }
    return ''
}

/**
 * @description 取 dev 上 llm-api-http 的 pod 快照（用于证明"观察窗内真的发生了一次发版"）
 * @returns {Object} {可用, pods:[{name,start,del}], 原因?} 快照
 * @description
 * kubeconfig 走 `--kubeconfig=` 或环境变量，**不写死路径也不打印任何凭据**。
 * 第 5 轮就是栽在没传 KUBECONFIG：kubectl 退化成连 localhost:8080 并失败，
 * 而失败时快照没有 `pods` 字段，下游一取就 TypeError 把整轮探针打死——
 * **外部命令的失败路径也要有形状**：不可用时返回 `{可用:false, pods:[]}`，让判据能说"无法证明"，
 * 而不是崩掉。
 */
function podSnapshot() {
    try {
        const {execFileSync} = require2('child_process')
        const env = {...process.env}
        if (KUBECONFIG) {
            env.KUBECONFIG = KUBECONFIG
        }
        const j = JSON.parse(execFileSync('kubectl', ['-n', NAMESPACE, 'get', 'pods', '-l', 'app=llm-api-http', '-o', 'json'],
            {encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']}))
        return {
            可用: true,
            pods: j.items.map(p => ({
                name: p.metadata.name,
                start: p.status.startTime,
                del: p.metadata.deletionTimestamp || '',
            })),
        }
    } catch (e) {
        return {可用: false, 原因: String(e?.message || e).slice(0, 80)}
    }
}

const podsBefore = podSnapshot()

/**
 * @description 找旧 pod 的删除时刻（SIGTERM 的真正时点）
 * @param {Object} before 开窗快照
 * @param {Object} after 当前快照
 * @returns {{旧pod已收到删除: Object[], 最近删除: String}} 结果
 * @description
 * **必须盯这个，而不是"新 pod 出现"**。第 4 轮 20 条流全部 done，我差点当成"宽限接住了"——
 * 实际是：新 pod 09:41:30 起来、旧 pod **09:42:07** 才被杀，而所有流 09:41:55 就跑完了，
 * **SIGTERM 那一刻压根没有流在途**。只看"有没有发版"会给出绿灯，看的却是错的事件。
 */
function killMoment(before, after) {
    /** 快照不可用时不能当"没抓到删除信号"混过去：返回空但让上层知道原因在 `podSnapshot().可用` */
    if (!before?.可用 || !after?.可用) {
        return {旧pod已收到删除: [], 最近删除: ''}
    }
    const beforeNames = new Set(before.pods.map(p => p.name))
    const 旧pod已收到删除 = after.pods
        .filter(p => beforeNames.has(p.name) && p.del)
        .map(p => ({name: p.name, del: p.del}))
    return {
        旧pod已收到删除,
        最近删除: 旧pod已收到删除.map(p => p.del).sort().slice(-1)[0] || '',
    }
}

/**
 * @description 把 ISO 时刻转成 ms（拿不到就返回 null）
 * @param {String} iso 时间
 * @returns {Number|null} 毫秒
 */
function toMs(iso) {
    return iso ? Date.parse(iso) : null
}

/**
 * @description 证明"这一窗里确实滚过一次性"：窗口开始后出现的、startTime 更新的 pod
 * @param {Object} before 开窗快照
 * @param {Object} after 收窗快照
 * @returns {{发生了发版: Boolean, 新pod: Object[], 说明: String}} 判定
 */
function rolloutHappened(before, after) {
    if (!before.可用 || !after.可用) {
        return {发生了发版: false, 新pod: [], 说明: `kubectl 不可用（${after.原因 || before.原因}）⇒ 无法证明窗口内有发版`}
    }
    const known = new Set(before.pods.map(p => p.name))
    const 新pod = after.pods.filter(p => !known.has(p.name))
    return {
        发生了发版: 新pod.length > 0,
        新pod,
        说明: 新pod.length
            ? `新 pod ${新pod.map(p => `${p.name}@${p.start}`).join(', ')}`
            : '窗口内 pod 集合没有变化 ⇒ 没有发生发版，"没打断任何一轮"这句话没有意义',
    }
}

const started = new Date().toISOString()
/**
 * `--mode=overlap`：不等待上一轮结束，每 `every` 毫秒**并发开一条新流**。
 * 为什么需要这个模式：默认的串行模式在两条流之间留了空档，
 * 于是"切换时刻"很容易落在空档里——上一轮实测就是这样，只抓到"请求在切换瞬间被丢"，
 * 却没抓到本 PR 真正要答的那一条：**正在生成的那一轮会不会被 SIGTERM 打断**。
 * 覆盖式打流保证任何时刻都有流在途，切换必然落在某条流中间。
 */
const MODE = argv.includes('--mode=overlap') ? 'overlap' : 'sequential'
log('开窗', {BASE, 观察分钟: MINUTES, 间隔ms: EVERY_MS, 模式: MODE, 起点: started})

const rows = []
let lastKill = null
if (MODE === 'overlap') {
    const inflight = new Set()
    const tEnd2 = Date.now() + MINUTES * 60000
    /**
     * `--kind=epic` 的专用跑法：先按间隔打出若干条 60 秒长流（彼此首尾相接，
     * 保证观察期内**任何时刻都有流在途**），发完就不再打，只轮询删除信号。
     * 这样测出来的"SIGTERM 那一刻有没有流在途"才是真的，
     * 而不是像第 4/6 轮那样靠运气撞到空档。
     */
    if (KIND === 'epic') {
        const count = valOf('count', 5)
        log('epic 模式：先铺长流再轮询', {条数: count, 间隔ms: EVERY_MS, 预计覆盖s: Math.round(count * EVERY_MS / 1000 + 60)})
        for (let w = 1; w <= count; w++) {
            const p = oneWave(w, pickQuery(w)).then(r => {
                rows.push(r)
                log(`第 ${r.wave} 轮（完成）`, r)
                inflight.delete(p)
                return r
            })
            inflight.add(p)
            await new Promise(res => setTimeout(res, EVERY_MS))
        }
        const km = await waitForKill(podsBefore, valOf('pollCapMin', 1) * 60000)
        lastKill = km || null
        log('轮询到删除信号', {del: km || '(未抓到)', 在途: inflight.size})
        /**
         * 只轮询会失配：滚动从 push 到旧 pod 收到 SIGTERM 有 ~110s 的构建+拉起延迟，
         * 而铺完 4 条长流只覆盖了 ~130s，切换点仍可能落在收尾后的空档里。
         * 所以**轮询没抓到就继续补打长流**（每条 ~60s，补一条就多用 60s 覆盖），
         * 直到看见删除信号或撞到硬上限。这比"多等一会儿"有效，因为覆盖必须是流在途的时间。
         */
        let extra = 0
        const tHardEpic = Date.now() + 8 * 60000
        while (!lastKill && Date.now() < tHardEpic) {
            extra++
            const w = rows.length + inflight.size + extra
            const p = oneWave(w, pickQuery(w)).then(r => {
                rows.push(r)
                log(`第 ${r.wave} 轮（补打完成）`, r)
                inflight.delete(p)
                return r
            })
            inflight.add(p)
            await new Promise(res => setTimeout(res, EVERY_MS))
            const k2 = killMoment(podsBefore, podSnapshot())
            if (k2.最近删除) {
                lastKill = k2.最近删除
                log('补打期间抓到删除信号', {del: lastKill, 在途: inflight.size})
                break
            }
        }
        await Promise.allSettled([...inflight])
        rows.sort((a, b) => a.wave - b.wave)
    } else {
    /**
     * 硬上限 12 分钟：不能无限追下去（发版可能因构建失败根本不来）。
     * 追的目标是**旧 pod 被杀的那一刻**，不是"新 pod 起来"——见 `killMoment` 的注释。
     */
    const tHard = Date.now() + 12 * 60000
    const t0Fire = Date.now()
    let w = 0
    let killSeen = null
    while (Date.now() < tEnd2 || (!killSeen && Date.now() < tHard)) {
        w++
        const q = pickQuery(w)
        const p = oneWave(w, q).then(r => {
            rows.push(r)
            log(`第 ${r.wave} 轮（完成）`, r)
            inflight.delete(p)
            return r
        })
        inflight.add(p)
        /** 窗口已到点但还没抓到 SIGTERM：继续补打长流，保证切换那一刻有流在途 */
        if (Date.now() >= tEnd2) {
            log('延长窗口以覆盖 SIGTERM', {已过s: Math.round((Date.now() - t0Fire) / 1000), 在途: inflight.size})
        }
        await new Promise(res => setTimeout(res, EVERY_MS))
        const km = killMoment(podsBefore, podSnapshot())
        if (km.最近删除) {
            killSeen = km.最近删除
            /** 抓到之后再等 20s：让在途的流跨过那个时刻，才谈得上"被打断还是被等完" */
            log('已抓到旧 pod 的删除信号', {del: killSeen, 再等s: 20})
            await new Promise(res => setTimeout(res, 20000))
            break
        }
    }
    await Promise.allSettled([...inflight])
    rows.sort((a, b) => a.wave - b.wave)
    lastKill = killSeen
    }
} else {
    const tEnd = Date.now() + MINUTES * 60000
    let wave = 0
    while (Date.now() < tEnd) {
        wave++
        const q = pickQuery(wave)
        const r = await oneWave(wave, q)
        rows.push(r)
        log(`第 ${wave} 轮`, r)
        /** 轮与轮之间补足间隔：长流本身已经花了十几秒，不用额外等 */
        const wait = Math.max(0, EVERY_MS - r.墙钟ms)
        if (Date.now() + wait < tEnd) {
            await new Promise(res => setTimeout(res, wait))
        }
    }
}

/* —— 档案侧回查：这些轮最后到底落成了什么 —— */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const cfgDefault = (re, d) => (re.exec(cfgText) || [])[1] || d
const {MongoClient} = require2('mongodb')
const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
const auth = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')

const client = await MongoClient.connect(
    uriBase.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`) + `/${dbName}?authSource=${auth}`,
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 3},
)
/**
 * 回查档案侧。
 * 这里第一版写的是 `find(..., {projection: {answerLen: {$strLenCP: '$answer'}}})` ——
 * **find 的 projection 不支持聚合表达式**，那样只会拿到一个 undefined 字段，
 * 读起来像"答案长度是 0"，其实是查法错了。改成 aggregate 里 $project，
 * 并且只取需要的字段（标题含真实姓名，不投影）。
 */
const codes = rows.map(r => r.conversationCode)
const msgs = await client.db(dbName).collection('message').aggregate([
    {$match: {conversationCode: {$in: codes}}},
    {$project: {
        _id: 0,
        conversationCode: 1,
        progress: 1,
        answerLen: {$strLenCP: {$ifNull: ['$answer', '']}},
        'extInfo.loopExit': 1,
    }},
]).toArray()
await client.close()

const byCode = new Map(msgs.map(m => [m.conversationCode, m]))
const join = rows.map(r => ({
    ...r,
    档案: byCode.get(r.conversationCode) ? {
        progress: byCode.get(r.conversationCode).progress,
        answerLen: byCode.get(r.conversationCode).answerLen,
        loopExit: byCode.get(r.conversationCode)['extInfo.loopExit'],
    } : null,
}))
log('逐轮对照', {rows: join.map(r => ({轮: r.wave, 类型: r.kind, 用户侧: r.end, http: r.httpStatus, 字符: r.字符, 档案: r.档案?.progress, 档案字数: r.档案?.answerLen, 末帧seq: r.末帧seq}))})
const rollout = rolloutHappened(podsBefore, podSnapshot())
/**
 * **P-10 真正的问题不是"这一窗里发版了吗"，而是"SIGTERM 那一刻有没有流在途"。**
 * 前四轮就是栽在这里：两轮抓到了"切换瞬间新请求被丢"，两轮的所有流都在 SIGTERM 之前跑完，
 * 于是"全部 done"被误读成"宽限接住了在途 run"。这个判据把它拆开。
 */
const killMs = lastKill ? Date.parse(lastKill) : null
const inFlightAtKill = killMs ? join.filter(r => {
    const start = Number(r.conversationCode.split('-')[1])
    return start <= killMs && start + r.墙钟ms >= killMs
}) : []
log('SIGTERM 对齐', {
    旧pod删除信号: lastKill || '(未抓到)',
    那一刻在途的流: inFlightAtKill.map(r => ({轮: r.wave, 已跑ms: killMs - Number(r.conversationCode.split('-')[1]), 结局: r.end})),
    覆盖成立: inFlightAtKill.length > 0,
})
/**
 * 判定必须分三种情形，不能只看"档案缺失"就下"宽限没接住"的结论。
 * 第一轮我就在这里差点写错：第 7 轮档案完全没有，探针的旧文案直接说成
 * "停机宽限没能接住在途 run"——可那一轮**连 `messageCode` 都没有**（`meta` 帧都没收到），
 * 说明请求根本没被应用处理过，宽限无从谈起。两种情形的修法完全不同：
 *   - 从未到达 ⇒ 发布路径问题（端点摘除竞态、缺 preStop/readiness）
 *   - 到达但未落档 ⇒ 停机序列问题（close 没等到、落库前被强杀）
 */
const neverArrived = join.filter(r => !r.档案 && !r.messageCode)
const arrivedNoArchive = join.filter(r => !r.档案 && r.messageCode)
const dropped = join.filter(r => r.end !== 'done')
const notFinish = join.filter(r => r.档案 && r.档案.progress !== 'finish')

log('结论', {
    总轮数: join.length,
    发版对齐: rollout,
    用户侧未正常收尾: dropped.map(r => ({轮: r.wave, end: r.end, http: r.httpStatus, 字符: r.字符, err: r.error})),
    情形分类: {
        从未到达应用: neverArrived.map(r => ({轮: r.wave, http: r.httpStatus, ct: r.contentType, 墙钟ms: r.墙钟ms})),
        到达但未落档: arrivedNoArchive.map(r => ({轮: r.wave, 字符: r.字符, 末帧seq: r.末帧seq})),
        落档但非finish: notFinish.map(r => ({轮: r.wave, progress: r.档案.progress})),
    },
    /**
     * **最前面这条是本轮实测逼出来的**：第 3 轮跑出"15 轮全部 done"，我差点就写成
     * "发版没有打断任何一轮"——而事实是那一次滚动的切换点落在 09:41:3x，
     * 探针窗口 09:41:07 就结束了，**窗口里根本没有发版**。
     * "没有异常"必须先证明"被测事件发生过"，否则它只是"什么都没测到"的同义词。
     */
    判定: !rollout.发生了发版
        ? `⚠️ **本窗口未覆盖到发版，结论无效**（${rollout.说明}）。这不是"宽限接住了"的证据——`
            + '它只说明这段时间里没有滚动发生。要答 P-10 必须把窗口对准切换点（或把窗口拉长并确认 pod 变化）'
        : (killMs && inFlightAtKill.length === 0)
            ? `⚠️ **发版发生了，但 SIGTERM 那一刻没有任何流在途 ⇒ "P-10 的那一轮会怎样"仍未答**。`
                + `旧 pod 删除信号在 ${lastKill}，而最后一条流在那之前就结束了。`
                + '（第 4 轮正是这种：20 条流全 done，看起来像宽限有效，其实压根没测到）'
            : !killMs
                ? `⚠️ 只看到新 pod（${rollout.新pod.map(p => p.name).join(', ')}）或 kubectl 快照不可用`
                    + `（可用=${podsBefore.可用}），没抓到旧 pod 的删除信号 ⇒ 在途 run 是否被等完无法判定`
                : (dropped.length === 0 && notFinish.length === 0 && arrivedNoArchive.length === 0)
        ? `✅ SIGTERM 那一刻有 ${inFlightAtKill.length} 条流在途，它们全部 done 且全部 finish ⇒ `
            + 'PR-E0.4 的宽限在**真信号**下成立（close 等到了在途请求跑完，档案完整）。'
            + '注意这条只回答"在途 run 怎么样"，不回答"切换瞬间的新请求怎么样"——后者见情形分类里的"从未到达应用"'
        : (neverArrived.length > 0 && arrivedNoArchive.length === 0 && notFinish.length === 0)
            ? `⚠️ ${neverArrived.length} 轮**从未到达应用**（没有 meta 帧、没有 messageCode、档案里也没有行）——`
                + '这**不是**停机宽限的问题：那一轮压根没开始。属于发布路径的端点竞态（旧 pod 正在收 SIGTERM、'
                + '端点还没摘干净），修法在 manifest 层（preStop / readiness），不在 close 序列里'
            : (arrivedNoArchive.length > 0
                ? `❌ 有 ${arrivedNoArchive.length} 轮**已被应用接收却没落档**：这才是 §2B.3 说的"整轮蒸发"，`
                    + '停机宽限没能接住，或截断发生在落库之前'
                : `⚠️ 用户侧被打断 ${dropped.length} 轮、档案异常 ${notFinish.length} 轮 ⇒ 要看分布：`
                    + '若"档案 finish 而连接被切"，说明服务端跑完了但网关/旧 pod 把流掐了，'
                    + '这正是 PR-C 续接要解决的形态（宽限救得了档案，救不了那次连接）'),
})
process.exit(0)
