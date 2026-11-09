/**
 * @fileOverview 交叉核对 message.extInfo.usage 与 llmUsage 账本行是否说同一个数
 * @module evals/platform-probes/usage-crosscheck
 * @description
 * 这两个地方是**分开写的**：一个在 `saveMessage` 的 `extInfo`，一个在 `llmUsage` 窄表。
 * 分开写就意味着会分开坏——本项目就真发生过"同一轮里 extInfo 说 0 次调用、账本说 1 次"
 * （异常路径读到"稍后赋值"的过期变量，D66）。所以这条一致性要能一键执行，而不是靠人记得去看。
 *
 * 用法（在 `src/` 下，只读）：
 *   node evals/platform-probes/usage-crosscheck.mjs                 # 自动打一轮再核对
 *   node evals/platform-probes/usage-crosscheck.mjs --abort=2500    # 打一轮中途断开的（异常路径最容易不一致）
 *   node evals/platform-probes/usage-crosscheck.mjs --codes=a,b     # 只核对指定 messageCode
 *
 * 凭据不硬编码：mongo 连接串从 `conf/system.config.js` 默认值解析（与 probe.mjs 同口径）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

/** 以项目内路径为基准解析依赖（脚本可能被放在别处跑） */
const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')

/**
 * @description 从配置源码里取一个字符串默认值，避免 import 配置文件把连接都建起来
 * @param {RegExp} re 匹配正则
 * @param {String} d 兜底值
 * @returns {String} 配置值
 */
function cfgDefault(re, d) {
    const m = re.exec(cfgText)
    return m ? m[1] : d
}

const argv = process.argv.slice(2)
const valOf = (n) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : undefined
}
const BASE = valOf('base') || 'http://127.0.0.1:12008'
const USER = {userCode: valOf('user') || 'menglb', realName: '探针'}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const log = (note, obj) => console.log(JSON.stringify({probe: 'usage-crosscheck', note, ...obj}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
const authSource = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')

/**
 * @description 打一轮对话（可选中途打断），返回 conversationCode
 * @param {String} query 提问
 * @param {Number|null} abortAfterMs 打断时刻
 * @returns {Promise<String>} conversationCode
 */
async function runTurn(query, abortAfterMs = null) {
    const conversationCode = `xchk-${Date.now()}`
    const ac = new AbortController()
    const timer = abortAfterMs ? setTimeout(() => ac.abort(), abortAfterMs) : null
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': b64(USER)},
            body: JSON.stringify({query, conversationCode, options: {channel: 'xxzx_common', protocol: 2, cache: false}}),
            signal: ac.signal,
        })
        const dec = new TextDecoder()
        /** 不解析帧：这里只关心落库后的两处数字 */
        for await (const cv of r.body) {
            dec.decode(cv, {stream: true})
        }
    } catch (e) {
        /* 主动打断预期内 */
    } finally {
        if (timer) {
            clearTimeout(timer)
        }
    }
    await sleep(4000)
    return conversationCode
}

/**
 * @description 取某会话最新一条消息的 extInfo.usage（走 message/list，顺带验证视图）
 * @param {Object} db mongo db 句柄
 * @param {String} conversationCode 会话标识
 * @returns {Promise<{messageCode: String, extUsage: Object|null, progress: String}>} 结果
 */
async function readExtUsage(db, conversationCode) {
    const doc = await db.collection('message').find({conversationCode}).sort({insertTime: -1}).limit(1).next()
    if (!doc) {
        return {messageCode: '', extUsage: null, progress: ''}
    }
    return {
        messageCode: doc.messageCode,
        extUsage: doc.extInfo?.usage || null,
        progress: doc.progress,
    }
}

const client = await MongoClient.connect(
    uriBase.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`) + `/${dbName}?authSource=${authSource}`,
    {serverSelectionTimeoutMS: 12000, maxPoolSize: 4},
)
const db = client.db(dbName)

let codes = (valOf('codes') || '').split(',').filter(Boolean)
if (!codes.length) {
    const abortAfterMs = valOf('abort') ? Number(valOf('abort')) : null
    const query = abortAfterMs
        ? '请写一篇 800 字左右的散文，主题是深夜的实验室，要求分段、有细节。'
        : '用两句话解释什么是幂等性，不要调用任何工具。'
    const cc = await runTurn(query, abortAfterMs)
    const {messageCode} = await readExtUsage(db, cc)
    codes = [messageCode]
    log('取样', {conversationCode: cc, messageCode, 模式: abortAfterMs ? `打断于${abortAfterMs}ms` : '正常一轮'})
}

/**
 * @description 核对同一 messageCode 在两处的关键字段是否一致
 * @param {Object} ext `message.extInfo.usage`
 * @param {Object} row `llmUsage` 文档
 * @returns {String[]} 不一致项的说明列表
 */
function diffFields(ext, row) {
    const keys = ['modelCalls', 'hasUsage', 'billablePromptTokens', 'promptTokens', 'completionTokens', 'cachedTokens', 'callAlert']
    return keys.filter(k => Number(ext?.[k] ?? -1) !== Number(row?.[k] ?? -2)
        && !(ext?.[k] === undefined && row?.[k] === undefined)
        && String(ext?.[k]) !== String(row?.[k]))
        .map(k => `${k}: extInfo=${JSON.stringify(ext?.[k])} vs 账本=${JSON.stringify(row?.[k])}`)
}

for (const messageCode of codes) {
    const doc = await db.collection('message').find({messageCode}).next()
    const ext = doc?.extInfo?.usage || null
    const row = await db.collection('llmUsage').find({messageCode}).next()
    if (!ext && !row) {
        log(messageCode, {判定: '❌ 两处都没有 usage（该轮的代码版本没上线？）'})
        continue
    }
    if (!row) {
        log(messageCode, {progress: doc?.progress, ext, 判定: '❌ extInfo 有 usage 但账本没行 ⇒ 落账失败或写入被跳过'})
        continue
    }
    const diffs = diffFields(ext, row)
    log(messageCode, {
        progress: doc?.progress,
        loopExit: row.loopExit,
        extInfo: ext ? {modelCalls: ext.modelCalls, hasUsage: ext.hasUsage, billable: ext.billablePromptTokens, alert: ext.callAlert} : null,
        账本: {modelCalls: row.modelCalls, hasUsage: row.hasUsage, billable: row.billablePromptTokens, alert: row.callAlert, latencyMs: row.latencyMs},
        不一致项: diffs,
        判定: diffs.length ? `❌ 两处数字打架：${diffs.join('; ')}` : '✅ extInfo 与账本逐字段一致（D66 的一致性成立）',
    })
}

await client.close()
process.exit(0)
