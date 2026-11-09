/**
 * @fileOverview 用真实消费端代码验证 `:ping` 会不会污染它的输出
 * @module evals/platform-probes/consumer-ping-tolerance
 * @description
 * D64 说"`:ping` 与 `id:` 读取侧安全：只有 SSE 框架层读 id，业务只认 `[DONE]`"——
 * 那句是**对 x-sdk 那几端核的**。而 `xxzx.thesis.api` 是**自己写解析器的消费方**
 * （`services/core/assist.js:93 collectSse`），它的注释还写着"非JSON分片按原样拼接"，
 * 这形状一听就有风险：如果 `:ping` 被当成"非 JSON 分片"拼进正文，
 * 学生看到的润色结果里就会夹进 `ping` 这种垃圾字符。
 *
 * 关键做法（不是复制一份逻辑来测）：
 *   把 thesis.api 源文件里那个函数**逐字抽出来执行**。
 *   复制一份再测，测的是我的抄写，不是它的代码。
 * 输入则用 llm.api **真实的序列化器**（`tools/sse.js serializeSSEEvent`）产出，
 * 保证帧的字节形状与服务端实际发出的一致（`:ping\n\n`，无 `data:` 行）。
 *
 * 用法（在 `src/` 下）：node evals/platform-probes/consumer-ping-tolerance.mjs [thesis.api 路径]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {serializeSSEEvent} from '../../tools/sse.js'

/**
 * 输出自己落文件（`--out=`）：PowerShell 的 `*>` 会把 UTF-8 按控制台代码页转一道，
 * 中文键名烂掉后 JSON.parse 全失败，"读不出结论"会被误读成"没有结论"。
 */
const FLAGS = process.argv.slice(2).filter(a => a.startsWith('--'))
const OUT = (FLAGS.find(a => a.startsWith('--out=')) || '').slice('--out='.length)
const LINES = []
const log = (note, obj) => {
    const line = JSON.stringify({probe: 'consumer-ping', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

/**
 * 消费方源文件。候选路径要同时覆盖两种仓内布局：
 *   源仓 src/evals/platform-probes → SRC 落在 <仓>/src，兄弟目录是 ../../xxzx.thesis.api
 *   底座 llm.api/evals/platform-probes → SRC 落在 <仓>/llm.api，兄弟要退三级再进 xxzx/
 * 只写一种的话，换仓跑就会 exit 2（装置没通电），比拿到错结论更难发现。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CANDIDATES = [
    process.argv.slice(2).find(a => !a.startsWith('--')),
    process.env.THESIS_ASSIST_PATH,
    path.resolve(SRC, '../../xxzx.thesis.api/src/services/core/assist.js'),
    path.resolve(SRC, '../../../xxzx/xxzx.thesis.api/src/services/core/assist.js'),
].filter(Boolean)

/**
 * @description 从源码里逐字抽出一个函数
 * @param {String} text 源文件内容
 * @param {String} head 函数开头（如 'function collectSse('）
 * @returns {String|null} 函数源码文本（按花括号配平取整段）
 */
function extractFn(text, head) {
    const start = text.indexOf(head)
    if (start < 0) {
        return null
    }
    let depth = 0
    let i = text.indexOf('{', start)
    for (; i < text.length; i++) {
        if (text[i] === '{') {
            depth++
        } else if (text[i] === '}') {
            depth--
            if (depth === 0) {
                return text.slice(start, i + 1)
            }
        }
    }
    return null
}

let picked = null
let srcText = ''
for (const p of CANDIDATES) {
    if (fs.existsSync(p)) {
        srcText = fs.readFileSync(p, 'utf8')
        picked = p
        break
    }
}
if (!picked) {
    log('结论', {判定: `❌ 找不到消费方源文件（试过 ${CANDIDATES.join(' | ')}）——**装置没通电，本次没有结论**`})
    process.exit(2)
}
const fnText = extractFn(srcText, 'function collectSse(')
if (!fnText) {
    log('结论', {判定: `❌ 在 ${picked} 里没抽到 collectSse：函数已改名或被删除，D64 那句"该端不读 progress"要重新核`})
    process.exit(2)
}
/* eslint-disable no-new-func */
const collectSse = new Function(`return (${fnText})`)()
log('装置通电', {文件: picked, 抽取字符数: fnText.length})

/* —— 输入全部由真实序列化器产出 —— */
/**
 * @description 造一条流
 * @param {Object} opts 选项
 * @returns {String} SSE 文本
 */
function buildStream({pings = 0, idlePings = true, terminal = 'done'} = {}) {
    let out = serializeSSEEvent({id: '1', event: 'meta', data: JSON.stringify({messageCode: 'm1', protocol: 2})})
    const contents = ['论文', '的', '方法学', '部分需要', '补充实验设计。']
    contents.forEach((c, i) => {
        out += serializeSSEEvent({id: String(i + 2), event: 'delta', data: JSON.stringify({role: 'assistant', content: c})})
        /** 生成中途的静默心跳：这正是消费方最容易被咬到的地方 */
        if (idlePings && i === 1 && pings > 0) {
            for (let k = 0; k < pings; k++) {
                out += serializeSSEEvent({comment: 'ping'})
            }
        }
    })
    if (terminal === 'done') {
        out += serializeSSEEvent({id: String(contents.length + 2), event: 'done', data: 'done'})
    } else if (terminal === 'abort') {
        out += serializeSSEEvent({id: '9', event: 'abort', data: 'aborted'})
    } else if (terminal === 'error') {
        out += serializeSSEEvent({id: '9', event: 'error', data: '上游炸了'})
    }
    return {out, expected: contents.join('')}
}

const results = []
for (const cfg of [
    {name: '无心跳', pings: 0, idlePings: false},
    {name: '心跳 1 帧', pings: 1},
    {name: '心跳 5 帧（长静默）', pings: 5},
    {name: '心跳 20 帧（极端）', pings: 20},
]) {
    const {out, expected} = buildStream(cfg)
    let got = null
    let err = ''
    try {
        got = collectSse(out)
    } catch (e) {
        err = String(e?.message || e)
    }
    results.push({
        场景: cfg.name,
        字节数: out.length,
        含ping帧: (out.match(/:ping\n/g) || []).length,
        输出: got,
        与正文一致: got === expected,
        混入垃圾: !!got && (/[a-z:]{2,}/.test(got.replace(/[^a-zA-Z:]/g, '')) ? /ping|delta|data|json|undefined/i.test(got) : false),
        抛错: err,
    })
}

/* 终止事件语义：error/abort 必须抛，不能静默当正文 */
const termRows = []
for (const terminal of ['done', 'abort', 'error']) {
    const {out} = buildStream({terminal})
    let got = '(未返回)'
    let threw = false
    try {
        got = collectSse(out)
    } catch (e) {
        threw = true
        got = `throw: ${String(e?.message || e).slice(0, 40)}`
    }
    termRows.push({event: terminal, threw, 结果: got})
}

const 正文全对 = results.every(r => r.与正文一致)
const 无垃圾 = results.every(r => !r.混入垃圾)
const abortError都抛 = termRows.filter(r => r.event !== 'done').every(r => r.threw)
log('读数', {results, 终止事件: termRows})
log('结论', {
    判定: 正文全对 && 无垃圾 && abortError都抛
        ? `✅ thesis.api 的真实 collectSse 在含 ${results.map(r => r.含ping帧).join('/')} 帧心跳的流上输出与正文逐字一致，`
            + '没有混入任何 ping/框架字符；error 与 abort 都按抛错处理 ⇒ D64 对这一端的判断成立，'
            + '且它是**用该端真实代码跑出来的**，不是我读了一遍就点头'
        : `❌ 需要立刻修：${results.filter(r => !r.与正文一致 || r.混入垃圾).map(r => `${r.场景}→"${r.输出}"`).join('；')}`,
    顺带确认: '它的解析器只取以 data: 开头的行，注释行 `:ping` 天然落不进去——但这条结论来自执行，不来自推理。',
})
process.exit(正文全对 && 无垃圾 && abortError都抛 ? 0 : 1)
