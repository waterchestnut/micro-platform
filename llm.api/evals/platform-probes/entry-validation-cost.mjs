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
    promptTokens: 1, completionTokens: 1, cachedTokens: 1, totalTokens: 1,
    estPromptTokens: 1, estCompletionTokens: 1, latencyMs: 1, llmModel: 1, insertTime: 1,
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
/**
 * @description 一个前缀归成一个桶（口径四处共用，避免每处各写一遍算式）
 * @param {String} name 展示名
 * @param {String} p conversationCode 前缀
 * @returns {Object} 桶
 */
function bucket(name, p) {
    const xs = byPrefix(p)
    return {
        名称: name,
        行数: xs.length,
        发起调用: sum(xs, 'modelCalls'),
        attempts: sum(xs, 'upstreamAttempts'),
        输入: sum(xs, 'promptTokens'),
        缓存: sum(xs, 'cachedTokens'),
        输出: sum(xs, 'completionTokens'),
        估算输入: sum(xs, 'estPromptTokens'),
        /** 新列：被掐断的 run 唯一的输出量级来源（`completionTokens` 在那种情况下恒 0） */
        估算输出: sum(xs, 'estCompletionTokens'),
        墙钟ms: rangeOf(xs),
        进度: [...new Set(xs.map(r => r.progress))],
    }
}
const g = {
    窗口分钟: MINUTES,
    分桶: [
        bucket('rollout-drop（p10-）', 'p10-'),
        bucket('inflight-survival（isv-）', 'isv-'),
        bucket('shutdown-forensics（sfx-）', 'sfx-'),
        bucket('abort-archive（aab-）', 'aab-'),
    ],
    合计: {
        行数: rows.length, 发起调用: sum(rows, 'modelCalls'), attempts: sum(rows, 'upstreamAttempts'),
        输入: sum(rows, 'promptTokens'), 缓存: sum(rows, 'cachedTokens'), 输出: sum(rows, 'completionTokens'),
        估算输入: sum(rows, 'estPromptTokens'), 估算输出: sum(rows, 'estCompletionTokens'),
    },
    /**
     * 这一节是本轮新看到的缺口：`输出` 只算上游实测，`估算输出` 只算本地量到的正文。
     * 两者相差极大的行就是"花了钱但报表看不见"的行——**必须并排印出来**，
     * 只看其中任一列都会得出相反结论。
     */
    实测与估算的差: (() => {
        const cut = rows.filter(r => (r.completionTokens || 0) === 0 && (r.estCompletionTokens || 0) > 0)
        return {
            被低估的行数: cut.length,
            这些行的实测输出: 0,
            这些行的估算输出: cut.reduce((a, r) => a + (r.estCompletionTokens || 0), 0),
            判读: cut.length
                ? `有 ${cut.length} 行"上游没回传、本地量到了"⇒ 只报 completionTokens 会把这些损失记成零成本`
                : '（窗口内没有这种行：要么都被正常收尾，要么这些 run 早于 estCompletionTokens 列）',
        }
    })(),
    看不到的部分: '闸拒绝与 503 都不产生 llmUsage 行（没进应用就没花钱）⇒ 这个表是"花掉的钱"，不是"发出去多少请求"。'
        + '被挡的轮数要从探针输出数：§25 v1.37 那轮的 p10 前缀里有 2 轮 200+JSON（闸）与 1 轮 503（网关窗口）。',
}
emit(g)
process.exit(0)
