/**
 * @fileOverview 单 pod 真实容量探针（P-8）
 * @module evals/platform-probes/capacity-probe
 * @description
 * PR-0.4 的并发闸和 PR-E0.5 的 Redis 承载都要一个数：**这个服务在被打到什么样时开始退化**。
 * 没有这个数，"设 50 还是 200"就是猜。本探针做三件事：
 *
 * 1. **阶梯并发**打 SSE 长流，记录每条连接的首字节延迟、总时长、事件数、字节数、收尾方式；
 * 2. **同时采样 Redis 的 INFO**（`instantaneous_ops_per_sec`、`connected_clients`、`evicted_keys`、
 *    `used_memory_human`）——§2E 里 Redis 是 cache 与 redlock 共用一个实例，
 *    并发上来后到底谁先撑不住，只有实测知道；
 * 3. **跑完立刻查 `llmUsage`**：每 run 模型调用次数与 token 量是这次压测的真实成本，
 *    v1.21 的账本在这里第一次派上用场——**不用为了算成本再加一套埋点**。
 *
 * 用法（在 `src/` 下）：
 *   $env:DEV_TOKEN='menglb%3A<uuid>'
 *   node evals/platform-probes/capacity-probe.mjs --levels=1,4,8,12 --maxTokens=80
 *   # 只想要并发数与延迟，不碰 redis：--no-redis
 *
 * 三条纪律：
 * 1. **只对 dev 打**，且并发阶梯封顶（默认最高 12）：压测的目标是找退化点，不是把 dev 打死；
 * 2. **提问固定且短**，`max_tokens` 显式压低：控制真实 token 开销，也让各轮次可比；
 * 3. **每级之间留冷却**，否则测的是上一级的尾巴而不是这一级的稳态。
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const Redis = require2('ioredis').default

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')

/**
 * @description 从配置源码里取字符串默认值（凭据不硬编码在探针里）
 * @param {RegExp} re 匹配正则
 * @param {String} d 兜底值
 * @returns {String} 值
 */
function cfgDefault(re, d) {
    const m = re.exec(cfgText)
    return m ? m[1] : d
}

const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : d
}

const BASE = valOf('base', process.env.PROBE_BASE || 'https://api.xxzx.paretop.net/llm')
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || '')
const requested = valOf('levels', '1,4,8,12').split(',').map(Number).filter(n => n > 0)
/**
 * 上限保护要有**响**，不能静默过滤。
 * 上一版这里写的是 `.filter(n => n > 0 && n <= 32)`，结果 `--levels=32,48,96` 只跑了 32，
 * 而结尾照样输出"还没打到退化点，可提高 --levels 再测"——**读数看起来像测过了 96**。
 * 现在：被拒绝的档位明确报出来，并默认直接退出（真要越线得显式加 `--danger`）。
 */
const CEILING = Number(valOf('ceiling', 128))
const DANGER = argv.includes('--danger')
const dropped = requested.filter(n => n > CEILING)
const LEVELS = requested.filter(n => n <= CEILING)
if (dropped.length) {
    log('档位被拒绝', {
        被拒: dropped, ceiling: CEILING,
        提示: DANGER ? '--danger 已给，继续' : `加 --danger 才会突破上限（这是防止误手把 dev 打死）`,
    })
    if (!DANGER) {
        process.exit(2)
    }
}
const MAX_TOKENS = Number(valOf('maxTokens', 80))
const COOLDOWN_MS = Number(valOf('cooldown', 4000))
const USE_REDIS = !argv.includes('--no-redis')
const CHANNEL = valOf('channel', 'xxzx_common')
const log = (note, obj) => console.log(JSON.stringify({probe: 'capacity', note, ...obj}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

if (!TOKEN) {
    console.log(JSON.stringify({probe: 'capacity', note: '缺 DEV_TOKEN，中止', 判定: '❌ 不注入凭据就不打真实流量'}))
    process.exit(1)
}

/**
 * @description 取分位数
 * @param {Number[]} sorted 升序数组
 * @param {Number} q 分位
 * @returns {Number|null} 分位值
 */
function quantile(sorted, q) {
    if (!sorted.length) {
        return null
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

const redis = USE_REDIS ? new Redis({
    host: cfgDefault(/host: process\.env\['redisConfig_host'\] \|\| '([^']+)'/, 'mongo7-124'),
    port: Number(cfgDefault(/port: parseInt\(process\.env\['redisConfig_port'\] \|\| (\d+)/, '6379')),
    username: cfgDefault(/username: process\.env\['redisConfig_username'\] \|\| '([^']+)'/, 'localuser'),
    password: cfgDefault(/password: process\.env\['redisConfig_password'\] \|\| '([^']+)'/, 'local'),
    db: Number(cfgDefault(/db: parseInt\(process\.env\['redisConfig_db'\] \|\| (\d+)/, '10')),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
}) : null

/**
 * @description 读一次 Redis 关键指标
 * @returns {Promise<Object|null>} 指标；连不上返回 null（不编造）
 */
async function sampleRedis() {
    if (!redis) {
        return null
    }
    try {
        /**
         * 注意：`info('stats clients memory keyspace')` 这种"一段字符串"是**错的**——
         * 服务端把它当成一个不认识的 section，只回一个空壳，于是所有指标读成 0/None，
         * 看起来像"redis 很空闲"，实际是仪表坏了。不带 section 参数才能拿到全量。
         */
        const info = await redis.info()
        const get = (k) => {
            const m = new RegExp(`^${k}:(.+)$`, 'm').exec(info)
            return m ? m[1].trim() : null
        }
        const num = (k) => {
            const v = get(k)
            return v === null ? null : Number(v)
        }
        return {
            redisVersion: get('redis_version'),
            opsPerSec: num('instantaneous_ops_per_sec'),
            connectedClients: num('connected_clients'),
            rejectedConnections: num('rejected_connections'),
            evictedKeys: num('evicted_keys'),
            expiredKeys: num('expired_keys'),
            totalCommandsProcessed: num('total_commands_processed'),
            usedMemoryHuman: get('used_memory_human'),
            /**
             * dev 的 redis 是多库共用（cache db10、redlock db11…），逐库列出键量。
             * INFO 的真实格式是 `db10:keys=42,expires=0,...`（冒号不是空格），按空格匹配会一条都抓不到。
             */
            keyspaces: (info.match(/^db\d+:keys=[\d,]+/gm) || []).map(s => s.split(',').slice(0, 2).join(',')),
            /** 自检：这一行全 0 就说明采样本身没拿到数据，别当成"空闲" */
            sampled: num('connected_clients') > 0,
        }
    } catch (e) {
        log('redis 采样失败', {err: String(e.message || e).slice(0, 120), 处理: '记 null，不用估算值填坑'})
        return null
    }
}

/**
 * @description 打一条 SSE 长流并测它的形态
 * @param {Number} idx 本批次内的连接序号
 * @returns {Promise<Object>} 单连接指标
 */
async function oneConnection(idx) {
    const conversationCode = `cap-${Date.now()}-${idx}`
    const t0 = Date.now()
    let ttfb = null, events = 0, bytes = 0, end = '', error = ''
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'param-accessToken': TOKEN,
            },
            body: JSON.stringify({
                query: '用一个词回答：1+1 等于几？',
                conversationCode,
                options: {channel: CHANNEL, protocol: 2, cache: false, llmParams: {maxTokens: MAX_TOKENS}},
            }),
            signal: AbortSignal.timeout(90000),
        })
        if (!r.ok) {
            error = `HTTP ${r.status}`
            return {conversationCode, ttfb, totalMs: Date.now() - t0, events, bytes, end: 'http-error', error}
        }
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            bytes += cv.byteLength
            if (ttfb === null && bytes > 0) {
                ttfb = Date.now() - t0
            }
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                if (/^:\s*ping\s*$/.test(f.trim())) {
                    continue
                }
                events++
                const ev = /event:(\S+)/.exec(f)?.[1] || 'delta'
                if (ev === 'done') {
                    end = 'done'
                } else if (ev === 'abort') {
                    end = 'abort'
                } else if (ev === 'error') {
                    end = 'error'
                    error = (/data:([\s\S]+)/.exec(f)?.[1] || '').trim().slice(0, 100)
                }
            }
        }
        if (!end) {
            end = 'closed-without-terminal'
        }
    } catch (e) {
        error = String(e?.name === 'TimeoutError' ? 'client-timeout-90s' : (e?.message || e)).slice(0, 120)
        end = end || 'exception'
    }
    return {conversationCode, ttfb, totalMs: Date.now() - t0, events, bytes, end, error}
}

const before = await sampleRedis()
const results = []

for (const n of LEVELS) {
    const t0 = Date.now()
    const batch = await Promise.allSettled(
        Array.from({length: n}, (unused, i) => oneConnection(i))
    )
    const rows = batch.map(b => (b.status === 'fulfilled' ? b.value : {end: 'settled-rejected', error: String(b.reason)?.slice(0, 120)}))
    const tt = rows.map(r => r.ttfb).filter(v => typeof v === 'number' && v > 0).sort((a, b) => a - b)
    const tot = rows.map(r => r.totalMs).filter(v => typeof v === 'number').sort((a, b) => a - b)
    const ends = rows.reduce((acc, r) => ({...acc, [r.end]: (acc[r.end] || 0) + 1}), {})
    const redisMid = await sampleRedis()

    results.push({n, rows, ends})
    /**
     * 慢尾必须显式打印，不能只给 p50/p95。
     * 上一版 96 并发的读数就是 p95=4.1s、墙钟 55.7s ⇒ 有连接卡了半分钟，
     * 而当时表上完全看不见（只有墙钟暴露了它）。这恰好是 PR-E0.3/PR-C 最关心的形态：
     * 一条 50s 不出字的流，网关切不切、ping 有没有用，都取决于这类尾巴。
     */
    const wallMs = Date.now() - t0
    const bySlow = [...rows].sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0)).slice(0, 3)
    log(`并发 ${n}`, {
        墙钟ms: wallMs,
        首字节: {p50: quantile(tt, 0.5), p95: quantile(tt, 0.95), 最大: tt[tt.length - 1] ?? null},
        总时长: {p50: quantile(tot, 0.5), p95: quantile(tot, 0.95), p99: quantile(tot, 0.99), 最大: tot[tot.length - 1] ?? null},
        最慢三条: bySlow.map(r => ({conversationCode: r.conversationCode, totalMs: r.totalMs, 帧: r.events, 字节: r.bytes, end: r.end})),
        /** 墙钟 ≫ 最慢请求 ⇒ 瓶颈在客户端连接池/网关排队，不在服务端 run */
        墙钟减最慢ms: wallMs - (tot[tot.length - 1] ?? 0),
        收尾分布: ends,
        失败样本: rows.filter(r => r.error).map(r => r.error).slice(0, 3),
        redis: redisMid,
    })
    await sleep(COOLDOWN_MS)
}

const after = await sampleRedis()
log('redis 前后对比', {before, after, 连接释放: 'after.connectedClients 应回落到 before 附近'})

/**
 * 用账本核算这次压测的真实成本（v1.21 的账本第一次当"成本出口"用）。
 * 只统计本次产生的 conversationCode 前缀，避免把历史流量算进来。
 */
try {
    const {MongoClient} = require2('mongodb')
    const uriBase = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodb://mongo7-124:27017')
    const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'localuser')
    const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'yopit123')
    const auth = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'admin')
    const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'xxzx-llm-api')
    const allCodes = results.flatMap(r => r.rows.map(x => x.conversationCode).filter(Boolean))
    const mc = await MongoClient.connect(
        uriBase.replace(/^mongodb:\/\//, `mongodb://${user}:${pass}@`) + `/${dbName}?authSource=${auth}`,
        {serverSelectionTimeoutMS: 12000, maxPoolSize: 4},
    )
    const agg = await mc.db(dbName).collection('llmUsage').aggregate([
        {$match: {conversationCode: {$in: allCodes}}},
        {$group: {
            _id: null,
            runs: {$sum: 1},
            calls: {$sum: '$modelCalls'},
            billable: {$sum: '$billablePromptTokens'},
            completion: {$sum: '$completionTokens'},
            noUsage: {$sum: {$cond: ['$hasUsage', 0, 1]}},
        }},
    ]).toArray()
    log('本次压测的账本成本', {
        连接数: allCodes.length,
        账本命中: agg[0]?.runs ?? 0,
        模型调用次数: agg[0]?.calls ?? 0,
        非缓存输入tok: agg[0]?.billable ?? 0,
        输出tok: agg[0]?.completion ?? 0,
        无usage行: agg[0]?.noUsage ?? 0,
        说明: '账本命中 < 连接数 说明有连接没走到落库（异常路径），这本身就是要看的东西',
    })
    await mc.close()
} catch (e) {
    log('账本核算失败', {err: String(e?.message || e).slice(0, 160)})
}

if (redis) {
    redis.disconnect()
}

/**
 * 退化点判定：哪一级开始出现非 done 收尾或 p95 明显抬头。
 * 这只是**初步读数**，不是结论——结论要看 pod 侧的 CPU/事件循环（本探针拿不到，需 kubectl top 与 PR-0.4 埋点）。
 */
const firstBad = results.find(r => Object.keys(r.ends).some(k => k !== 'done'))
log('结论', {
    阶梯: results.map(r => `${r.n}:${r.rows.every(x => x.end === 'done') ? 'ok' : JSON.stringify(r.ends)}`),
    首个非纯done级别: firstBad?.n ?? null,
    判定: firstBad
        ? `⚠️ 并发 ${firstBad.n} 起出现非 done 收尾，需结合 pod 指标定位；PR-0.4 的闸值不要拍脑袋设`
        : '✅ 全部级别都以 done 收尾（还没打到退化点，可提高 --levels 再测）',
})
process.exit(0)
