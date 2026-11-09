/**
 * @fileOverview 找一个"P-9b 可用的 u2u 会话"：只读查询 dev 的 u2u 会话与成员
 * 用法：cd src && node evals/platform-probes/u2u-conversations-scan.mjs
 * 只读：不改任何数据，也不打印任何消息正文。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')

/**
 * @description 从配置源码取字符串默认值
 * @param {RegExp} re 正则
 * @param {String} d 默认值
 * @returns {String} 值
 */
function cfgDefault(re, d) {
    const m = re.exec(cfgText)
    return m ? m[1] : d
}

const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
const auth = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')

/** 可用凭据的账号前缀（sim/回归批次），只有这些才可能拿到 token */
const MINTABLE = /^(T-SIM-|S-SIM-|T-THESIS-REG|S-THESIS-REG)/

const client = await MongoClient.connect(
    uriBase.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`) + `/${dbName}?authSource=${auth}`,
    {serverSelectionTimeoutMS: 12000, maxPoolSize: 4},
)
/**
 * @description 取 u2u 会话的成员名单
 *   **故意只投影需要的两个字段**：标题里含真实姓名，不带出来是纪律；
 *   而且 mongo 不允许在包含投影里混排除字段——写 `title: 0` 会直接报 Location31254。
 * @param {Object} db mongo db 句柄
 * @param {Number} limit 条数上限
 * @returns {Promise<Object[]>} 会话与成员
 */
async function readU2uMembers(db, limit) {
    return await db.collection('conversation').find(
        {conversationType: 'u2u', status: {$ne: -1}},
        {projection: {_id: 0, conversationCode: 1, userCodes: 1}},
    ).limit(limit).toArray()
}

const rows = (await readU2uMembers(client.db(dbName), 200)).map(c => ({
    conversationCode: c.conversationCode,
    userCodes: c.userCodes || [],
    mintable: (c.userCodes || []).filter(u => MINTABLE.test(u)),
}))

console.log(JSON.stringify({
    u2u会话数: rows.length,
    含可mint成员: rows.filter(r => r.mintable.length).length,
    样例: rows.slice(0, 8),
    建议: rows.find(r => r.mintable.length)
        ? `用 ${rows.find(r => r.mintable.length).mintable[0]} 去 mint token 测 P-9b，会话 ${rows.find(r => r.mintable.length).conversationCode}`
        : '现有 u2u 会话里没有可 mint 的账号：需要 (a) 用 ZMLJS001 那条会话对应的账号凭据，或 (b) 授权在 dev 给两个仿真账号建一条导师关系（mentorScope 一行，可回滚）',
}))
await client.close()
process.exit(0)
