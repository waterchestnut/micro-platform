/**
 * @fileOverview 遗弃 run 回填的**只读**计划视图
 * @module evals/platform-probes/backfill-plan-view
 * @description
 * 这个探针**不写任何东西**，只回答一个问题：如果现在跑回填，会动哪几条、每条会写成什么样。
 *
 * 为什么只提供读：写库的那条路只有一个入口——`cron/retention.js` 注册的
 * `tasks/abandonedBackfill.runBackfill`，而且需要两道开关（`cron_backfillEnabled` + `cron_backfillWrite`）。
 * 让脚本也能写，就会有第二个写入口与第二套依赖（dac 要 app 的 `llm` 全局与 mongoose 连接），
 * 而"计划"这层用的是**同一份纯判据**（`planBackfill`），所以读到的与定时任务将写的是同一件事。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/backfill-plan-view.mjs [--olderThanMs=600000] [--limit=200] [--out=路径]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {planBackfill, BACKFILL_MARKER} from '../../services/core/session/abandonedBackfill.js'
import {DEFAULT_OLDER_THAN_MS, abandonedQuery, validateOlderThan} from '../../daos/core/policy/llmUsagePolicy.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require2 = createRequire(path.join(SRC, 'noop.js'))
const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const OUT = val('out', '')
const olderThanMs = Number(val('olderThanMs', DEFAULT_OLDER_THAN_MS))
const limit = Number(val('limit', 200))

const LINES = []
/**
 * @description 自己落文件再打印（中文键名不能走 PowerShell `*>`）
 * @param {String} note 事件
 * @param {Object} obj 字段
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'backfill-plan', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

/** 阈值先过安全阀：小阈值会把正常在途判成损失，那比原缺陷更糟 */
const check = validateOlderThan(olderThanMs)
if (!check.ok) {
    log('拒绝启动', {原因: check.reason})
    process.exit(2)
}

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
let MongoClient
try {
    MongoClient = require2('mongodb').MongoClient
} catch (e) {
    log('拒绝启动', {原因: `依赖 mongodb 解析失败（${e.code}）`, 说明: '需要能连库的服务仓环境；这不是"没有遗弃行"'})
    process.exit(2)
}
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))

const rows = await db.collection('llmUsage').find(abandonedQuery({olderThanMs}), {
    projection: {_id: 0, messageCode: 1, conversationCode: 1, userCode: 1, progress: 1,
        updateTime: 1, modelCalls: 1, estPromptTokens: 1},
}).sort({updateTime: 1}).limit(limit).toArray()
const codes = rows.map(r => r.messageCode).filter(Boolean)
/** 已有档案的行绝不参与回填：这一条与 `planBackfill` 用的是同一个判据 */
const withArchive = codes.length
    ? new Set((await db.collection('message').find({messageCode: {$in: codes}}, {projection: {_id: 0, messageCode: 1}}).toArray()).map(x => x.messageCode))
    : new Set()
const cpRows = rows.length
    ? await db.collection('sessionCheckpoint').find({conversationCode: {$in: rows.map(r => r.conversationCode)}},
        {projection: {_id: 0, conversationCode: 1, seq: 1, phase: 1, messages: 1}}).sort({seq: 1}).toArray()
    : []
await client.close()

/** 每个会话取 seq 最大的一条检查点（与 service 里 `listByConversation` 的取法同口径） */
const latestCp = {}
for (const c of cpRows) {
    latestCp[c.conversationCode] = c
}

const plans = []
const skips = []
for (const row of rows) {
    const p = planBackfill({
        row,
        hasArchive: withArchive.has(row.messageCode),
        checkpoint: latestCp[row.conversationCode] || null,
        olderThanMs,
    })
    if (p.action === 'skip') {
        skips.push({messageCode: row.messageCode, reason: p.reason})
    } else {
        plans.push({
            messageCode: p.fields.messageCode,
            conversationCode: p.fields.conversationCode,
            问题字数: (p.fields.query || '').length,
            将写progress: p.fields.progress,
            interruptedBy: p.fields.extInfo.interruptedBy,
            recoveredBy: p.fields.extInfo.recoveredBy,
            估算输入: p.fields.extInfo.estPromptTokens,
        })
    }
}

log('读数', {
    扫到: rows.length,
    计划回填: plans.length,
    跳过: skips.length,
    计划样例: plans.slice(0, 12),
    跳过样例: skips.slice(0, 12),
    标记: BACKFILL_MARKER,
    心跳阈值ms: olderThanMs,
})
log('判读', {
    本探针不写库: true,
    写库入口: 'cron/retention.js → tasks/abandonedBackfill.runBackfill（需 cron_backfillEnabled=true 且 cron_backfillWrite=true）',
    结论: rows.length === 0
        ? '没有遗弃行。两种可能都要区分：真的没有损失，或者 `llmUsageLive` 被关（那会让这条查询恒空）'
            + ' ⇒ 看 `llmUsage` 里有没有 `processing` 以外的行可以佐证开关状态'
        : `计划回填 ${plans.length} 条、跳过 ${skips.length} 条；跳过原因分布：`
            + JSON.stringify(skips.reduce((a, x) => {
                a[x.reason] = (a[x.reason] || 0) + 1
                return a
            }, {})),
})
process.exit(0)
