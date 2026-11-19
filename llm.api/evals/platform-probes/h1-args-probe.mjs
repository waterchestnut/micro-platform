/**
 * @fileOverview H1 端到端验证：工具**入参**是否真的进了流与档案（dev 只读自己的会话）
 * @module evals/platform-probes/h1-args-probe
 * @description
 * H1 的单测只能证明纯函数与视图不吞字段，证明不了**生产链路上真的写进去了**。
 * 这条探针回答三个此前无法回答的问题（`render-payload-probe` 量到的是 `含入参的条目: 0`，
 * 因为存量行根本没有那个维度）：
 *
 * 1. 流侧：`tool_result` 事件里有没有 `args`/`argsChars`/`argsTruncated`，`argsChars` 是否 > 0；
 * 2. 档案侧：`/core/message/list` 的 `process.toolCalls[]` 里同一批字段在不在，值是否与流侧一致；
 * 3. **校准**：`argsChars` 的真实长度——这是 `limits.toolArgsChars=4000` 那个"照既有尺度对齐"的默认值
 *    唯一的数据来源。没有这一步，配置注释里那句"上线后必须复跑取分布"就永远是一句承诺。
 *
 * 纪律：
 * - 只写自己的会话（`h1-args-<ts>`），不改既有数据；
 * - **不打印入参正文**（可能含用户问题回声），只打印长度、事件名、工具名与判定；
 * - token 只从 env 取（不落文件、不打印）：`$env:DEV_TOKEN='...'` 后运行；
 * - 会产生一次真实模型费用（一次工具往返）。
 *
 * 用法：
 *   $env:DEV_TOKEN='menglb%3A<uuid>'; node evals/platform-probes/h1-args-probe.mjs [--out=h1args.json]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = 'https://api.xxzx.paretop.net/llm'
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || '')
if (!TOKEN) {
    console.log(JSON.stringify({ok: false, note: 'DEV_TOKEN 未设置：本探针不内置凭据'}))
    process.exit(2)
}
const OUT = val('out', 'h1args.json')
const CHANNEL = val('channel', 'micro_common')
const cc = `h1-args-${Date.now()}`
/** 挑一个必然走工具的问题：dev 的工具名分布里 `get_current_datetime` 就是时间查询 */
/**
 * 查询语句可换，默认还是那句时间问题。
 * **为什么必须可换**：`argsChars` 的校准样本此前只有 1 条、且值是 2（`{}`），
 * 因为 `get_current_datetime` 本来就不接参数——用固定的一句话永远测不出长入参的形状，
 * `limits.toolArgsChars=4000` 就会一直停在"照既有尺度对齐"而没有数据。
 * 换成会走 `run_code` / `search_web` 的问题才能产出真实的参数长度（run_code 的参数就是整段代码）。
 */
const QUERY = val('query', '请调用工具查一下现在的日期和时间，然后只回答它，不要自己推算。')

const hdr = (extra = {}) => ({'Content-Type': 'application/json', 'param-accessToken': TOKEN, ...extra})

/**
 * @description 把 SSE 原始字节切成帧
 * @param {String} buf 缓冲
 * @returns {Object[]} 帧列表 {event, id, data}
 */
function parseFrames(buf) {
    const out = []
    for (const block of buf.split('\n\n')) {
        if (!block.trim()) {
            continue
        }
        const ev = /^event:\s*(\S+)$/m.exec(block)
        const id = /^id:\s*(\S+)$/m.exec(block)
        const data = /^data:\s*([\s\S]*)$/m.exec(block)
        /** 注释帧（`:ping`）会被整块跳过：它没有 data */
        if (ev || data) {
            out.push({event: ev ? ev[1] : 'delta', id: id ? id[1] : null, data: data ? data[1] : ''})
        }
    }
    return out
}

const result = {conversationCode: cc, channel: CHANNEL, 判定: {}, 读数: {}}

/* ---------- 1. 走一次带工具的流 ---------- */
let raw = ''
try {
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: hdr({Accept: 'text/event-stream'}),
        body: JSON.stringify({
            query: QUERY,
            conversationCode: cc,
            options: {channel: CHANNEL, protocol: 2, cache: false},
        }),
    })
    if (!r.ok) {
        result.读数.http = {status: r.status, body: (await r.text()).slice(0, 200)}
    } else {
        const dec = new TextDecoder()
        for await (const cv of r.body) {
            raw += dec.decode(cv, {stream: true})
        }
    }
} catch (e) {
    result.读数.流异常 = String(e && e.message || e)
}

const frames = parseFrames(raw)
result.读数.事件序列 = frames.map(f => `${f.id ?? '-'}:${f.event}`)
const toolFrames = frames.filter(f => f.event === 'tool_result')
const shape = (frames[0] ? Object.keys(frames.reduce((acc, f) => {
    acc[f.event] = 1
    return acc
}, {})) : [])
result.读数.出现过的event = shape

/** 流侧 tool_result 的字段实况（只取长度与存在性，正文不外传） */
result.读数.流侧tool_result = toolFrames.map(f => {
    let o = {}
    try {
        o = JSON.parse(f.data)
    } catch {
        return {解析失败: true, 长度: f.data.length}
    }
    return {
        工具: o.tool || null,
        contentChars: (typeof o.content === 'string' ? o.content : JSON.stringify(o.content ?? '')).length,
        有args: 'args' in o,
        argsChars: o.argsChars,
        argsTruncated: o.argsTruncated,
        args实际长度: typeof o.args === 'string' ? o.args.length : null,
    }
})

/* ---------- 2. 读回档案视图 ---------- */
await new Promise(r => setTimeout(r, Number(val('waitMs', 4000))))
{
    const lr = await fetch(`${BASE}/core/message/list`, {
        method: 'POST', headers: hdr(),
        body: JSON.stringify({filter: {conversationCode: cc}, pageIndex: 1, pageSize: 10}),
    })
    const lj = await lr.json().catch(() => null)
    const rows = lj?.data?.rows || lj?.rows || []
    result.读数.历史行数 = rows.length
    result.读数.档案toolCalls = rows.map(m => ({
        progress: m.progress,
        answerChars: (m.answer || '').length,
        iterationCount: m.process?.iterationCount,
        calls: (m.process?.toolCalls || []).map(t => ({
            工具: t.name,
            有args: 'args' in t,
            argsChars: t.argsChars,
            argsTruncated: t.argsTruncated,
            resultChars: (t.result || '').length,
        })),
    }))
    /** 库里那一行到底有没有 args 这个维度（视图与库分离，这里看视图，与四端看到的一致） */
    const all = result.读数.档案toolCalls.flatMap(r => r.calls)
    result.判定.archive_has_toolCalls = all.length > 0
    result.判定.archive_every_has_args = all.length > 0 && all.every(c => c.有args)
    result.判定.archive_argsChars_gt0 = all.length > 0 && all.every(c => typeof c.argsChars === 'number' && c.argsChars > 0)
}
{
    const allStream = result.读数.流侧tool_result
    result.判定.stream_has_tool_result = allStream.length > 0
    result.判定.stream_every_has_args = allStream.length > 0 && allStream.every(c => c.有args)
    /** 流侧与档案侧的 argsChars 必须同源同值，否则 H1 只是把"两套字数"换成了"两套入参" */
    const s = allStream.map(c => c.argsChars).sort((a, b) => a - b).join(',')
    const d = (result.读数.档案toolCalls || []).flatMap(r => r.calls).map(c => c.argsChars).sort((a, b) => a - b).join(',')
    result.判定.argsChars_stream_eq_archive = Boolean(s) && s === d
    result.读数.argsChars = {stream: s, archive: d}
}
/**
 * 这条探针的通过条件写死在这里，而不是"看一眼 JSON 自己判断"：
 * 只看一眼的话，很容易把"工具根本没被调用"读成"入参功能正常"。
 */
const V = result.判定
result.通过 = V.stream_has_tool_result && V.stream_every_has_args
    && V.archive_has_toolCalls && V.archive_every_has_args
    && V.archive_argsChars_gt0 && V.argsChars_stream_eq_archive
result.未过原因 = Object.entries(V).filter(([, v]) => v !== true).map(([k]) => k)

fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n', 'utf8')
console.log(JSON.stringify({
    ok: true,
    passed: result.通过,
    failedChecks: result.未过原因,
    frames: frames.length,
    toolResults: result.读数.流侧tool_result.length,
    argsChars: result.读数.argsChars,
    file: OUT,
}))
