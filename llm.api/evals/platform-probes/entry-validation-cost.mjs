/**
 * @fileOverview 把"入口验证"这几轮实验的花费从账本里数出来（不靠印象）
 * @module evals/platform-probes/entry-validation-cost
 * @description
 * 本轮为了答 P-10 发了 4 次滚动、若干条长流，其中**前三次覆盖不成立、白烧了 25 轮长生成**。
 * 这种花费必须能自证：数字只从 `llmUsage` 读，前缀就是探针自己写的 conversationCode。
 *
 * 用法（在 `src/` 下）：node evals/platform-probes/entry-validation-cost.mjs [--minutes=90] [--out=路径]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const MINUTES = Number(val('minutes', 90))
const OUT = val('out', '')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const uri = d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
    .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`)

const LINES = []
/**
 * @description 落文件并打印
 * @param {Object} obj 结果
 */
function emit(obj) {
    const line = JSON.stringify(obj, null, 1)
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n'))
    }
}

/**
 * 依赖缺失报成人话（理由同 inflight-survival-probe）：底座 pnpm 未链接 mongodb 时，
 * Node 的 MODULE_NOT_FOUND 栈容易被读成"查无数据"。
 */
let MongoClient
try {
    MongoClient = require2('mongodb').MongoClient
} catch (e) {
    console.error(JSON.stringify({probe: 'entry-cost', 原因: `依赖 mongodb 解析失败（${e.code}）`, 说明: '请在能连库的服务仓环境跑；这不是"没有花费记录"'}))
    process.exit(2)
}
const client = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))
const since = new Date(Date.now() - MINUTES * 60000)
const rows = await db.collection('llmUsage').find({
    conversationCode: {$regex: '^(p10-|isv-|sfx-|aab-|logcheck-)'},
    insertTime: {$gte: since},
}, {projection: {
    _id: 0, conversationCode: 1, progress: 1, modelCalls: 1, upstreamAttempts: 1,
    promptTokens: 1, completionTokens: 1, cachedTokens: 1, totalTokens: 1, estPromptTokens: 1,
    latencyMs: 1, llmModel: 1, insertTime: 1,
}}).sort({insertTime: 1}).toArray()
await client.close()

/**
 * @description 求和
 * @param {Array<Object>} xs 行
 * @param {String} k 字段
 * @returns {Number} 合计
 */
function sum(xs, k) {
    return xs.reduce((a, r) => a + (Number(r[k]) || 0), 0)
}
/**
 * @description 按会话前缀分组
 * @param {String} p 前缀
 * @returns {Array<Object>} 组
 */
function byPrefix(p) {
    return rows.filter(r => String(r.conversationCode).startsWith(p))
}
/**
 * @description 空桶时 `Math.min(...[])` 会得到 Infinity，那会被读成"墙钟无穷大"
 * @param {Array<Object>} xs 行
 * @returns {Object|null} {min,max} 或 null
 */
function rangeOf(xs) {
    if (!xs.length) {
        return null
    }
    const v = xs.map(r => r.latencyMs || 0)
    return {min: Math.min(...v), max: Math.max(...v)}
}
const g = {
    窗口分钟: MINUTES,
    rollout_drop_p10: (() => {
        const xs = byPrefix('p10-')
        return {
            行数: xs.length, 发起调用: sum(xs, 'modelCalls'), attempts: sum(xs, 'upstreamAttempts'),
            输入: sum(xs, 'promptTokens'), 缓存: sum(xs, 'cachedTokens'), 输出: sum(xs, 'completionTokens'),
            墙钟ms: rangeOf(xs),
            进度: [...new Set(xs.map(r => r.progress))],
        }
    })(),
    inflight_survival_isv: (() => {
        const xs = byPrefix('isv-')
        return {
            行数: xs.length, 发起调用: sum(xs, 'modelCalls'), attempts: sum(xs, 'upstreamAttempts'),
            输入: sum(xs, 'promptTokens'), 缓存: sum(xs, 'cachedTokens'), 输出: sum(xs, 'completionTokens'),
            墙钟ms: rangeOf(xs),
            进度: [...new Set(xs.map(r => r.progress))],
        }
    })(),
    forensics_sfx: (() => {
        const xs = byPrefix('sfx-')
        return {
            行数: xs.length, 发起调用: sum(xs, 'modelCalls'), 输出: sum(xs, 'completionTokens'),
            进度: [...new Set(xs.map(r => r.progress))],
        }
    })(),
    abort_archive_aab: (() => {
        const xs = byPrefix('aab-')
        return {
            行数: xs.length, 发起调用: sum(xs, 'modelCalls'), 输出: sum(xs, 'completionTokens'),
            /** 这一组是 PR-E0.5 的基线与验收：每条只跑到被掐断为止，字数应当远小于长文 */
            进度: [...new Set(xs.map(r => r.progress))],
        }
    })(),
    合计: {
        行数: rows.length, 发起调用: sum(rows, 'modelCalls'), attempts: sum(rows, 'upstreamAttempts'),
        输入: sum(rows, 'promptTokens'), 缓存: sum(rows, 'cachedTokens'), 输出: sum(rows, 'completionTokens'),
    },
    看不到的部分: '闸拒绝与 503 都不产生 llmUsage 行（没进应用就没花钱）⇒ 这个表是"花掉的钱"，不是"发出去多少请求"。'
        + '被挡的轮数要从探针输出数：本轮 p10 前缀里有 2 轮 200+JSON（闸）与 1 轮 503（网关窗口）。',
}
emit(g)
process.exit(0)
