/**
 * @fileOverview 异常路径端到端探针：上游抛错与客户端打断时的落库形态
 * @module evals/relay-probes/error-path
 * @description
 * 对应 `docs/session-run-plan.md` §2E-2 第 2 条：主循环此前**没有 try/catch**，
 * 上游一抛（网络错误、relay 5xx、SDK 行为变更）或客户端打断以异常形态冒出来时，
 * `persistTurn` 被整段跳过 ⇒ 那一轮除了半截 SSE 什么都不留，排障只能靠日志。
 * 本探针验证"先落库、再决定对外形态"这条修复：
 * - `upstream-error`：relay 不可达 ⇒ 客户端收到 `event: error`，**同时库里必须有一条 `progress:'error'` 且带 `error` 归因的记录**；
 * - `abort`：真实流式回答中途断开 ⇒ 库里一条 `progress:'abort'` 的记录，**且只有一条**（幂等守卫生效，异常路径不得重复落库）。
 *
 * 用法（两种模式要分别起服务，因为要改 relay 地址）：
 *   # A. 上游不可达
 *   # 终端1：cd src; $env:PORT=12008; $env:relay_common_pro_baseURL='http://127.0.0.1:9/v1'; npx fastify start -l error app.js
 *   # 终端2：cd src; node evals/relay-probes/error-path.mjs --mode=upstream-error
 *   # B. 中途中断（真实 relay）
 *   # 终端1：cd src; $env:PORT=12008; npx fastify start -l error app.js
 *   # 终端2：cd src; node evals/relay-probes/error-path.mjs --mode=abort
 *
 * 三条纪律：
 * 1. 只写自己的会话（`conversationCode` 都是新建的 `error-path-*`）；
 * 2. 只看落库形态，不读他人数据；
 * 3. B 模式会产生真实模型费用（一次被中途打断的生成）。
 */
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12008'
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=upstream-error').split('=')[1]
const USER = {userCode: process.env.PROBE_USER || 'menglb', realName: '探针'}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const H = (extra = {}) => ({'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': b64(USER), ...extra})
const log = (t, o) => console.log(JSON.stringify({probe: t, ...o}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const conversationCode = `error-path-${MODE}-${Date.now()}`
const query = MODE === 'abort'
    ? '请写一篇 800 字左右的散文，主题是深夜的实验室，要求分段、有细节。'
    : '用一句话解释什么是幂等性。'

/** 打一次流：可选中途 abort */
let events = [], deltas = 0, sawError = false, sawAbortEv = false, sawDone = false, errText = '', clientAborted = false
const ac = new AbortController()
const abortTimer = MODE === 'abort' ? setTimeout(() => ac.abort(), 1500) : null
try {
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({query, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
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
            events.push(ev)
            if (ev === 'delta') deltas++
            if (ev === 'error') { sawError = true; errText = data.slice(0, 200) }
            if (ev === 'abort') sawAbortEv = true
            if (ev === 'done') sawDone = true
        }
    }
} catch (e) {
    /** 客户端主动断开时 fetch 自己会抛 AbortError，这是预期的 */
    clientAborted = String(e?.name) === 'AbortError' || /abort/i.test(String(e?.message))
} finally {
    if (abortTimer) clearTimeout(abortTimer)
}

/** 等落库（persistTurn 在流结束/异常处同步执行，这里只留一点余量） */
await sleep(3500)
const lr = await fetch(`${BASE}/core/message/list`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'user-info': b64(USER)},
    body: JSON.stringify({filter: {conversationCode}, pageIndex: 1, pageSize: 5}),
})
const rows = ((await lr.json().catch(() => null))?.data?.rows) || []
const m = rows[0]

const invariants = MODE === 'upstream-error'
    ? {
        '客户端收到 event:error': sawError,
        '库里留下了这一轮（修复前是 0 条）': rows.length === 1,
        "progress 是 'error'": m?.progress === 'error',
        'error 字段带归因文本': typeof m?.error === 'string' && m.error.length > 0,
        '归因不是 abort（上游故障不该记成用户打断）': !/^(abort|TimeoutError):/.test(String(m?.error || '')),
        '没有 done 事件（错误收尾）': !sawDone,
        '只落一条档（幂等守卫）': rows.length === 1,
    }
    : {
        '客户端确实中途断开': clientAborted || sawAbortEv,
        '库里留下了这一轮': rows.length === 1,
        '只有一条记录（不因异常路径重复落库）': rows.length === 1,
        "progress 是 'abort'": m?.progress === 'abort',
        'partial 正文可追溯（长度可为 0，但字段必须是字符串）': typeof m?.answer === 'string',
        '看到了若干 delta': deltas >= 0,
    }

const failed = Object.entries(invariants).filter(([, v]) => !v).map(([k]) => k)
log(MODE, {
    conversationCode,
    事件: [...new Set(events)],
    delta: deltas,
    客户端断开: clientAborted,
    error文本: errText,
    落库: m ? {progress: m.progress, error: (m.error || '').slice(0, 160), answerLen: (m.answer || '').length, loopExit: m.process?.loopExit, iterationCount: m.process?.iterationCount} : null,
    条数: rows.length,
    判定: failed.length ? `❌ 不满足：${failed.join('; ')}` : '✅ 全部通过',
})
process.exit(failed.length ? 1 : 0)
