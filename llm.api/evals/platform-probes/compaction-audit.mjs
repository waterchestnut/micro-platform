/**
 * @fileOverview PR-K1 的前提测量：迭代内就地压缩到底发生过几次
 * @module evals/platform-probes/compaction-audit
 * @description
 * §2.20 把"每轮都调 `compactToBudget`"写成了"每轮都重写历史前缀"，并据此给 PR-K1 定了 2 人日。
 * 但 `assemble.js:189-191` 里这个函数在 `total <= budget` 时**直接返回、一条消息都不改**——
 * 也就是说"重写"只在真的越界时才发生。这条脚本量的是**越界到底有多少**：
 *
 * - 如果越界极少，PR-K1 的收益就不是"缓存/前缀稳定性"，而只是"每轮一次全量 tokenizer 的 CPU"，
 *   那一刀该缩小：改成增量测量 + 越界才压，而不是重做压缩架构；
 * - 如果越界常见，才谈得上按 §5.3 做 T1 只追加化。
 *
 * 用法（在 `src/` 下，只读）：
 *   node evals/platform-probes/compaction-audit.mjs [--limit=20000]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')

/**
 * @description 从 system.config.js 的源码文本里取一个配置值（避免真的 import 配置文件去建连接）
 * @param {RegExp} re 匹配单引号内字面量的正则
 * @param {String} dflt 取不到时的默认值
 * @returns {String} 配置值
 */
function cfgDefault(re, dflt) {
    const m = re.exec(cfgText)
    return m ? m[1] : dflt
}

const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
const authSource = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')

const limitIdx = process.argv.findIndex(a => a.startsWith('--limit='))
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx].split('=')[1]) : 20000

/**
 * @description 拼出带凭据的 mongo 连接串（与 probe.mjs 同口径：凭据来自 system.config.js 默认值，不写死在这里）
 * @returns {String} 连接串
 */
function buildUri() {
    /** uriBase 形如 mongodb://host:port —— 只剥协议头，凭据与库名按配置项补全 */
    const hosts = uriBase.replace(/^mongodb:\/\//, '')
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hosts}/${dbName}?authSource=${authSource}`
}

const client = await MongoClient.connect(buildUri(), {serverSelectionTimeoutMS: 10000, maxPoolSize: 4})
const db = client.db(dbName)
const log = (t, o) => console.log(JSON.stringify({probe: 'compaction-audit', ...o}))

/**
 * @description 取一条 message 的上下文用量现场
 * @param {Object} doc message 文档
 * @returns {{total: Number, budget: Number, iterationCount: Number, dropped: Number}|null} 规范化后的数据，缺字段返回 null
 */
function pickUsage(doc) {
    const cu = doc?.extInfo?.contextUsage
    if (!cu || typeof cu.total !== 'number') {
        return null
    }
    return {
        total: cu.total,
        budget: Number(cu.budget),
        iterationCount: doc.extInfo?.iterationCount || 1,
        dropped: Number(cu.droppedCount || 0),
    }
}

const cur = db.collection('message').find(
    {'extInfo.contextUsage.total': {$exists: true}},
    {projection: {'extInfo.contextUsage': 1, 'extInfo.iterationCount': 1}}
).limit(LIMIT)

let n = 0, overBudget = 0, withDropped = 0, finiteBudget = 0, maxRatio = 0
let sumTotal = 0, sumIterations = 0, multiRound = 0, multiRoundOver = 0

for await (const doc of cur) {
    const u = pickUsage(doc)
    if (!u) {
        continue
    }
    n++
    sumTotal += u.total
    sumIterations += u.iterationCount
    if (u.iterationCount > 1) {
        multiRound++
    }
    if (Number.isFinite(u.budget)) {
        finiteBudget++
        const ratio = u.total / u.budget
        if (ratio > maxRatio) {
            maxRatio = ratio
        }
        if (u.total > u.budget) {
            overBudget++
            if (u.iterationCount > 1) {
                multiRoundOver++
            }
        }
    }
    if (u.dropped > 0) {
        withDropped++
    }
}

const pct = (x, d) => (d ? Number((100 * x / d).toFixed(2)) : null)
const fmt = (v) => (v === null ? 'n/a' : `${v.toFixed(2)}%`)
const overPct = pct(overBudget, finiteBudget)
log('迭代内就地压缩的实际触发率', {
    样本: n,
    有finite预算: finiteBudget,
    平均promptTokens: n ? Math.round(sumTotal / n) : 0,
    平均迭代轮次: n ? (sumIterations / n).toFixed(2) : 0,
    多轮迭代占比: fmt(pct(multiRound, n)),
    越界条数: overBudget,
    越界比率: fmt(overPct),
    多轮且越界: multiRoundOver,
    曾丢弃droppedCount大于0: withDropped,
    最大total比budget: `${(maxRatio * 100).toFixed(2)}%`,
    判定: overBudget === 0
        ? '✅ 越界 0 次 ⇒ compactToBudget 在样本里从未改写过任何消息：§2.20 的"每轮重写前缀"是**把"每轮调用"当成了"每轮改写"**，PR-K1 的前提需要更正'
        : (overPct <= 2
            ? `⚠️ 越界极少（${fmt(overPct)}）⇒ T1 只追加化的收益主要在"每轮全量 tokenize 的 CPU"与可预测性，不在缓存或前缀稳定`
            : `❗ 越界 ${fmt(overPct)} ⇒ §5.3 的 T1 只追加化确有必要`),
})
await client.close()
process.exit(0)
