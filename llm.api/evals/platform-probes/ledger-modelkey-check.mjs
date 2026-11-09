/**
 * @fileOverview 验证 v1.27 那句"账本记的真是花钱的那个模型"：非法 llmModel 落库应被归一
 * 用法：cd src && node evals/platform-probes/ledger-modelkey-check.mjs <conversationCode 前缀>
 * 只读。
 */
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const pick = (re, d) => (re.exec(cfgText) || [])[1] || d
const uri = pick(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = pick(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = pick(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yoprt123')
const dbName = pick(/mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
const prefix = process.argv[2] || 'llmmodel-dev'

const client = await MongoClient.connect(uri.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`), {
    serverSelectionTimeoutMS: 12000, maxPoolSize: 3,
})
const db = client.db(dbName)

const rows = await db.collection('llmUsage').find({conversationCode: {$regex: `^${prefix}`}},
    {projection: {_id: 0, conversationCode: 1, llmModel: 1, model: 1, provider: 1, hasUsage: 1, inputTokens: 1}}).toArray()
const msgs = await db.collection('message').find({conversationCode: {$regex: `^${prefix}`}},
    {projection: {_id: 0, conversationCode: 1, 'extInfo.usage.llmModel': 1, progress: 1}}).limit(5).toArray()

console.log(JSON.stringify({
    db: dbName,
    账本: rows,
    messageExtInfo: msgs,
    判定: rows.length === 0
        ? '❌ 没查到账本行（conversationCode 前缀不对，或这条链路压根没落库）'
        : (rows.every(r => /^relay_[a-z_]+_(pro|flash|low)$/.test(r.llmModel || ''))
            ? `✅ 全部 ${rows.length} 行记录的 llmModel 都是合法档位 key ⇒ 非法入参已被归一，账本与实况不再分家`
            : `❌ 有行记的是废值：${JSON.stringify(rows.filter(r => !/^relay_/.test(r.llmModel || '')).map(r => r.llmModel))}`),
}))
await client.close()
process.exit(0)
