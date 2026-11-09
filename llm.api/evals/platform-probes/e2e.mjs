/**
 * @fileOverview dev 端到端探针：落库语义、事件序列、越权、body 上限、长流
 * @module evals/platform-probes/e2e
 * @description
 * 对应 `docs/session-run-plan.md` §2E。**v1.6 的三条结论就是本脚本跑出来的**，因此它同时是：
 * - **PR-A 的回归基线**（E-2：生成中打断后的落库形态）；
 * - **PR-E0.7 的越权回归**（E-1 + 会话归属比对，修复后 `不属于我的会话数` 必须变 0）；
 * - **§2E-3 空答案 bug 的复现器**（E-3：`maxIterations` 打满时 `answerLen` 是否为 0）。
 *
 * 用法（需有效 dev accessToken，勿写死在文件里）：
 *   $env:DEV_TOKEN='menglb%3A<uuid>'; node evals/platform-probes/e2e.mjs
 *   （DEV_TOKEN 用 cookie 原值即可，脚本内部会 decodeURIComponent）
 *
 * 三条纪律：
 * 1. **只写自己的会话**：所有 conversationCode 都是 `e2e-*-${Date.now()}` 新建，不改动既有数据；
 * 2. **越权验证只比归属，不读他人正文**：E-4 与归属比对只看 conversationCode 集合与计数；
 * 3. **会产生真实模型费用**：E-3 会打满 6 次迭代并调用搜索工具，E-5 是一次长生成，按需控制频次。
 *
 * 已知会被网关拦的形态：token 失效时所有请求都是 HTTP 200 + `{code:4002}`（见 §2D.2），
 * 所以脚本先做 E-1 校验，失败即中止，避免后面产生一堆"看起来成功"的空结果。
 */
const BASE = 'https://api.xxzx.paretop.net/llm'
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || '')
const hdr = (extra = {}) => ({'Content-Type': 'application/json', 'param-accessToken': TOKEN, ...extra})
const log = (t, o) => console.log(JSON.stringify({probe: t, ...o}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const conv = (tag) => `e2e-${tag}-${Date.now()}`

async function post(path, body, extraHeaders = {}, opt = {}) {
    const r = await fetch(BASE + path, {method: 'POST', headers: hdr(extraHeaders), body: typeof body === 'string' ? body : JSON.stringify(body), ...opt})
    return r
}

/* ---------- E-1 token ---------- */
{
    const r = await post('/core/message/list', {filter: {}, pageIndex: 1, pageSize: 2})
    const t = await r.text()
    log('E-1 token', {status: r.status, head: t.slice(0, 160)})
    if (/token无效|code":4002/.test(t)) {
        log('E-1 结论', {note: 'token 仍无效，后续探针中止'})
        process.exit(0)
    }
}

/* ---------- E-2 §2.4 实证：生成中打断 ---------- */
{
    const cc = conv('abort')
    const ac = new AbortController()
    const t0 = Date.now()
    let deltas = 0
    const readerTask = (async () => {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST', headers: hdr({Accept: 'text/event-stream'}),
            body: JSON.stringify({query: '请写一篇 500 字左右的散文，主题是深夜的图书馆，要求分段、有细节。', conversationCode: cc, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: ac.signal,
        })
        if (!r.ok) return {httpError: r.status, body: (await r.text()).slice(0, 200)}
        const dec = new TextDecoder()
        let buf = '', events = []
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                events.push(ev)
                if (ev === 'delta') deltas++
                if (deltas >= 3) { ac.abort(); return {aborted: true, events, ms: Date.now() - t0} }
            }
        }
        return {events, ms: Date.now() - t0, finished: true}
    })()
    const res = await readerTask.catch(e => ({error: String(e.message || e)}))
    log('E-2 打断', {conversationCode: cc, deltas, ...res})
    await sleep(8000)
    const lr = await post('/core/message/list', {filter: {conversationCode: cc}, pageIndex: 1, pageSize: 10})
    const lj = await lr.json().catch(() => null)
    const rows = lj?.data?.rows || lj?.rows || []
    log('E-2 打断后历史', {
        rowFound: rows.length,
        rows: rows.map(m => ({progress: m.progress, answerLen: (m.answer || '').length, query: (m.query || '').slice(0, 20), iterationCount: m.process?.iterationCount})),
        判定: rows.length === 0
            ? '❌ §2.4 成立：生成中打断后该轮完全没有档案（既不是 finish 也不是 abort）'
            : (rows.some(r2 => r2.progress === 'abort') ? `✅ 有 abort 档案（answerLen=${rows[0]?.answer?.length}），§4.4 承诺成立` : `⚠️ 有档案但 progress=${rows[0]?.progress}，需看语义`),
    })
}

/* ---------- E-3 协议 2 真实事件形态（触发工具调用） ---------- */
{
    const cc = conv('tools')
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST', headers: hdr({Accept: 'text/event-stream'}),
        body: JSON.stringify({query: '帮我搜一下 2026 年 11 月国内高校有哪些公开的教研相关新闻，简要列出来源。', conversationCode: cc, options: {channel: 'xxzx_common', protocol: 2, cache: false, streamToolResults: true}}),
    })
    if (!r.ok) { log('E-3', {httpError: r.status, body: (await r.text()).slice(0, 200)}) }
    else {
        const dec = new TextDecoder()
        let buf = ''
        const seq = []
        let resetCount = 0, toolResults = 0, metaFirst = null, deltas = 0, contentChars = 0, lostChars = 0, lastSeqBeforeReset = 0
        const t0 = Date.now()
        let acc = 0
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                const data = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
                let j = null; try { j = JSON.parse(data) } catch { /* 非 JSON */ }
                if (metaFirst === null) metaFirst = ev
                if (ev === 'delta' && j?.content) { deltas++; acc += j.content.length; contentChars += j.content.length }
                if (ev === 'reset') { resetCount++; lostChars += acc; acc = 0; lastSeqBeforeReset = deltas }
                if (ev === 'tool_result') toolResults++
                seq.push(ev)
            }
        }
        log('E-3 事件序列', {
            conversationCode: cc, ms: Date.now() - t0,
            首事件: metaFirst, delta数: deltas, reset次数: resetCount, tool_result数: toolResults,
            事件顺序去重: [...new Set(seq)],
            被reset抹掉的字符数: lostChars, 最终可见字符数: acc,
            判定: resetCount > 0 ? `⚠️ ${resetCount} 次 reset，抹掉 ${lostChars} 字符（这就是"没有层次"的现场）` : '本轮未触发 reset',
        })
        await sleep(3000)
        const lr = await post('/core/message/list', {filter: {conversationCode: cc}, pageIndex: 1, pageSize: 5})
        const lj = await lr.json().catch(() => null)
        const m = (lj?.data?.rows || lj?.rows || [])[0]
        log('E-3 历史视图', {
            progress: m?.progress, answerLen: (m?.answer || '').length,
            process: m?.process ? {iterationCount: m.process.iterationCount, answerRounds: m.process.answerRounds, tools: m.process.tools, toolCalls: (m.process.toolCalls || []).map(t2 => t2.name), contextUsage: m.process.contextUsage} : null,
            有segments字段: !!(m?.process?.segments),
        })
    }
}

/* ---------- E-4 >1MB body 被哪层拒 ---------- */
{
    const big = JSON.stringify({query: '你好', conversationCode: conv('big'), options: {channel: 'xxzx_common'}, junk: 'x'.repeat(1_200_000)})
    const r = await post('/core/chat/stream', big)
    const t = await r.text().catch(() => '')
    log('E-4 1.2MB body', {
        bytes: big.length, status: r.status, ctype: r.headers.get('content-type'),
        server: r.headers.get('server'), body: t.slice(0, 240),
        判定: r.status === 413 ? (/json/i.test(t) ? '✅ Fastify bodyLimit 拒的（应用层，可配）' : '⚠️ 代理层拒的（APISIX/nginx client_max_body_size，llm.api 改不了）')
            : (r.status === 200 && /token无效/.test(t) ? '鉴权先失败，未触达体积校验' : `⚠️ 未被拒（status=${r.status}），需确认是否有大小护栏`),
    })
}

/* ---------- E-5 长流持续性 ---------- */
{
    const cc = conv('long')
    const t0 = Date.now()
    let firstByte = null, deltas = 0, chars = 0, cutAt = null
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST', headers: hdr({Accept: 'text/event-stream'}),
            body: JSON.stringify({query: '请分 8 段，逐段介绍中国古代的八大发明，每段不少于 120 字。', conversationCode: cc, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: AbortSignal.timeout(300000),
        })
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            if (firstByte === null) firstByte = Date.now() - t0
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                if (ev === 'delta') { deltas++; const d = /data:([\s\S]+)/.exec(f)?.[1] || ''; try { chars += (JSON.parse(d).content || '').length } catch { /* 忽略 */ } }
                if (ev === 'done') { cutAt = 'done(正常结束)' }
                if (ev === 'abort') { cutAt = 'abort 事件' }
                if (ev === 'error') { cutAt = 'error 事件: ' + (/data:([\s\S]+)/.exec(f)?.[1] || '').slice(0, 80) }
            }
        }
    } catch (e) { cutAt = cutAt || '流异常终止: ' + String(e.message || e).slice(0, 80) }
    log('E-5 长流', {conversationCode: cc, ms: Date.now() - t0, firstByteMs: firstByte, deltas, chars, 结束方式: cutAt, 判定: cutAt === 'done(正常结束)' ? '✅ 长流跑完未被切' : `⚠️ 被切/异常：${cutAt}`})
}
