/**
 * @fileOverview 控制面端到端探针（开闸第一批的验证刀：/stop、/steer soft、/steer hard）
 * @module evals/platform-probes/control-e2e-probe
 * @description
 * 铺管与开闸之后，"窗口项"要变成读数而不是推测。这一把在 dev 真网关上走完整控制链：
 *   1. /stop：长回答进行中 POST /stop ⇒ 判据：流以 abort 收尾、档案 progress=abort、
 *      interruptedBy 归因、/runStats 的 stopHandles 可见（把手表真的挂上了）。
 *   2. /steer soft：多轮工具任务进行中 POST /steer ⇒ 判据：steer_ack 事件出现在流里
 *      （injectAt=boundary/postTools）、档案 extInfo.steerings 落库、注入的插话消息进 messages。
 *   3. /steer hard：生成中 POST /steer mode=hard ⇒ 判据：ack injectAt=immediate、
 *      打断发生（日志侧"hard 插话打断生成"）、run 继续完成（不是 abort）。
 * 判据全从**流与档案**读，不依赖服务端日志（日志是旁证不是判据——§25 家规）。
 * 用法（src/ 下）：DEV_TOKEN=<解码形 token> node evals/platform-probes/control-e2e-probe.mjs [--skip=hard]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || val('base', 'https://api.xxzx.paretop.net/llm')
let TOKEN = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
try { TOKEN = decodeURIComponent(TOKEN) } catch { /* 已是解码形 */ }
const SKIP = new Set(val('skip', '').split(','))

const LINES = []
const log = (note, obj = {}) => {
    const line = JSON.stringify({probe: 'control-e2e', note, ...obj})
    LINES.push(line)
    console.log(line)
}
const headers = {'Content-Type': 'application/json', 'param-accessToken': TOKEN}
const b64User = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '控制面探针'})).toString('base64')

/**
 * @description 打一条流并全程收集事件（不掐断，直到终态）
 * @param {Object} p {query, conversationCode, onEvent}
 * @returns {Promise<Object>} 收集结果
 */
async function streamCollect({query, conversationCode, onEvent}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 180000)
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {...headers, Accept: 'text/event-stream'},
        body: JSON.stringify({query, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false, memory: {enabled: false}}}),
        signal: controller.signal,
    })
    if (!(r.headers.get('content-type') || '').includes('text/event-stream')) {
        clearTimeout(timer)
        return {fatal: '非 SSE 响应：' + (await r.text()).slice(0, 80), events: [], messageCode: '', terminal: 'not-sse'}
    }
    const dec = new TextDecoder()
    let buf = ''
    let messageCode = ''
    let terminal = 'closed'
    const events = []
    try {
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let k
            while ((k = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, k)
                buf = buf.slice(k + 2)
                const t = f.trim()
                if (!t || t.startsWith(':')) continue
                const ev = /event:(\S+)/.exec(t)?.[1] || 'delta'
                const raw = (/data:([\s\S]+)/.exec(t)?.[1] || '').replace(/\n/g, '')
                let parsed = null
                try { parsed = JSON.parse(raw) } catch { /* 非 JSON 帧 */ }
                if (parsed?.messageCode && !messageCode) messageCode = parsed.messageCode
                events.push({ev, parsed, at: Date.now()})
                if (onEvent) onEvent(ev, parsed)
                if (ev === 'done' || ev === 'abort' || ev === 'error') { terminal = ev; break }
            }
            if (terminal !== 'closed') break
        }
    } finally {
        clearTimeout(timer)
    }
    return {events, messageCode, terminal}
}

/**
 * @description 打控制面 POST（/stop /steer）
 */
async function ctl(path, body) {
    const r = await fetch(`${BASE}${path}`, {method: 'POST', headers, body: JSON.stringify(body)})
    const txt = await r.text()
    let json = null
    try { json = JSON.parse(txt) } catch { /* 保留原文 */ }
    return {status: r.status, json, raw: txt.slice(0, 120)}
}

await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/init.js')
const {Message} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/daos/core/schema/index.js')
const {LlmUsage} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/daos/core/schema/index.js')

const results = {}
const wait = (ms) => new Promise((res) => setTimeout(res, ms))

// —— 1. /stop ——
if (!SKIP.has('stop')) {
    const conv = `ctl-e2e-stop-${Date.now()}`
    log('stop·发起长回答')
    const p = streamCollect({query: '请写一篇 2000 字以上的长文，逐段详细介绍中国三十六种传统手工艺，每种至少五十字，从第一种开始依次写。', conversationCode: conv})
    await wait(9000)
    const started = Date.now()
    // messageCode 还没拿到（meta 帧可能已到），先查账本 processing 行
    const row = await LlmUsage.findOne({conversationCode: conv, progress: 'processing'}, {messageCode: 1}).lean()
    let stopRes = null
    if (row) {
        stopRes = await ctl('/core/chat/stop', {messageCode: row.messageCode})
        log('stop·投递', {httpStatus: stopRes.status, resp: stopRes.json})
    }
    const out = await p
    const stopMs = Date.now() - started
    const doc = row ? await Message.findOne({messageCode: row.messageCode}, {progress: 1, answer: 1, extInfo: 1}).lean() : null
    const ok = out.terminal === 'abort' && doc?.progress === 'abort' && (doc?.extInfo?.interruptedBy || '') !== ''
    results.stop = {ok, terminal: out.terminal, docProgress: doc?.progress, interruptedBy: doc?.extInfo?.interruptedBy, stopToTerminalMs: stopMs, answerLen: (doc?.answer || '').length}
    log('stop·判定', results.stop)
}

// —— 2. /steer soft ——
if (!SKIP.has('soft')) {
    const conv = `ctl-e2e-soft-${Date.now()}`
    log('soft·发起工具链任务')
    const acks = []
    const p = streamCollect({
        query: '请依次搜索并简要总结以下四个主题各自的最新进展：新能源汽车、商业航天、具身智能、量子计算。每个主题单独搜索一次。',
        conversationCode: conv,
        onEvent: (ev, parsed) => { if (ev === 'steer_ack') acks.push(parsed) },
    })
    await wait(12000)
    const row = await LlmUsage.findOne({conversationCode: conv, progress: 'processing'}, {messageCode: 1}).lean()
    let steerRes = null
    if (row) {
        steerRes = await ctl('/core/chat/steer', {messageCode: row.messageCode, text: '量子计算那个主题不用搜了，直接跳过它。', mode: 'soft', steerCode: `e2e-soft-${Date.now()}`})
        log('soft·投递', {httpStatus: steerRes.status, resp: steerRes.json})
    }
    const out = await p
    const doc = row ? await Message.findOne({messageCode: row.messageCode}, {progress: 1, extInfo: 1, messages: 1}).lean() : null
    const steerings = doc?.extInfo?.steerings
    const injectedInMessages = Array.isArray(doc?.messages) && doc.messages.some(m => m.role === 'user' && String(m.content || '').includes('用户插话'))
    const ok = acks.length >= 1 && Array.isArray(steerings) && steerings.length >= 1 && injectedInMessages && out.terminal === 'done'
    results.soft = {ok, ackCount: acks.length, ackInjectAt: acks.map(a => a.injectAt), steeringsLen: Array.isArray(steerings) ? steerings.length : null, injectedInMessages, terminal: out.terminal}
    log('soft·判定', results.soft)
}

// —— 3. /steer hard ——
if (!SKIP.has('hard')) {
    const conv = `ctl-e2e-hard-${Date.now()}`
    log('hard·发起长生成')
    const acks = []
    const t0 = Date.now()
    const p = streamCollect({
        query: '请写一篇 2000 字以上的长文，逐段详细介绍中国三十六种传统手工艺，每种至少五十字，从第一种开始依次写。',
        conversationCode: conv,
        onEvent: (ev, parsed) => { if (ev === 'steer_ack') acks.push({...parsed, seenAt: Date.now()}) },
    })
    await wait(10000)
    const row = await LlmUsage.findOne({conversationCode: conv, progress: 'processing'}, {messageCode: 1}).lean()
    let steerRes = null
    let hardAt = 0
    if (row) {
        hardAt = Date.now()
        steerRes = await ctl('/core/chat/steer', {messageCode: row.messageCode, text: '停，只写前三种就够了。', mode: 'hard', steerCode: `e2e-hard-${Date.now()}`})
        log('hard·投递', {httpStatus: steerRes.status, resp: steerRes.json})
    }
    const out = await p
    const ackHard = acks.find(a => a.mode === 'hard')
    const doc = row ? await Message.findOne({messageCode: row.messageCode}, {progress: 1, extInfo: 1, answer: 1}).lean() : null
    const ok = out.terminal === 'done' && !!ackHard && ackHard.injectAt === 'immediate' && ackHard.abortCurrentStream === true
    results.hard = {
        ok, terminal: out.terminal,
        ackAt: ackHard ? {injectAt: ackHard.injectAt, abort: ackHard.abortCurrentStream} : null,
        deliverToAckMs: ackHard ? ackHard.seenAt - hardAt : null,
        finalProgress: doc?.progress, answerLen: (doc?.answer || '').length,
    }
    log('hard·判定', results.hard)
}

const pass = Object.values(results).filter(r => r.ok).length
const total = Object.keys(results).length
log('总结', {通过: `${pass}/${total}`, 明细: Object.keys(results).map(k => `${k}:${results[k].ok ? '✅' : '❌'}`)})
fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/control-e2e-result.jsonl', LINES.join('\n') + '\n')
process.exit(pass === total ? 0 : 1)
