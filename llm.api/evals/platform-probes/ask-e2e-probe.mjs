/**
 * @fileOverview ask_user//answer 端到端探针（开闸第二批的验证刀）
 * @module evals/platform-probes/ask-e2e-probe
 * @description
 * 判据从流与档案读（家规）。验证链：
 *   1. 引导模型调 ask_user ⇒ 流里出现 await_input（MRTR 形状四字段齐）；
 *   2. 挂起期间 /runStats 的 stopHandles>=1（把手表与并发闸解耦的设计判据——闸默认关着也能停/能答）；
 *   3. 连投两条 /answer（A 先 B 后，间隔 <1s）⇒ 两条都"已投递"（路由只承诺投递——如实）；
 *   4. 先到先得的**权威证据在档案**：extInfo.toolCalls 里 ask_user 的结果 content 必须含
 *      choice=A 且不含 B（run 侧 router 单点裁决，迟到的 B 不该进工具结果）；
 *   5. run 正常 done、progress=finish、answer 非空。
 * 挂起闸账的"占格"判据需要 limits_concurrentRuns>0 的窗口才能测——本探针只测 stopHandles
 * 这一半（把手可用性），active 计数那一半如实留给开闸后的窗口，不假测。
 * 用法（src/ 下）：node evals/platform-probes/ask-e2e-probe.mjs
 */
import fs from 'node:fs'

const BASE = process.env.PROBE_BASE || 'https://api.xxzx.paretop.net/llm'
let TOKEN = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
try { TOKEN = decodeURIComponent(TOKEN) } catch { /* 已解码 */ }
const headers = {'Content-Type': 'application/json', 'param-accessToken': TOKEN}

const LINES = []
const log = (note, obj = {}) => {
    const line = JSON.stringify({probe: 'ask-e2e', note, ...obj})
    LINES.push(line)
    console.log(line)
}

/** 打一条流，挂起期靠 onEvent 回调里做投递动作 */
async function streamWithHook({query, conversationCode, onAwaitInput}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 240000)
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {...headers, Accept: 'text/event-stream'},
        body: JSON.stringify({query, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false, memory: {enabled: false}}}),
        signal: controller.signal,
    })
    if (!(r.headers.get('content-type') || '').includes('text/event-stream')) {
        clearTimeout(timer)
        return {fatal: '非 SSE：' + (await r.text()).slice(0, 100), terminal: 'not-sse', awaitPayloads: []}
    }
    const dec = new TextDecoder()
    let buf = ''
    let terminal = 'closed'
    let messageCode = ''
    const awaitPayloads = []
    let hookDone = Promise.resolve()
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
                try { parsed = JSON.parse(raw) } catch { /* */ }
                if (parsed?.messageCode && !messageCode) messageCode = parsed.messageCode
                if (ev === 'await_input' && parsed) {
                    awaitPayloads.push(parsed)
                    hookDone = onAwaitInput(parsed, messageCode)
                }
                if (ev === 'done' || ev === 'abort' || ev === 'error') { terminal = ev; break }
            }
            if (terminal !== 'closed') break
        }
    } finally {
        clearTimeout(timer)
    }
    await hookDone
    return {terminal, messageCode, awaitPayloads}
}

async function postJson(path, body) {
    const r = await fetch(`${BASE}${path}`, {method: 'POST', headers, body: JSON.stringify(body)})
    try { return JSON.parse(await r.text()) } catch { return {parseFail: true} }
}

await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/init.js')
const {Message} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/daos/core/schema/index.js')

const conv = `ask-e2e-${Date.now()}`
let probePick = ''
let probeLate = ''
log('发起（引导模型调 ask_user）')
let statsDuringPending = null
const out = await streamWithHook({
    query: '我想选一个主题色但拿不定主意，候选是 A(红色) 和 B(蓝色)。请务必调用 ask_user 工具问我选哪个（form 模式、字段名 choice、enum 就这两项），拿到我的答复后用一句话告诉我我选了什么。',
    conversationCode: conv,
    onAwaitInput: async (payload, mc) => {
        // 挂起期读数：把手表可用（不等并发闸——设计判据）
        statsDuringPending = await postJson('/core/chat/runStats', {})
        // 按出题侧真实 enum 作答（"原样回显"的正确语义——首版硬答 'A' 被 router 权威校验
        // 正当拒绝，run 继续挂起：这是 e2e 抓到的第一个真教训，判分要按题作答）
        const form = (payload.inputRequests || []).find((r) => r.mode === 'form')
        const props = form?.requestedSchema?.properties || {}
        const key = Object.keys(props)[0]
        const enumVals = Array.isArray(props[key]?.enum) ? props[key].enum : null
        const pick = enumVals ? enumVals[0] : 'A'
        const late = enumVals ? (enumVals[1] ?? 'B') : 'B'
        log('await_input 到达', {resultType: payload.resultType, hasRequests: Array.isArray(payload.inputRequests), hasState: !!payload.requestState, seq: payload.checkpointSeq, askedKey: key, enumVals})
        const rs = payload.requestState
        // 连投两条：先选后弃（先到者应成为档案里的权威结果）
        const a1 = await postJson('/core/chat/answer', {requestState: rs, inputResponses: {[key]: pick}})
        const a2 = await postJson('/core/chat/answer', {requestState: rs, inputResponses: {[key]: late}})
        log('两条 /answer 投递', {first: a1.code ?? a1.success, second: a2.code ?? a2.success, picked: String(pick).slice(0, 12), late: String(late).slice(0, 12)})
        probePick = String(pick)
        probeLate = String(late)
    },
})

if (out.fatal) { log('失败', {fatal: out.fatal}); process.exit(1) }

const doc = out.messageCode ? await Message.findOne({messageCode: out.messageCode}, {progress: 1, answer: 1, extInfo: 1}).lean() : null
const askCall = (doc?.extInfo?.toolCalls || []).find((tc) => tc.name === 'ask_user')
const askResult = String(askCall?.result || '')
const pickedA = !!probePick && askResult.includes(probePick)
const leakedB = !!probeLate && askResult.includes(probeLate)

const checks = {
    awaitInputShape: out.awaitPayloads.length >= 1 && out.awaitPayloads[0].resultType === 'input_required' && !!out.awaitPayloads[0].requestState,
    handleDuringPending: (statsDuringPending?.data?.stopHandles ?? statsDuringPending?.stopHandles ?? 0) >= 1,
    terminalDone: out.terminal === 'done',
    toolResultHasA: pickedA,
    toolResultNoLateB: !leakedB,
    archiveFinish: doc?.progress === 'finish' && String(doc?.answer || '').length > 0,
}
const pass = Object.values(checks).filter(Boolean).length
log('判定', {通过: `${pass}/${Object.keys(checks).length}`, checks, askResultSample: askResult.slice(0, 90)})
fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/ask-e2e-result.jsonl', LINES.join('\n') + '\n')
process.exit(pass === Object.keys(checks).length ? 0 : 1)
