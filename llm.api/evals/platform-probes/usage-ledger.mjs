/**
 * @fileOverview 自有账本读数：每 run 模型调用次数与每 run token 数（G-6 的交付物）
 * @module evals/platform-probes/usage-ledger
 * @description
 * G-6 的判据不是"埋了点"，而是**能出数**。这个脚本就是把 §14 的账本读成人看的分布：
 * - 每 run 模型调用次数：中位数 / P95 / 直方图 + 告警级 run 数（循环失控的早期症状先看中位数，早于成本）；
 * - 每 run token 数：主指标是**非缓存输入 token**（D41），命中率只作为旁证；
 * - `noUsageRuns`：没取到 usage 的 run 数——**账本自己的可信度**。
 *   这一项必须单独报：如果它很大，前面所有数字都是拿 0 冒充出来的，看板越好看越危险。
 *
 * 用法（在 `src/` 下，只读）：
 *   node evals/platform-probes/usage-ledger.mjs                       # 全表
 *   node evals/platform-probes/usage-ledger.mjs --day=2026-11-09      # 某一天
 *   node evals/platform-probes/usage-ledger.mjs --channel=xxzx_common --limit=50000
 *
 * 凭据不硬编码：mongo 连接串从 `conf/system.config.js` 的默认值解析（与 probe.mjs 同口径）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CFG = path.join(__dirname, '../../conf/system.config.js')
const cfgText = fs.readFileSync(CFG, 'utf8')

/**
 * @description 从配置文件源码里正则取一个字符串默认值（避免 import 配置文件把整套连接都建起来）
 * @param {RegExp} re 匹配 `process.env['x'] || '值'` 的正则
 * @param {String} dflt 兜底值
 * @returns {String} 取到的值
 */
function cfgDefault(re, dflt) {
    const m = re.exec(cfgText)
    return m ? m[1] : dflt
}

const argv = process.argv.slice(2)
const valOf = (n) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : undefined
}

const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
const authSource = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
const LIMIT = Number(valOf('limit') || 100000)

const match = {}
if (valOf('day')) {
    match.day = valOf('day')
}
if (valOf('channel')) {
    match.channel = valOf('channel')
}
if (valOf('user')) {
    match.userCode = valOf('user')
}

/**
 * @description 求有序数组的分位数
 * @param {Number[]} sorted 已升序排好的数组
 * @param {Number} q 分位（0..1）
 * @returns {Number|null} 分位值，空数组给 null
 */
function quantile(sorted, q) {
    if (!sorted.length) {
        return null
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

const client = await MongoClient.connect(
    uriBase.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`) + `/${dbName}?authSource=${authSource}`,
    {serverSelectionTimeoutMS: 12000, maxPoolSize: 4},
)
const coll = client.db(dbName).collection('llmUsage')
const log = (note, obj) => console.log(JSON.stringify({probe: 'usage-ledger', note, ...obj}))

const rows = await coll.find(match).limit(LIMIT).toArray()
log('范围', {match, 样本: rows.length, 集合: `${dbName}.llmUsage`})

if (!rows.length) {
    log('结论', {判定: '⚠️ 账本为空或条件太窄：G-6 尚未达成（要么先跑几轮对话落账，要么放宽 --day/--channel）'})
    await client.close()
    process.exit(0)
}

/**
 * 计数点与 usage 点是分开的两件事，所以要单独看它们的差：
 * `calls>0 且 hasUsage=false` = **确实打了请求但没拿到量**（典型是被打断），这部分是"花了钱但量不出来"；
 * `calls=0` 则说明计数点本身没跑到（装配阶段就抛了），是另一种故障。两者混在一起就没法归因。
 */
const unmeasured = rows.filter(r => (Number(r.modelCalls) || 0) > 0 && !r.hasUsage)
const zeroCalls = rows.filter(r => (Number(r.modelCalls) || 0) === 0)

const calls = rows.map(r => Number(r.modelCalls) || 0).sort((a, b) => a - b)
const withUsage = rows.filter(r => r.hasUsage)
const billable = withUsage.map(r => Number(r.billablePromptTokens) || 0).sort((a, b) => a - b)
const completion = withUsage.map(r => Number(r.completionTokens) || 0).sort((a, b) => a - b)
const promptSum = withUsage.reduce((n, r) => n + (Number(r.promptTokens) || 0), 0)
const cachedSum = withUsage.reduce((n, r) => n + (Number(r.cachedTokens) || 0), 0)
const buckets = new Map()
calls.forEach(c => buckets.set(c, (buckets.get(c) || 0) + 1))

log('每 run 模型调用次数', {
    样本: rows.length,
    中位数: quantile(calls, 0.5),
    p95: quantile(calls, 0.95),
    最大: calls[calls.length - 1],
    直方图: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c}次:${n}轮`),
    告警run数: rows.filter(r => r.callAlert && r.callAlert !== 'ok').length,
})

log('每 run token 数（主指标=非缓存输入，D41）', {
    有usage的run: withUsage.length,
    平均非缓存输入: withUsage.length ? Math.round(billable.reduce((a, b) => a + b, 0) / withUsage.length) : null,
    非缓存输入中位数: quantile(billable, 0.5),
    非缓存输入p95: quantile(billable, 0.95),
    平均输出: withUsage.length ? Math.round(completion.reduce((a, b) => a + b, 0) / withUsage.length) : null,
    输出中位数: quantile(completion, 0.5),
    缓存读入总量: cachedSum,
    输入总量: promptSum,
    缓存占比: promptSum ? `${(100 * cachedSum / promptSum).toFixed(1)}%` : 'n/a',
})

log('账本可信度', {
    未取到usage的run: rows.length - withUsage.length,
    占比: `${(100 * (rows.length - withUsage.length) / rows.length).toFixed(1)}%`,
    /** 这两类必须分开看：前者是"打了但量不到"（打断/断流），后者是"计数点没跑到"（装配阶段就抛了） */
    有调用但无usage: unmeasured.length,
    零调用行: zeroCalls.length,
    判定: rows.length - withUsage.length === 0
        ? '✅ usage 全覆盖，前面的数字可以直接进看板'
        : (unmeasured.length
            ? `⚠️ ${unmeasured.length} 行是"确实打了请求但没拿到 usage"（打断或断流），这些钱花了但没计量；另有 ${zeroCalls.length} 行连计数点都没跑到`
            : '⚠️ 有 run 没取到 usage：这些行是按 0 记账的，看板的"平均值"会被它们拉低'),
})

log('按退出方式分组', {
    分组: Object.entries(rows.reduce((acc, r) => {
        const k = r.loopExit || '(空)'
        acc[k] = acc[k] || {runs: 0, calls: 0, billable: 0}
        acc[k].runs++
        acc[k].calls += Number(r.modelCalls) || 0
        acc[k].billable += Number(r.billablePromptTokens) || 0
        return acc
    }, {})).map(([k, v]) => `${k}: ${v.runs}轮/共${v.calls}次调用/非缓存${v.billable}tok`),
})

await client.close()
process.exit(0)
