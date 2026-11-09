/**
 * @fileOverview 扫描"被遗弃的 run"：发版到底丢了几轮，第一次可以从数据里回答
 * @module evals/platform-probes/scan-abandoned-runs
 * @description
 * 这条能力是 v1.33 才存在的。之前我回答这个问题只能靠翻探针日志，
 * 而且**翻错了两回**（一次漏计最关键的对照、一次把真蒸发全划成仪器故障）——
 * 原因不在我手抖，在于蒸发的 run 在 `llmUsage` 与 `message` 里都不存在，
 * 数据上就没有可以查的东西。
 *
 * 现在开局落账 + 在途刷新会留下 `progress:'processing'` 的行，本脚本读它。
 * 判据不在这里重写：**复用 `llmUsagePolicy`**，与 dac、与测试同一份规则。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/scan-abandoned-runs.mjs [--olderThanMs=600000] [--limit=50]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')
/**
 * 判据直接 import：不用 require 去拿 ESM 模块（部分 Node 版本会抛 ERR_REQUIRE_ESM，
 * 这个脚本没理由依赖那种兼容性）。
 * 复用同一份 policy 是刻意的：这里若自己写一遍 cutoff 条件，
 * 就与 dac、与测试变成三套规则，边界漂移时只有线上会知道。
 */
import {abandonedQuery, DEFAULT_OLDER_THAN_MS, validateOlderThan} from '../../daos/core/policy/llmUsagePolicy.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)

/**
 * @description 取 `--name=value`
 * @param {String} n 名
 * @param {String} d 默认
 * @returns {String} 值
 */
function val(n, d) {
    const hit = argv.find(a => a.startsWith('--' + n + '='))
    return hit ? hit.substring(n.length + 3) : d
}

const olderThanMs = Number(val('olderThanMs', String(DEFAULT_OLDER_THAN_MS)))
const limit = Number(val('limit', '50'))
const log = (note, obj) => console.log(JSON.stringify({probe: 'scan-abandoned', note, ...obj}))

/**
 * 阈值先过一遍安全校验：**调太小会把正常在途的长生成当成损失**，
 * 那比查不到更糟——它会把"发版丢了几轮"这个问题污染成一堆假阳性。
 */
const check = validateOlderThan(olderThanMs)
if (!check.ok) {
    log('拒绝执行', {olderThanMs, 原因: check.reason, 提示: '这个阈值会把正常 run 误判成损失'})
    process.exit(2)
}

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const dbName = d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
const db = client.db(dbName)

const rows = await db.collection('llmUsage').find(abandonedQuery({olderThanMs}))
    .sort({updateTime: -1})
    .limit(limit)
    .toArray()

/** 交叉核对：这些行的 message 侧到底有没有行 */
const codes = rows.map(r => r.conversationCode)
const msgs = codes.length ? await db.collection('message').find(
    {conversationCode: {$in: codes}},
    {projection: {_id: 0, conversationCode: 1, progress: 1}},
).toArray() : []
const msgByCode = new Map(msgs.map(m => [m.conversationCode, m.progress]))
await client.close()

const 明细 = rows.map(r => ({
    messageCode: r.messageCode,
    userCode: r.userCode,
    channel: r.channel,
    llmModel: r.llmModel,
    发起次数: r.upstreamAttempts ?? r.modelCalls,
    重试: r.upstreamRetried || 0,
    换档到: r.fallbackTo || '',
    已花非缓存输入tok: r.billablePromptTokens || 0,
    估算输入tok_在途写入: r.estPromptTokens || 0,
    已花输出tok: r.completionTokens || 0,
    最后心跳: r.updateTime,
    开局: r.insertTime,
    /** 在途时长不可知（硬杀不补最后一笔），这里只给"已静默多久" */
    已静默分钟: Number(((Date.now() - new Date(r.updateTime).getTime()) / 60000).toFixed(1)),
    message侧: msgByCode.get(r.conversationCode) ?? '(无行)',
}))

log('读数', {
    阈值ms: olderThanMs,
    遗弃行数: rows.length,
    其中有message行: 明细.filter(m => m.message侧 !== '(无行)').length,
    合计已花非缓存输入tok: rows.reduce((s, r) => s + (r.billablePromptTokens || 0), 0),
    /** 遗弃行普遍没有 usage，所以这里同时报估算合计：真实花费落在估算与实测之间 */
    合计估算输入tok: rows.reduce((s, r) => s + (r.estPromptTokens || 0), 0),
    合计已花输出tok: rows.reduce((s, r) => s + (r.completionTokens || 0), 0),
    明细: 明细.slice(0, 20),
})
log('结论', {
    判定: rows.length
        ? `⚠️ 有 ${rows.length} 轮停在 processing 且已静默超过 ${olderThanMs / 60000} 分钟`
            + `（其中 ${明细.filter(m => m.message侧 === '(无行)').length} 轮连档案都没有）⇒ 这些就是发版/崩溃吃掉的钱`
        : `✅ 没有超过 ${olderThanMs / 60000} 分钟仍停在 processing 的行`,
    口径边界: '这行只说明"最后心跳之后没再动过"，不说明它精确死于何时——硬杀不会补写最后一笔。'
        + '要拿到在途时长得加周期性心跳，那是写放大与可观测的另一个取舍（见 llmChat 的在途刷新注释）。',
    能力对照: 'v1.33 之前这个问题只能翻探针日志数，而且我数错过两回：数据里根本没有可查的东西。',
})
process.exit(0)
