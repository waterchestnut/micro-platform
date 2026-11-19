/**
 * @fileOverview 找一个"UI 里可以点取回全文"的真实历史条目（只读，不产生模型调用）
 * @module evals/platform-probes/fetch-candidate-probe
 * @description
 * 为什么要这个探针而不是直接问一次模型：现网点验需要的是**已存在**的削长结果，
 * 新问一次就是花真实费用去撞一个"这个频道会不会产生该数据"的已知答案（上一轮我正是这样白烧过一次）。
 * 走前端同一条 HTTP 通道，顺带保证"这条在 UI 里看得见"——服务端已按会话成员制过滤（PR-E0.7）。
 *
 * 只打印标识符与数字：不打印正文、不打印凭据。
 * 用法：$env:DEV_TOKEN='menglb:<uuid>'; node evals/platform-probes/fetch-candidate-probe.mjs [--pages=3]
 */
import fs from 'node:fs'

const BASE = 'https://api.xxzx.paretop.net/llm'
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || '')
if (!TOKEN) {
    console.log(JSON.stringify({ok: false, note: 'DEV_TOKEN 未设置：本探针不内置凭据'}))
    process.exit(2)
}
const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PAGES = Number(val('pages', 3))
const MARK = Number(val('mark', 0))

await import('../../init.js')
const llmLoop = await import('../../services/core/llmLoop.js')

/** 标记串从实现里读，不抄字面量（抄了就和"用记忆对齐"没区别） */
const probeText = 'x'.repeat(100)
const marker = llmLoop.clipTraceResult(probeText, 10).slice(10)
if (!marker || !llmLoop.clipTraceResult(probeText, 10).startsWith('xxxxxxxxxx')) {
    console.log(JSON.stringify({ok: false, note: 'clipTraceResult 形态与预期不符，判定会失真'}))
    process.exit(3)
}

/**
 * @description 调一个 llm.api 路由
 * @param {String} p 路径
 * @param {Object} body 请求体
 * @returns {Promise<Object>} 回复
 */
async function call(p, body) {
    const r = await fetch(`${BASE}${p}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'param-accessToken': TOKEN},
        body: JSON.stringify(body),
    })
    return {status: r.status, json: await r.json().catch(() => null)}
}

const rows = []
/** HTTP 层失败单独记，绝不与消息行混在一个数组里：行自己有 `error` 列（那是服务端的失败归因），
 *  把它当"探针错误"既会误报，也会把 `query`/`answer` 之类正文带进输出（本探针的规矩是不打印正文）。 */
const httpErrors = []
for (let i = 1; i <= PAGES; i += 1) {
    const {status, json} = await call('/core/message/list', {pageIndex: i, pageSize: 100, filter: {}})
    if (status !== 200 || !json || json.code !== 0) {
        httpErrors.push({page: i, status, code: json?.code, msg: json?.msg})
        continue
    }
    const list = json.data?.rows || json.data?.list || []
    for (const m of list) rows.push(m)
}

const scanned = rows.length
const withToolCalls = rows.filter((r) => Array.isArray(r.process?.toolCalls) && r.process.toolCalls.length)
const candidates = []
for (const m of withToolCalls) {
    const tr = Array.isArray(m.process?.toolResults) ? m.process.toolResults : []
    for (const c of m.process.toolCalls) {
        const preview = typeof c.result === 'string' ? c.result : ''
        if (!preview.endsWith(marker)) continue
        const entry = tr.find((t) => t && (t.ref === c.id || t.ref === c.tool_call_id))
        if (!entry) continue
        if (entry.stored !== true) continue
        const chars = Number(entry.chars) || 0
        const previewLen = Math.max(0, preview.length - marker.length)
        if (chars > previewLen) candidates.push({messageCode: m.messageCode, conversationCode: m.conversationCode, ref: entry.ref, tool: entry.tool || c.name || null, chars, previewLen, remainGuess: chars - previewLen, progress: m.progress || null})
    }
}

/** 服务端半件：真取一次第一页，确认这个 ref 确实取得回来（不打印正文） */
let fetchCheck = null
if (candidates.length) {
    const c = candidates[0]
    const {status, json} = await call('/core/message/tool-result', {messageCode: c.messageCode, ref: c.ref, offset: 0, limit: 0})
    const d = json?.data || {}
    fetchCheck = {
        status, code: json?.code, msg: json?.msg || null,
        形状: {offset: d.offset, end: d.end, remaining: d.remaining, stored: d.stored, chars: d.chars, availableChars: d.availableChars},
        返回字符数: typeof d.content === 'string' ? d.content.length : null,
    }
}

const out = {
    ok: true,
    标记串长度: marker.length,
    扫描行数: scanned,
    带工具调用行数: withToolCalls.length,
    可点取回的候选数: candidates.length,
    候选: candidates.slice(0, MARK ? MARK : 6),
    服务端取回核对: fetchCheck,
    HTTP失败: httpErrors.slice(0, 3),
}
console.log(JSON.stringify(out, null, 1))
fs.writeFileSync(`C:/Users/menglb/AppData/Local/Temp/opencode/${val('out', 'fetch-candidate.json')}`, JSON.stringify(out, null, 1), 'utf8')
