/**
 * 只读分布统计：message 的 progress 分布，加上**用权威 policy** 查 llmUsage 的滞留情况。
 * 目的是核掉"5078 条窗口外滞留行"这个挂账数字。
 *
 * 一处我自己差点造出的假信号，写在这里当下酒菜：llmUsage 没有 `progress` 字段，
 * 所以 `{progress:'processing'}` 查它必然得 0——那不是"没有滞留"，是"查了个不存在的字段"。
 * 因此滞留判定一律复用 `abandonedQuery`（与 dac、与 cron、与测试同一份规则）。
 * 全部输出计数与时间，绝不取正文。
 */
import {abandonedQuery, DEFAULT_OLDER_THAN_MS} from '../../daos/core/policy/llmUsagePolicy.js'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
/**
 * @description 从配置文本里取一个字符串常量
 * @param {RegExp} re 规则
 * @param {String} def 缺省
 * @returns {String} 值
 */
function d(re, def) {
    return (re.exec(cfgText) || [])[1] || def
}
const uri = (process.env.MONGO_URI || 'mongodb://x')
    .replace(/^mongodb:\/\//, `mongodb://${(process.env.MONGO_USER || '')}:${(process.env.MONGO_PASS || '')}@`)
const dbName = (process.env.MONGO_DB || 'llm-api')

const client = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const db = client.db(dbName)

/**
 * @description 按某字段分组计数
 * @param {String} coll 集合
 * @param {String} field 字段
 * @returns {Promise<Object>} 分组
 */
async function groupCount(coll, field) {
    const rows = await db.collection(coll).aggregate([
        {$group: {_id: `$${field}`, n: {$sum: 1}}},
        {$sort: {n: -1}},
    ]).toArray()
    return Object.fromEntries(rows.map((r) => [String(r._id), r.n]))
}
/**
 * @description 某集合里符合 filter 的条数与时间跨度
 * @param {String} coll 集合
 * @param {Object} filter 条件
 * @returns {Promise<Object>} 读数
 */
async function span(coll, filter) {
    const n = await db.collection(coll).countDocuments(filter)
    if (!n) return {条数: 0}
    const first = await db.collection(coll).findOne(filter, {sort: {updateTime: 1}, projection: {_id: 0, updateTime: 1}})
    const last = await db.collection(coll).findOne(filter, {sort: {updateTime: -1}, projection: {_id: 0, updateTime: 1}})
    return {条数: n, 最早: first && first.updateTime, 最新: last && last.updateTime}
}

/** 用权威 policy 在两个窗口下各查一次：10 分钟（cron 实际用的）与一年（"窗口外"到底有没有） */
const abandonedNow = await db.collection('llmUsage').countDocuments(abandonedQuery({olderThanMs: DEFAULT_OLDER_THAN_MS}))
const abandonedWide = await db.collection('llmUsage').countDocuments(abandonedQuery({olderThanMs: 31536000000}))

const out = {
    库: dbName,
    message总数: await db.collection('message').countDocuments({}),
    message按progress: await groupCount('message', 'progress'),
    llmUsage总数: await db.collection('llmUsage').countDocuments({}),
    llmUsage按callAlert: await groupCount('llmUsage', 'callAlert'),
    /** 滞留判定（policy 同源）：默认窗口与一年窗口 */
    滞留_默认窗口: abandonedNow,
    滞留_一年窗口: abandonedWide,
    message里processing行: await span('message', {progress: 'processing'}),
    sessionCheckpoint条数: await db.collection('sessionCheckpoint').countDocuments({}),
}
await client.close()
console.log(JSON.stringify(out, null, 1))
