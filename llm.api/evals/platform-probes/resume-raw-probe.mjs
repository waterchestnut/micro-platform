/**
 * @fileOverview 抓一段**真实的**断线 + 续接报文，给前端解码器做字节级对拍（只写自己的会话）
 * @module evals/platform-probes/resume-raw-probe
 * @description
 * 为什么需要它：前端 `xxzx.console` 的 SSE 解码器（`src/chatProviders/resume.ts`）是
 * **照着 `docs/api/chat-sse.md` 写的**，而"照着文档写"和"对着真实字节测过"是两件事——
 * 本周已经两次栽在测试替身比现实宽松上（假 redlock 的 `LockedError`、假库的 `MAXLEN ~`）。
 * 所以这里把一次真实的 `/core/chat/stream` + 断线 + `/core/chat/stream/resume` 的
 * **原始字节**打出来，前端把这份字节当成测试夹具再解一遍。
 *
 * 探针同时校验几条结构事实（这些就是解码器全部的假设）：
 * - 帧与帧之间以 `\n\n` 分隔；
 * - 行形状是 `field:value` 或 `field: value`（值前只有一个可选空格）；
 * - `:ping` 这类注释行**没有字段名**，不该被当成事件；
 * - `id:` 是十进制整数，且**跨两次连接仍然单调递增**（续接靠这个判重）；
 * - 续接**不重发** `id <= lastSeq` 的帧（否则前端会看到重复内容）。
 *
 * 用法（在 pod 里跑，走本机的 12008；鉴权用集群内惯用的 `user-info`，不含任何明文秘钥）：
 *   node evals/platform-probes/resume-raw-probe.mjs [--port=12008] [--frames=3] [--out=/tmp/resume-raw.json]
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
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PORT = val('port', '12008')
const FRAMES = Number(val('frames', 3))
const OUT = val('out', '')
const BASE = `http://127.0.0.1:${PORT}`
const RUN = (globalThis.crypto?.randomUUID?.() || String(Date.now())).replace(/-/g, '')
const CONV = `probe-resume-${RUN}`
const MESSAGE_CODE = `mc-${RUN}`
/** 探针自己的身份：与既有探针同一套集群内 user-info 约定，只影响自己新建的会话 */
const USER_INFO = Buffer.from(JSON.stringify({userCode: `resume-probe-${RUN}`, realName: '续接探针'})).toString('base64')

const out = {messageCode: MESSAGE_CODE, conversationCode: CONV}

/**
 * @description 打印并落盘
 * @param {Object} obj 内容
 * @returns {void}
 */
function emit(obj) {
    Object.assign(out, obj)
    const s = JSON.stringify(out, null, 1)
    console.log(s)
    if (OUT) {
        fs.writeFileSync(OUT, s)
    }
}

/**
 * @description 把一段 SSE 文本拆成"帧 + 每帧的字段"，供结构校验
 * @param {String} raw 原始文本
 * @returns {Array<Object>} 帧列表
 */
function parseFrames(raw) {
    return String(raw).split('\n\n').filter((b) => b !== '').map((block) => {
        const fields = {}
        let comment = false
        let malformed = []
        for (const line of block.split('\n')) {
            if (!line) {
                continue
            }
            if (line.startsWith(':')) {
                comment = true
                continue
            }
            const i = line.indexOf(':')
            if (i === -1) {
                malformed.push(line)
                continue
            }
            const f = line.slice(0, i)
            let v = line.slice(i + 1)
            if (v.startsWith(' ')) {
                v = v.slice(1)
            }
            fields[f] = f in fields ? `${fields[f]}\n${v}` : v
        }
        return {fields, commentOnly: comment && !Object.keys(fields).length, malformed}
    })
}

/**
 * @description 读流直到满足条件后主动掐断（模拟断线）
 * @param {Object} p 参数
 * @returns {Promise<Object>} 读数
 */
async function readUntil(p) {
    const ac = new AbortController()
    const t0 = Date.now()
    let raw = ''
    let ids = []
    let aborted = false
    try {
        const resp = await fetch(p.url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': USER_INFO},
            body: JSON.stringify(p.body),
            signal: ac.signal,
        })
        const headers = {}
        for (const k of ['content-type', 'x-run-last-seq', 'x-run-final', 'x-run-source']) {
            const v = resp.headers.get(k)
            if (v !== null) {
                headers[k] = v
            }
        }
        if (!resp.ok || !(resp.headers.get('content-type') || '').includes('text/event-stream')) {
            let body = null
            try {
                body = await resp.json()
            } catch (e) {
                body = null
            }
            return {http: resp.status, headers, body, raw: '', ids: [], aborted: false, nonStream: true}
        }
        const reader = resp.body.getReader()
        const dec = new TextDecoder('utf-8')
        for (;;) {
            const {value, done} = await reader.read()
            if (done) {
                break
            }
            raw += dec.decode(value, {stream: true})
            ids = parseFrames(raw).map((f) => f.fields.id).filter((x) => x !== undefined)
            const sawTerminal = /\nevent:(?: |)(done|abort|error)\n/.test(`\n${raw}`)
            if (p.stopAfter && ids.length >= p.stopAfter && !sawTerminal) {
                aborted = true
                ac.abort()
                break
            }
            if (sawTerminal || Date.now() - t0 > (p.timeoutMs || 90000)) {
                break
            }
        }
    } catch (e) {
        if (!aborted) {
            out.readError = String(e?.message || e).slice(0, 160)
        }
    }
    return {http: 200, headers: {}, raw, ids, aborted, nonStream: false}
}

emit({阶段: '开始', 说明: `先打 protocol:3 的流，收到 ${FRAMES} 帧后掐断，再用 /resume 续`})

/** 第一段：正常流，读到第 N 帧后主动断 */
const first = await readUntil({
    url: `${BASE}/core/chat/stream`,
    body: {
        query: `续接报文探针 ${RUN}：请用两三句话介绍杭州`,
        conversationCode: CONV,
        options: {channel: 'micro_common', protocol: 3, cache: false, messageCode: MESSAGE_CODE},
    },
    stopAfter: FRAMES,
    timeoutMs: 90000,
})
const firstFrames = parseFrames(first.raw)
const firstIds = firstFrames.map((f) => f.fields.id).filter((x) => x !== undefined).map(Number)
const lastSeq = firstIds.length ? Math.max(...firstIds) : 0

/** 第二段：断线后用 /resume 续 */
const second = await readUntil({
    url: `${BASE}/core/chat/stream/resume`,
    body: {messageCode: MESSAGE_CODE, lastSeq},
    timeoutMs: 120000,
})
const secondFrames = parseFrames(second.raw)
const secondIds = secondFrames.map((f) => f.fields.id).filter((x) => x !== undefined).map(Number)

/** 第三段：故意给一个非法游标，确认服务端是 400 而不是"当作 0 从头重放" */
const bad = await readUntil({
    url: `${BASE}/core/chat/stream/resume`,
    body: {messageCode: MESSAGE_CODE, lastSeq: -1},
    timeoutMs: 20000,
})

const structural = {
    第一段帧数: firstFrames.length,
    第一段是否掐断: first.aborted,
    第二段帧数: secondFrames.length,
    第二段响应头: second.headers,
    第二段含终态事件: secondFrames.some((f) => ['done', 'abort', 'error'].includes(f.fields.event)),
    所有帧都用空行分隔: [first.raw, second.raw].every((r) => r.endsWith('\n\n') || r === ''),
    出现过的字段名: [...new Set([...firstFrames, ...secondFrames].flatMap((f) => Object.keys(f.fields)))].sort(),
    注释帧数量: [...firstFrames, ...secondFrames].filter((f) => f.commentOnly).length,
    畸形行数: [...firstFrames, ...secondFrames].reduce((a, f) => a + f.malformed.length, 0),
    id是否全为十进制整数: [...firstIds, ...secondIds].every((n) => Number.isInteger(n)),
    游标跨连接单调: secondIds.length === 0 || Math.min(...secondIds) > lastSeq,
    续接未重发旧帧: secondIds.every((n) => n > lastSeq),
    非法游标的处理: bad.nonStream ? {http: bad.http, code: bad.body?.code ?? null} : {意外拿到了流: true},
}

emit({
    阶段: '完成',
    结构校验: structural,
    第一段原始报文: first.raw,
    续接原始报文: second.raw,
    用法提示: '把"续接原始报文"当夹具喂给前端 decodeSseBlock/splitSseFrames，验证真实字节能被正确解码',
})
process.exit(structural.游标跨连接单调 && structural.id是否全为十进制整数 ? 0 : 1)
