/**
 * @fileOverview 核对"被遗弃的 run 到底能救回什么"
 * @module evals/platform-probes/abandoned-recoverable-content
 * @description
 * §25 v1.34 里那条边界结论（"回填只能给出存在过+被中断+内容丢失，给不出正文"）
 * 必须由这条脚本支撑，而不是由我的一句话支撑——**我第一次把它当结论写进文档时并没有查过**。
 *
 * 查法：拿 `llmUsage` 里停在 `processing` 的行（v1.33 的判据），逐条看它的
 * `sessionCheckpoint` 阶段与是否携带 `answer`，再看 `message` 侧有没有行。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/abandoned-recoverable-content.mjs [--prefix=abandoned-check-]
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
/**
 * mongodb 解析不到就直接失败，不能让栈尾的 `MODULE_NOT_FOUND` 被读成"没有遗弃行"。
 * 这不是假想：底座仓（micro-platform）用 pnpm，`node_modules/mongodb` 没被链接出来，
 * 所有走 DB 的探针在那边都是这个死法（`abandoned-run-check.mjs` 同样）——
 * 差别只在于以前它报的是 Node 的栈，看不出是"环境缺件"还是"数据为空"。
 */
let MongoClient
try {
    MongoClient = require2('mongodb').MongoClient
} catch (e) {
    console.error(`[abandoned-content] 依赖 mongodb 解析失败（${e.code}），本探针需要能连库的服务仓环境；底座 pnpm 未链接该包时请回到服务仓跑`)
    process.exit(2)
}
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
/**
 * 输出自己落文件（`--out=`），理由同 consumer-ping-tolerance：PowerShell `*>` 会把
 * 中文键名转烂，读回来的 JSON.parse 失败会被误读成"没有结论"。
 */
const ARGS = process.argv.slice(2)
const OUT = (ARGS.find(a => a.startsWith('--out=')) || '').slice('--out='.length)
const LINES = []
const log = (note, obj) => {
    const line = JSON.stringify({probe: 'abandoned-content', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

/** 位置/前缀参数都要跳过 -- 开头的项，否则 --out 会被当成扫描条件 */
const prefix = (ARGS.find(a => a.startsWith('--prefix=')) || '').split('=').slice(1).join('')
const filter = prefix ? {progress: 'processing', conversationCode: {$regex: `^${prefix}`}} : {progress: 'processing'}

const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api'))

const stuck = await db.collection('llmUsage').find(filter, {
    projection: {_id: 0, conversationCode: 1, messageCode: 1, modelCalls: 1, upstreamAttempts: 1, estPromptTokens: 1, insertTime: 1, updateTime: 1},
}).sort({insertTime: -1}).limit(20).toArray()

const report = []
for (const r of stuck) {
    /** 检查点里有没有正文，是"能不能救回回答"的唯一依据（projection 里用聚合表达式算长度，不取正文本身） */
    const cps = await db.collection('sessionCheckpoint').find(
        {conversationCode: r.conversationCode},
        {projection: {
            _id: 0, phase: 1, seq: 1,
            answerChars: {$strLenCP: {$ifNull: ['$answer', '']}},
            messageCount: {$size: {$ifNull: ['$messages', []]}},
        }},
    ).sort({seq: 1}).toArray()
    const msgCount = await db.collection('message').countDocuments({conversationCode: r.conversationCode})
    report.push({
        会话: r.conversationCode,
        账本: {发起: r.modelCalls, attempts: r.upstreamAttempts, 估算输入: r.estPromptTokens || 0},
        阶段: cps.map(c => `${c.phase}:${c.answerChars}字`),
        有正文可救: cps.some(c => (c.answerChars || 0) > 0),
        /** 问题本身在 messages 里 ⇒ 回填行至少能显示"你当时问了什么" */
        有问题可救: cps.some(c => (c.messageCount || 0) > 0),
        message行数: msgCount,
    })
}
await client.close()

const 可救正文 = report.filter(x => x.有正文可救).length
const 可救问题 = report.filter(x => x.有问题可救).length
log('读数', {样本: report.length, 明细: report})
log('结论', {
    判定: report.length === 0
        ? '（没有遗弃行可查：要么确实没有损失，要么 `llmUsageLive` 被关了——后者会让这个查询恒空，别读成"没损失"）'
        : `正文可救回 ${可救正文}/${report.length}、问题可救回 ${可救问题}/${report.length}`
            + (可救正文 === 0
                ? ' ⇒ **回答内容救不回来**（检查点只落在阶段边界，生成中途没有快照）；'
                    + (可救问题 > 0 ? '但用户的问题在 `preCreate` 里，回填行至少能说清"当时问了什么、回答中断了"。' : '')
                : ' ⇒ v1.34 的"给不出正文"说法要按实际比例改写'),
    要救正文的前置: '需要流中周期性检查点（每 N 秒/每 M 字一段），那是新增的写放大，'
        + '应与 PR-B 段留存、PR-K 的预算一起算，不能为了这条单独加。',
})
process.exit(0)
