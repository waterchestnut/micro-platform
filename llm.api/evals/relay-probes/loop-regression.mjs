/**
 * @fileOverview 主循环行为回归探针：对比 llmLoop 抽取前后的事件形态
 * @module evals/relay-probes/loop-regression
 * @description
 * `execChat` 的纯决策逻辑抽到 `services/core/llmLoop.js` 时承诺**行为逐字一致**（§纪律 2）。
 * 单测守的是函数本身，这个探针守的是"接线后整条循环没有变"：
 * 用同一类会触发工具的提问打一次流式对话，统计事件形态并与基线比对。
 *
 * 用法（需要本地或 dev 的 llm.api 可达）：
 *   # 终端 A：cd src && $env:PORT=12008; npx fastify start -l error app.js
 *   # 终端 B：cd src && node evals/relay-probes/loop-regression.mjs
 *   node evals/relay-probes/loop-regression.mjs --base=http://127.0.0.1:12008
 *
 * 说明：
 * - 直连 llm.api 时用它信任的 `user-info` 头（网关同款），不需要 accessToken；
 * - 会真实调用模型与搜索工具，产生 token 费用；
 * - **基线值来自 v1.6 的实测**（同族问题、协议 2）：`meta` 先到、6 次 `reset`、6 次 `tool_result`、
 *   结束时可见字符为 0、落库 `iterationCount=6`。模型输出本身不确定，因此**只比对结构不变量**，
 *   不比对文本内容。
 */
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '--base=http://127.0.0.1:12008').split('=')[1]
const USER = {userCode: process.env.PROBE_USER || 'menglb', realName: '探针'}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const log = (t, o) => console.log(JSON.stringify({probe: t, ...o}))

const conversationCode = `loop-regression-${Date.now()}`
const query = '帮我搜一下 2026 年 11 月国内高校有哪些公开的教研相关新闻，简要列出来源。'

const t0 = Date.now()
let metaFirst = null, deltas = 0, resets = 0, toolResults = 0, sources = 0, done = false, error = null
let chars = 0, charsLost = 0, acc = 0
const order = []

const r = await fetch(`${BASE}/core/chat/stream`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': b64(USER)},
    body: JSON.stringify({
        query,
        conversationCode,
        options: {channel: 'xxzx_common', protocol: 2, cache: false, streamToolResults: true},
    }),
    signal: AbortSignal.timeout(240000),
})

if (!r.ok) {
    log('请求失败', {status: r.status, body: (await r.text().catch(() => '')).slice(0, 300)})
    process.exit(1)
}

const dec = new TextDecoder()
let buf = ''
for await (const cv of r.body) {
    buf += dec.decode(cv, {stream: true})
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
        const f = buf.slice(0, i); buf = buf.slice(i + 2)
        const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
        const data = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
        if (metaFirst === null) metaFirst = ev
        order.push(ev)
        let j = null; try { j = JSON.parse(data) } catch { /* 非 JSON */ }
        if (ev === 'delta') {
            deltas++
            const c = j?.content || ''
            acc += c.length; chars += c.length
        } else if (ev === 'reset') {
            resets++
            charsLost += acc; acc = 0
        } else if (ev === 'tool_result') toolResults++
        else if (ev === 'sources') sources++
        else if (ev === 'done') done = true
        else if (ev === 'error') error = data.slice(0, 160)
    }
}

/* 查落库形态 */
await new Promise(res => setTimeout(res, 4000))
const lr = await fetch(`${BASE}/core/message/list`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'user-info': b64(USER)},
    body: JSON.stringify({filter: {conversationCode}, pageIndex: 1, pageSize: 2}),
})
const lj = await lr.json().catch(() => null)
const m = (lj?.data?.rows || [])[0]

/* PR-B：段留存的可观测量 */
const segs = m?.process?.segments || []
/** 真正**存进库**的中间正文（answer/finalize 段有意为空，全文在 message.answer） */
const segStoredText = segs.reduce((n, s) => n + (s.text ? s.text.length : 0), 0)
/** 承载最终正文的那一段：`answer` 段是权威（`finalize` 段记的是那次调用的产出，兜底路径上两者不等） */
const segFinal = [...segs].reverse().find(s => s.ref === 'answer')
/** 中间过程的真实字数（`ref==='answer'` 的那些段属于"最终正文"，另算） */
const segBodyChars = segs.filter(s => s.ref !== 'answer').reduce((n, s) => n + (s.metrics?.chars || 0), 0)

const invariants = {
    '首事件是 meta': metaFirst === 'meta',
    '有 done 或 error 收尾': done || !!error,
    'tool_result 与 reset 数量同阶（每次工具调用一次 reset）': Math.abs(toolResults - resets) <= 1,
    '落库 progress 合法': ['finish', 'abort', 'error'].includes(m?.progress),
    'iterationCount 与 reset 次数同阶': Math.abs((m?.process?.iterationCount || 0) - resets) <= 2,
    'process.toolCalls 有名字可展示': (m?.process?.toolCalls || []).every(x => typeof x.name === 'string' && x.name),
    'answer 长度与实收末段一致（reset 后重新计数）': Math.abs((m?.answer || '').length - acc) <= 40,
    /** PR-A（§2E-3）新增：空答案不再是可落库的形态 */
    '落库 answer 非空（§2E-3 修复）': (m?.answer || '').length > 0,
    'progress=finish 时 answer 必非空': !(m?.progress === 'finish' && !(m?.answer || '').length),
    'process.loopExit 已落库可观测': ['break', 'exhausted', 'no-iterations', 'unknown'].includes(m?.process?.loopExit),
    'loopExit=exhausted 时要么补过收尾调用、要么 progress 不是 finish':
        m?.process?.loopExit !== 'exhausted' || m?.process?.forcedFinal === true || m?.progress !== 'finish',
    /** PR-B：过程分段留存。这一条是"40% 轮次的中间内容只存在于已经断开的那条 SSE 连接里"的终结 */
    'process.segments 已落库': Array.isArray(m?.process?.segments) && m.process.segments.length > 0,
    '每段都带服务端给的 kind/category/title/metrics（前端零猜测）':
        (m?.process?.segments || []).every(s => s.kind && s.category && s.title && s.metrics && typeof s.metrics.chars === 'number'),
    /** 核心：客户端在流里看到过的每一个字，现在要么在 answer 里、要么在段里，一处都不该少 */
    '落库 answer + 段存正文 == 实收字符（中间内容不再丢失）':
        Math.abs((m?.answer || '').length + segStoredText - chars) <= 40,
    '段里存的正文覆盖了被 reset 抹掉的字符': segStoredText >= charsLost - 40,
    '默认预算内不丢段（segmentSummary.dropped.count=0）': (m?.process?.segmentSummary?.dropped?.count || 0) === 0,
    /**
     * 摘要口径唯一：**留存下来的过程字数**。
     * 之前把"最终答案"也加进去过，于是同一个数既是过程量又是总量，谁也说不清它是什么；
     * 兜底路径上"部分正文 + 原因"同时出现在过程段与 answer 里，那种口径必然重复计数。
     */
    'segmentSummary.processChars == 中间过程段的真实字数（含被丢掉的）':
        (m?.process?.segmentSummary?.processChars ?? -1) === segBodyChars + (m?.process?.segmentSummary?.dropped?.chars || 0),
    /** 承载最终正文的那一段（没打满→answer，打满→finalize）字数应与落库 answer 对齐 */
    '承载最终正文的段与落库 answer 一致': Math.abs((segFinal?.metrics?.chars ?? -1) - (m?.answer || '').length) <= 40,
    'answer/finalize 段不重复存正文（体积纪律）':
        segs.filter(s => ['answer', 'finalize'].includes(s.kind)).every(s => s.text === '' && s.ref === 'answer'),
}
const failed = Object.entries(invariants).filter(([, v]) => !v).map(([k]) => k)

log('结构不变量', {
    conversationCode,
    ms: Date.now() - t0,
    首事件: metaFirst,
    delta: deltas,
    reset: resets,
    tool_result: toolResults,
    sources,
    实收字符: chars,
    被reset抹掉字符: charsLost,
    末段字符: acc,
    落库: m ? {
        progress: m.progress,
        answerLen: (m.answer || '').length,
        iterationCount: m.process?.iterationCount,
        answerRounds: m.process?.answerRounds,
        loopExit: m.process?.loopExit,
        forcedFinal: m.process?.forcedFinal,
        tools: (m.process?.toolCalls || []).map(x => x.name),
        /** PR-B：段留存形态。titles 是给人看的，metrics 是给评测算的 */
        segments: segs.map(s => `${s.seq}:${s.kind}:${s.metrics.chars}字/${s.metrics.toolCount}工具/${s.metrics.ms}ms`),
        segmentTitles: segs.map(s => s.title),
        segmentSummary: m.process?.segmentSummary,
        段存正文: segStoredText,
        中间段真实字数: segBodyChars,
    } : null,
    error,
    判定: failed.length ? `❌ 不满足：${failed.join('; ')}` : '✅ 全部不变量通过（结构不变量 + §2E-3 空答案修复）',
})
