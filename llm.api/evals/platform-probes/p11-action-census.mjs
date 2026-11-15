/**
 * @fileOverview P-11/§13 前置：dev 真实工具调用的**动作分布普查**（门那刀的样本面仪器）
 * @module evals/platform-probes/p11-action-census
 * @description
 * PR-I（D18 四层门）开工前有两个问题只能用真实流量回答，不能用想象回答：
 *   1. **门的暴露面到底多大**：§13 验收 15 说"文件写/save_artifact/产物上传的拦截率要与 shell 同级"——
 *      这些路径在真实流量里各占多少？shell(run_code) 占比是多少？规则层(D18 第 1 层)的 allow/deny
 *      词表要覆盖哪些动词族？没有这份分布，规则表是拍脑袋。
 *   2. **P-11 的样本集**：分类器成本/延迟要"200 条真实工具调用样本"——本普查就是样本源的
 *      第一版读数（样本文件落 temp，含入参正文的字段**一个不落盘**，只留动作名/长度/动词族）。
 * 纪律（h1-args-probe 同族）：
 *   - 只读档案（dev mongo 直连，init.js 载凭据，不落文件不打印）；
 *   - **不打印/不存储入参正文**——动词族用固定词表匹配（rm/curl/write...），匹配不到归 other，
 *     绝不回显原文；长度只用 argsChars/直算。
 * 用法（src/ 下）：node evals/platform-probes/p11-action-census.mjs [--days=7] [--limit=800]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const DAYS = Number(val('days', '7'))
const LIMIT = Number(val('limit', '800'))

await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/init.js')
const {Message} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/daos/core/schema/index.js')

const since = new Date(Date.now() - DAYS * 86400000)
/**
 * 排除合成流量（普查的有效性判据）：名单的权威在 evals/gate/sampleCorpus（单源，
 * 本件与 classifier-cost 都是它的消费者）；排除数进报告，名单过旧会以数字显形。
 */
const {isSynthetic} = await import('../gate/sampleCorpus.mjs')
const rows0 = await Message.find({
    insertTime: {$gte: since},
    progress: 'finish',
    'extInfo.toolCalls.0': {$exists: true},
}, {'extInfo.toolCalls': 1, conversationCode: 1, insertTime: 1}).sort({insertTime: -1}).limit(LIMIT).lean()
const rows = rows0.filter((r) => !isSynthetic(r.conversationCode))
const excluded = rows0.length - rows.length

/**
 * 动作 → 门暴露面归类与动词族：**从判据层 import（execGate.js）**——
 * 词表的权威住判据家，普查是它的第一个消费者；两处各存一份就是分家的开始。
 */
const {GATE_SURFACES: SURFACE, VERB_FAMILIES} = await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/services/core/session/execGate.js')

const tally = {}
const verbTally = {}
let calls = 0
let argsPresent = 0
const charsLens = []
const storedLens = []
const unknownTools = new Set()
for (const r of rows) {
    for (const tc of r.extInfo?.toolCalls || []) {
        calls++
        const name = tc.name || '?'
        const surface = SURFACE[name] || 'unknown'
        if (surface === 'unknown') {
            unknownTools.add(name)
        }
        tally[surface] = (tally[surface] || 0) + 1
        const raw = tc.args ?? tc.arguments
        const argText = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '')
        if (argText) {
            argsPresent++
            // 两套口径分开统计（"p15 双口径"同族教训）：argsChars=截断后计数，text.length=实际存档长
            // 混进一个分布里，5988>limits.toolArgsChars=4000 这种数会伪装成"预算没生效"
            if (Number.isFinite(Number(tc.argsChars))) {
                charsLens.push(Number(tc.argsChars))
            }
            storedLens.push(argText.length)
        }
        if (name === 'run_code') {
            for (const [fam, re] of VERB_FAMILIES) {
                if (re.test(argText)) {
                    verbTally[fam] = (verbTally[fam] || 0) + 1
                }
            }
        }
    }
}
const pct = (n) => `${(100 * n / (calls || 1)).toFixed(1)}%`
const sorter = (a) => a.sort((x, y) => x - y)
sorter(charsLens); sorter(storedLens)
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0)
const report = {
    probe: 'p11-action-census',
    window: `近${DAYS}天`,
    会话数: rows.length,
    合成流量排除数: excluded,
    调用数: calls,
    入参落档率: `${argsPresent}/${calls}（H1 后的校准位）`,
    入参长度双口径: {
        argsChars_截断后: {p50: q(charsLens, 0.5), p90: q(charsLens, 0.9), p99: q(charsLens, 0.99)},
        存档文本长: {p50: q(storedLens, 0.5), p90: q(storedLens, 0.9), max: storedLens[storedLens.length - 1] || 0},
    },
    门暴露面: Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, `${n} (${pct(n)})`])),
    run_code动词族: verbTally,
    未识别工具: [...unknownTools],
    判读: {
        '§13-分母': `文件/产物路径(artifact-upload+file-write动词族)相对 shell 的量级——拦截率验收的两侧样本量都从这里取`,
        'P-11': '分类器延迟/成本读数=选定小模型后再跑评测集（本普查给样本源与分布，不给延迟）',
        '规则层输入': 'D18 第 1 层的 allow/deny 词表按 门暴露面+动词族 设计，不拍脑袋',
    },
}
console.log(JSON.stringify(report, null, 1))
fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/p11-census.json', JSON.stringify(report, null, 1))
process.exit(0)
