/**
 * @fileOverview artifact 开闸端到端探针（第四批的验证刀 + 对账 verify 的读数来源）
 * @module evals/platform-probes/artifact-e2e-probe
 * @description
 * 判据全从**流、档案、账本**读（家规：日志只作旁证）。链路与判据：
 *   L0 闸读数：一条小 query 后读档案 extInfo.tools——save_artifact 在位=开闸生效。
 *   L1 主链：引导 run_code 造带 MARKER 的文件 → save_artifact → read_artifact。
 *      判据：工具结果 success+artifactCode；账本行 state=ready、fileCode 非空、
 *      sizeBytes>0、sha256 是 hex64、读回结果含 MARKER（成对收口：存的=读的）。
 *   L2 verify 观测（**记录不判分**）：fileUrl 的形态（内网/公网）与可达性——
 *      §25 line 1796 欠的就是这个读数（存在性核验怎么写：HEAD？Range 0-0？服务端还是探针侧）。
 *      观测未定型前不冒充判据，读数回填对账 cron 那一刀。
 * 用法（src/ 下）：node evals/platform-probes/artifact-e2e-probe.mjs [--skip=main]
 * 退出码：0 通过；2 闸未生效（可重跑）；1 失败。
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
const headers = {'Content-Type': 'application/json', 'param-accessToken': TOKEN}

const LINES = []
const log = (note, obj = {}) => {
    const line = JSON.stringify({probe: 'artifact-e2e', note, ...obj})
    LINES.push(line)
    console.log(line)
}

/** 打一条流收事件（同款于 control-e2e 的 streamCollect；参数化 query，长任务给足时限） */
async function streamCollect({query, conversationCode, timeoutMs = 300000, collectEvents = false}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {...headers, Accept: 'text/event-stream'},
        body: JSON.stringify({query, conversationCode, options: {channel: 'micro_common', protocol: 2, cache: false, memory: {enabled: false}}}),
        signal: controller.signal,
    })
    if (!(r.headers.get('content-type') || '').includes('text/event-stream')) {
        clearTimeout(timer)
        return {fatal: '非 SSE：' + (await r.text()).slice(0, 100), terminal: 'not-sse', eventNames: []}
    }
    const dec = new TextDecoder()
    let buf = ''
    let messageCode = ''
    let terminal = 'closed'
    const eventNames = new Set()
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
                if (collectEvents) {
                    eventNames.add(ev)
                }
                const raw = (/data:([\s\S]+)/.exec(t)?.[1] || '').replace(/\n/g, '')
                try {
                    const p = JSON.parse(raw)
                    if (p.messageCode && !messageCode) messageCode = p.messageCode
                } catch { /* 非 JSON 帧 */ }
                if (ev === 'done' || ev === 'abort' || ev === 'error') {
                    terminal = ev
                    break
                }
            }
            if (terminal !== 'closed') break
        }
    } finally {
        clearTimeout(timer)
    }
    return {messageCode, terminal, eventNames: [...eventNames]}
}

await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/init.js')
const {Message, Artifact} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/daos/core/schema/index.js')

const results = {}

// —— L0 闸读数 ——
{
    const conv = `art-e2e-gate-${Date.now()}`
    const out = await streamCollect({query: '1+1等于几？只给数字。', conversationCode: conv})
    const doc = out.messageCode ? await Message.findOne({messageCode: out.messageCode}, {'extInfo.tools': 1}).lean() : null
    const names = (doc?.extInfo?.tools || []).map((x) => x.function?.name)
    const on = names.includes('save_artifact') && names.includes('read_artifact')
    results.gate = {on, has: names.filter((n) => /artifact/.test(n))}
    log('L0 闸读数', results.gate)
    if (!on) {
        log('判定', {结论: 'artifact 闸未生效（tools 面没有 save/read_artifact），先铺管再跑或等构建', 通过: false})
        fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/artifact-e2e-result.jsonl', LINES.join('\n') + '\n')
        process.exit(2)
    }
}

// —— L1 主链 ——
if (!SKIP.has('main')) {
    const MARKER = `ART-${Date.now().toString(36)}`
    const conv = `art-e2e-main-${Date.now()}`
    const out = await streamCollect({
        conversationCode: conv,
        timeoutMs: 420000,
        collectEvents: true,
        query: `严格按步骤执行，不用其它工具：\n1) 用 run_code 执行 python，把约 40 行的文本写入 /workspace/probe.md，第二行必须是 MARKER=${MARKER}；\n2) 用 save_artifact 保存 /workspace/probe.md（name=probe.md）；\n3) 用 read_artifact 读取第 2 步登记的产物前 200 字符并复述；\n4) 最后一行输出 DONE。`,
    })
    if (out.fatal) {
        log('L1 失败', {fatal: out.fatal})
        process.exit(1)
    }
    const doc = await Message.findOne({messageCode: out.messageCode}, {progress: 1, extInfo: 1, answer: 1}).lean()
    const tcs = doc?.extInfo?.toolCalls || []
    const findTc = (n) => tcs.find((tc) => tc.name === n)
    const saveTc = findTc('save_artifact')
    const readTc = findTc('read_artifact')
    const saveResult = String(saveTc?.result || '')
    const readResult = String(readTc?.result || '')
    const artifactHit = /art-[0-9a-f-]+|[0-9a-f]{32}/.exec(saveResult)
    const rows = await Artifact.find({conversationCode: conv}).sort({insertTime: -1}).limit(3).lean()
    const row = rows[0] || null
    const ledgerOk = !!row && row.state === 'ready' && !!row.fileCode
        && Number(row.sizeBytes) > 0 && /^[0-9a-f]{64}$/.test(String(row.sha256 || ''))
    results.main = {
        ok: out.terminal === 'done' && saveResult.includes(String(artifactHit?.[0] || '§')) && saveResult.includes('artifactCode')
            && readResult.includes(MARKER) && ledgerOk,
        terminal: out.terminal,
        toolNames: tcs.map((tc) => tc.name),
        saveResultSample: saveResult.slice(0, 160),
        readHasMarker: readResult.includes(MARKER),
        ledger: row ? {state: row.state, fileCode: String(row.fileCode).slice(0, 10) + '…', sizeBytes: row.sizeBytes, integrity: row.integrity, sha256: String(row.sha256 || '').slice(0, 8) + '…'} : null,
        eventsHasArtifactReady: out.eventNames.includes('artifact_ready'),
        eventNames: out.eventNames,
    }
    log('L1 判定', results.main)

    // —— L2 verify 观测（记录不判分）——
    if (row?.fileUrl) {
        const u = String(row.fileUrl)
        const shape = {raw: u.slice(0, 30) + '…', host: /^https?:\/\/([^/]+)/.exec(u)?.[1] || '(解析失败)', isInternal: /^(http:\/\/(doc-api-http|localhost)|http:\/\/\d+\.)/.test(u)}
        const probeResults = {}
        // 探针侧只测"公网改写形态"：内网名本机不可达是事实不是缺陷——它决定 verify 必须在服务端做
        const publicUrl = shape.isInternal ? u.replace(/^https?:\/\/(doc-api-http|[^/]+)/, 'https://api.xxzx.paretop.net/doc') : u
        try {
            const rh = await fetch(publicUrl, {method: 'HEAD', headers: {'param-accessToken': TOKEN}})
            probeResults.head = {status: rh.status, ct: rh.headers.get('content-type'), len: rh.headers.get('content-length')}
        } catch (e) { probeResults.head = {error: e.message.slice(0, 80)} }
        try {
            const rg = await fetch(publicUrl, {method: 'GET', headers: {'param-accessToken': TOKEN, Range: 'bytes=0-0'}})
            probeResults.range00 = {status: rg.status, contentRange: rg.headers.get('content-range'), bodyLen: (await rg.arrayBuffer()).byteLength}
        } catch (e) { probeResults.range00 = {error: e.message.slice(0, 80)} }
        results.verifyObservation = {shape, probeResults}
        log('L2 verify 观测（不判分）', results.verifyObservation)
    } else {
        results.verifyObservation = {note: '账本行没有 fileUrl（上一判据已红）'}
    }
}

const pass = Object.values(results).filter((r) => r.ok !== undefined).every((r) => r.ok === true)
log('总结', {通过: pass, 明细: Object.keys(results).map((k) => `${k}:${results[k].ok === true ? '✅' : (results[k].ok === false ? '❌' : 'ℹ')}`)})
fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/artifact-e2e-result.jsonl', LINES.join('\n') + '\n')
process.exit(pass ? 0 : 1)
