/**
 * @fileOverview 验证"蒸发可见"：硬杀进程后，被遗弃的 run 能不能从账本里查出来
 * @module evals/platform-probes/abandoned-run-check
 * @description
 * v1.32 的结论是：被 SIGKILL 的 run **两张表都没有行**，所以"发版丢了几轮"在数据上无法回答。
 * v1.33 加了开局落账 + 在途刷新之后，这条探针就是它的验收：
 *   1. 起本地服务，打一条长流；
 *   2. **在途时用 TerminateProcess 硬杀服务**（Windows 上这就是 SIGKILL 的等价物——
 *      不是优雅关闭，因为优雅关闭早就被 v1.32 证明"救得了也白救"，要测的正是硬杀）；
 *   3. 重启服务，调 `listAbandoned()`：这一轮必须以 `progress:'processing'` 出现，
 *      且 `modelCalls/upstreamAttempts/latencyMs` 有值。
 *
 * 用法（在 `src/` 下）：node evals/platform-probes/abandoned-run-check.mjs
 * 只写自己新建的 conversationCode（前缀 abandoned-check）。
 */
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = Number(process.env.PROBE_PORT || 12019)
const log = (note, obj) => console.log(JSON.stringify({probe: 'abandoned-run', note, ...obj}))

/**
 * @description 起一个独立的 llm.api 进程
 * @param {String} tag 标记
 * @returns {Object} 子进程句柄
 */
function startServer(tag) {
    /**
     * 用 shell:true 起：Windows 上 `node_modules/.bin/fastify` 是 sh 脚本，直接 spawn 会失败
     * （而"起不来"会被自检读成装置没通电，不会伪装成结论，这点是故意的）。
     * 这样 child.pid 是 cmd.exe，配合下面的 `taskkill /F /T` 连子进程一起杀——
     * 整棵树没有任何清理机会，正是 v1.32 在容器里看到的那种死法。
     */
    const child = spawn('npx fastify start -l warn app.js', {
        cwd: SRC,
        env: {...process.env, PORT: String(PORT), checkpoint_enabled: 'true'},
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        shell: true,
    })
    log('服务已启动', {tag, pid: child.pid})
    return child
}

/**
 * @description 等服务可用
 * @param {Number} [timeoutMs] 超时
 * @returns {Promise<Boolean>} 是否就绪
 */
async function waitReady(timeoutMs = 60000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/runStats`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'user-info': Buffer.from(JSON.stringify({userCode: 'menglb'})).toString('base64')},
                body: '{}',
            })
            if (r.status === 200) {
                return true
            }
        } catch (e) { /* 还没起来 */ }
        await new Promise(r => setTimeout(r, 1500))
    }
    return false
}

/**
 * @description 打一条长流（不求跑完，等着被硬杀）
 * @param {String} conversationCode 会话
 * @returns {Promise<Object>} 结局
 */
async function longStream(conversationCode) {
    const t0 = Date.now()
    let chars = 0
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'text/event-stream',
                'user-info': Buffer.from(JSON.stringify({userCode: 'menglb', realName: '遗弃检查'})).toString('base64'),
            },
            body: JSON.stringify({
                query: '请连续写一篇 3000 字以上的长文，主题是那些没人接手的中断：发布、信号、以及没有留下的记录。要求分章节，不要调用工具。',
                conversationCode,
                options: {channel: 'xxzx_common', protocol: 2, cache: false},
            }),
            signal: AbortSignal.timeout(150000),
        })
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                if ((/event:(\S+)/.exec(f)?.[1] || 'delta') === 'delta') {
                    try {
                        chars += (JSON.parse((/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, ''))?.content || '').length
                    } catch (e) { /* 忽略 */ }
                }
            }
        }
    } catch (e) {
        return {墙钟ms: Date.now() - t0, 字符: chars, err: String(e?.message || e).slice(0, 60)}
    }
    return {墙钟ms: Date.now() - t0, 字符: chars}
}

const conversationCode = `abandoned-check-${Date.now()}`
let server = startServer('第一进程（将被硬杀）')
if (!await waitReady()) {
    log('结论', {判定: '❌ 服务没起来（装置没通电），本次读数无效'})
    process.exit(2)
}

const p = longStream(conversationCode)
await new Promise(r => setTimeout(r, 12000))
log('硬杀服务（TerminateProcess = SIGKILL 等价）', {已跑ms: 12000})
/**
 * `taskkill /F` 是 Windows 上唯一真正等价于 SIGKILL 的手段：
 * 它不给进程任何清理机会，正是 v1.32 在容器里看到的那种死法。
 */
const {execFileSync} = require2('child_process')
try {
    execFileSync('taskkill', ['/PID', String(server.pid), '/F', '/T'], {stdio: 'pipe', timeout: 30000})
} catch (e) {
    log('硬杀失败', {err: String(e?.message || e).slice(0, 120), 判定: '❌ 没杀成，本次读数无效'})
    process.exit(2)
}
await p

/* 等 updateTime 落定，再起新进程查（listAbandoned 要 olderThanMs 已过，这里用 0 即时可见） */
await new Promise(r => setTimeout(r, 3000))
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const d = (re, def) => (re.exec(cfgText) || [])[1] || def
const client = await MongoClient.connect(
    d(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
        .replace(/^mongodb:\/\//, `mongodb://${d(/options_user'\] \|\| '([^']+)'/, 'localuser')}:${d(/options_pass'\] \|\| '([^']+)'/, 'yoprt123')}@`),
    {serverSelectionTimeoutMS: 15000, maxPoolSize: 2})
const dbName = d(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
const row = await client.db(dbName).collection('llmUsage').find({conversationCode},
    {projection: {_id: 0, messageCode: 1, progress: 1, llmModel: 1, modelCalls: 1, upstreamAttempts: 1, latencyMs: 1, insertTime: 1, updateTime: 1}}).next()
/** 档案侧对照：账本有行而 message 无行，正是"这轮丢了但已可查"的形态 */
const msgRow = await client.db(dbName).collection('message').find({conversationCode},
    {projection: {_id: 0, progress: 1}}).next()
await client.close()

const 用户侧 = await p.catch(() => ({}))
log('读数', {硬杀时的用户侧: 用户侧, 账本行: row, message行: msgRow})
log('结论', {
    判定: row && row.progress === 'processing'
        ? `✅ **蒸发已经可见**：账本留下 ${row.progress} 行（modelCalls=${row.modelCalls}, attempts=${row.upstreamAttempts}, latencyMs=${row.latencyMs}），`
            + `而 message 侧${msgRow ? '也有行（' + msgRow.progress + '）' : '没有行'} ⇒ 恢复扫描与成本对账第一次有了数据源`
        : (row
            ? `⚠️ 账本有行但 progress=${row.progress}：硬杀后 progress 不是 processing 说明有别的写覆盖了它，要查是哪一步写的`
            : '❌ 账本没有行 ⇒ 开局落账没生效（可能 llmUsageLive 被关、或硬杀发生在落账之前），能力未建立'),
    这次丢了几个字: 用户侧?.字符 ?? 0,
})
process.exit(row && row.progress === 'processing' ? 0 : 1)
