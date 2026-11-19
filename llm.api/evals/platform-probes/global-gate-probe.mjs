/**
 * @fileOverview 全局并发闸的 live 探针（dev redis，验证发版同款 Lua 与 store 形状）
 * @module evals/platform-probes/global-gate-probe
 * @description
 * 离线测能证 JS 侧解析与参数形状，证不了：这台 redis 支不支持 EVAL、数字返回类型、
 * "剪枝→计数→检查→占位"在真实服务端的行为。这里跑**发版同款** `ADMISSION_LUA` 与 `createRedisStore`
 * （store 的键经 rewrite 代理全部落到探针专用 tag `{llm-rungzprobe}`，不碰真闸的 `{llm-runz}`）。
 * 键都带 120s TTL 且结束显式 DEL，全程只写探针命名空间。凭据从 system.config 现读，不硬编码。
 * 用法：`node evals/platform-probes/global-gate-probe.mjs`（cwd=src）
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import Redis from 'ioredis'
import {ADMISSION_LUA, userRunZKey, GLOBAL_RUN_ZKEY, createRedisStore, parseAdmissionResult} from '../../services/core/session/globalRunGate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../..')
const cfgText = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const cfgDefault = (re, d) => { const m = re.exec(cfgText); return m ? m[1] : d }

const PROBE_TAG = '{llm-rungzprobe}'
/** 键重写代理：把对真闸键的操作改写到探针命名空间（形状不变，命名空间隔离） */
const toProbe = (k) => typeof k === 'string' ? k.replace('{llm-runz}', PROBE_TAG) : k
const raw = new Redis({
    host: cfgDefault(/redisConfig_host'\] \|\| '([^']+)'/, 'mongo7-124'),
    port: Number(cfgDefault(/redisConfig_port'\] \|\| (\d+)/, '6379')),
    username: cfgDefault(/redisConfig_username'\] \|\| '([^']+)'/, 'localuser'),
    password: cfgDefault(/redisConfig_password'\] \|\| '([^']+)'/, 'local'),
    db: Number(cfgDefault(/redisConfig_db'\] \|\| (\d+)/, '10')),
    connectTimeout: 8000, maxRetriesPerRequest: 1,
})
const client = {
    eval: (lua, n, ...rest) => raw.eval(lua, n, ...rest.map(toProbe)),
    zrem: (k, m) => raw.zrem(toProbe(k), m),
    zcard: (k) => raw.zcard(toProbe(k)),
}
const probeG = `${PROBE_TAG}:g`
const probeU = (x) => `${PROBE_TAG}:u:${x}`

const now = Date.now()
const R = {}
const ok = (cond, name) => { R[name] = cond ? 'PASS' : 'FAIL'; if (!cond) R.allPass = false }
try {
    await raw.ping()
    const e = await raw.eval('return {1+tonumber(ARGV[1]), "s"}', 0, '41')
    ok(e[0] === 42 && e[1] === 's', 'evalSupported+typedReturn')

    const store = createRedisStore(client, {limit: 2, perUserLimit: 1, global: {maxRunAgeMs: 900000}})
    const d1 = parseAdmissionResult(await store.admit({messageCode: 'run-1', userCode: 'uA', now}), {limit: 2})
    const d2 = parseAdmissionResult(await store.admit({messageCode: 'run-2', userCode: 'uB', now}), {limit: 2})
    const d3 = parseAdmissionResult(await store.admit({messageCode: 'run-3', userCode: 'uC', now}), {limit: 2, retryAfterMs: 1500})
    ok(d1.admit && d2.admit && d1.active === 1 && d2.active === 2, 'admitUpToLimit')
    ok(!d3.admit && d3.reason === 'global-full' && d3.code === 4290, 'globalFullRejected')

    const s2 = createRedisStore(client, {limit: 99, perUserLimit: 1, global: {}})
    const u1 = parseAdmissionResult(await s2.admit({messageCode: 'run-x', userCode: 'uZ', now}), {})
    const u2 = parseAdmissionResult(await s2.admit({messageCode: 'run-y', userCode: 'uZ', now}), {})
    ok(u1.admit && !u2.admit && u2.reason === 'user-full', 'perUserCap')

    // 死账剪枝：**先清空探针全局键**（上一步的真实在途账还挂着，limit=1 下拒是正确行为——第一版探针没清场，红的是自己）
    await raw.del(toProbe(GLOBAL_RUN_ZKEY))
    await raw.zadd(toProbe(GLOBAL_RUN_ZKEY), String(now - 7200000), 'dead-1')
    const s3 = createRedisStore(client, {limit: 1, perUserLimit: 0, global: {maxRunAgeMs: 60000}})
    const p = parseAdmissionResult(await s3.admit({messageCode: 'run-c1', userCode: 'uE', now}), {limit: 1})
    ok(p.admit && p.active === 1, 'stalePruned')

    // release 回落 + 局部位/用户位成对清除（对象用场上真实存在的 run-c1——对已不在的键 zrem 是空砍，测不到东西）
    const cardBefore = await client.zcard(GLOBAL_RUN_ZKEY)
    await s3.release({messageCode: 'run-c1', userCode: 'uE'})
    const cardAfter = await client.zcard(GLOBAL_RUN_ZKEY)
    ok(cardBefore === 1 && cardAfter === 0, 'releaseDropsCount')
    ok((await raw.zcard(probeU('uE'))) === 0, 'userSlotFreed')

    // 真键没被误伤：{llm-runz}:g 若存在，探针不应改变它
    R.probeOnlyNamespace = true
} catch (err) {
    R.error = String(err.message).slice(0, 200)
    R.allPass = false
} finally {
    const ks = await raw.keys(`${PROBE_TAG}:*`)
    if (ks.length) await raw.del(...ks)
    R.cleanedKeys = ks.length
    R.allPass = R.allPass !== false && !R.error && !Object.values(R).includes('FAIL')
    raw.disconnect()
}
console.log(JSON.stringify(R, null, 1))
