/**
 * @fileOverview 平台侧探针：OpenSandbox execd 文件通路契约 + 库存量审计
 * @module evals/platform-probes/probe
 * @description
 * 对应 `docs/session-run-plan.md` §16.3 的 **P-14**（execd 文件 API 实测）与 **P-12**（存量审计）。
 * v1.5 已用等价逻辑跑过一轮，结论在 §0.1；本脚本入库是为了**可重复**——PR-H2 的 intake 上线前后各跑一次，
 * 契约漂移（尤其 Range 语义与 upload 形态）能当场发现。
 *
 * 凭据一律不硬编码：
 * - OpenSandbox key 取 `OPEN_SANDBOX_API_KEY`，缺省时从 `conf/system.config.js` 的默认值解析；
 * - mongo 连接取 `MONGO_URI`，缺省时同样从 `system.config.js` 解析（dev 默认值）。
 *
 * 三条纪律：
 * 1. **建箱必删**：`finally` 里无条件 `DELETE`，池模式建箱很快，但泄漏会吃 `429 POOL_CAPACITY_EXHAUSTED`。
 * 2. **只读优先**：inventory 模式全是 count/aggregate 读；execd 模式只在自己新建的沙箱里写文件。
 * 3. **intake 走 lifecycle 代理**：实测刚分配的池沙箱走网关直连会 502（路由传播延迟），代理通道稳定 200。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/probe.mjs                 # 两个都跑
 *   node evals/platform-probes/probe.mjs --execd         # 只跑 execd 契约（会建/删一个 dev 沙箱）
 *   node evals/platform-probes/probe.mjs --inventory     # 只跑存量审计（纯读，不建资源）
 *   node evals/platform-probes/probe.mjs --pool=pool-dev
 * @author menglb 2026-11-08
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../..')
const CFG = path.join(SRC, 'conf/system.config.js')
const argv = process.argv.slice(2)
const valOf = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d }
const ALL = !argv.some(a => /^--(execd|inventory)$/.test(a))
const DO_EXECD = ALL || argv.includes('--execd')
const DO_INV = ALL || argv.includes('--inventory')

const log = (t, o) => console.log(JSON.stringify({probe: t, ...o}))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 从 system.config.js 抠默认值（与 upstream-probes 同一手法：配置即事实来源） */
function cfgDefault(re, label) {
    const src = fs.readFileSync(CFG, 'utf8')
    const m = src.match(re)
    if (!m) throw new Error(`未能从 ${CFG} 解析出 ${label}；配置写法变了请同步本探针`)
    return m[1]
}

/* ================= P-14：execd 文件通路契约 ================= */
async function probeExecd() {
    const base = process.env.SANDBOX_BASE_URL || cfgDefault(/baseUrl: process\.env\['sandboxConfig_baseUrl'\] \|\| '([^']+)'/, 'sandboxConfig.baseUrl')
    const key = process.env.OPEN_SANDBOX_API_KEY || cfgDefault(/apiKey: process\.env\['sandboxConfig_apiKey'\] \|\| '([^']+)'/, 'sandboxConfig.apiKey')
    const pool = valOf('pool', 'pool-dev')
    const H = () => ({'OPEN-SANDBOX-API-KEY': key, 'Content-Type': 'application/json'})
    let id = null
    log('execd target', {base, pool, keyLen: key.length})
    try {
        const c = await (await fetch(`${base}/v1/sandboxes`, {method: 'POST', headers: H(), body: JSON.stringify({extensions: {poolRef: pool}, timeout: 600, metadata: {purpose: 'platform-probe'}})})).json()
        id = c.id
        if (!id) throw new Error(`建箱失败：${JSON.stringify(c).slice(0, 200)}`)
        log('create', {id, state: c.status?.state ?? c.status})
        await sleep(4000)

        /*两种入口：lifecycle 代理（推荐）与网关直连（可能因路由传播延迟 502）*/
        const ep = await (await fetch(`${base}/v1/sandboxes/${id}/endpoints/44772`, {headers: {'OPEN-SANDBOX-API-KEY': key}})).json().catch(() => ({}))
        log('endpoint', {gateway: ep.endpoint, headers: Object.keys(ep.headers || {})})
        const via = async (p, opt = {}) => {
            const r = await fetch(`${base}/v1/sandboxes/${id}/proxy/44772${p}`, {...opt, headers: {'OPEN-SANDBOX-API-KEY': key, ...(opt.headers || {})}})
            const buf = new Uint8Array(await r.arrayBuffer())
            return {status: r.status, cr: r.headers.get('content-range'), len: buf.length, text: () => new TextDecoder().decode(buf)}
        }
        const cmd = async (command) => (await via('/command', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({command, timeout: 60000})})).text().replace(/\n+/g, ' ').slice(0, 200)

        /*1) 命令通路*/
        log('cmd write', {r: await cmd('printf "line1\\nline2\\nline3\\n" > /workspace/probe.txt && wc -c /workspace/probe.txt')})
        log('cmd bigfile', {r: await cmd('python3 -c "open(\'/workspace/big.bin\',\'wb\').write(bytes(range(256))*20480)" 2>/dev/null || dd if=/dev/urandom of=/workspace/big.bin bs=1M count=5; ls -la /workspace/big.bin')})

        /*2) 元数据*/
        const info = await via('/files/info?path=/workspace/probe.txt')
        log('files/info', {status: info.status, body: info.text().slice(0, 160)})

        /*3) 全文下载*/
        const dl = await via('/files/download?path=/workspace/probe.txt')
        log('download full', {status: dl.status, len: dl.len, body: dl.text().slice(0, 40)})

        /*4) Range（PR-H2 的关键依赖）*/
        const rg = await via('/files/download?path=/workspace/probe.txt', {headers: {Range: 'bytes=6-11'}})
        log('Range 6-11', {status: rg.status, contentRange: rg.cr, len: rg.len, body: rg.text(), 判定: rg.status === 206 && rg.len === 6 ? '✅ Range 语义可用' : '❌ Range 不符合预期，intake 分段方案需重估'})

        /*5) 大文件分段*/
        const bg = await via('/files/download?path=/workspace/big.bin', {headers: {Range: 'bytes=0-1048575'}})
        log('Range 0-1MB', {status: bg.status, contentRange: bg.cr, got: bg.len, 判定: bg.status === 206 && bg.len === 1048576 ? '✅ 大文件分段可用' : '❌ 分段异常'})

        /*6) upload 契约（已知需要 metadata 部分，这里固化断言以防漂移）*/
        const fd = new FormData()
        fd.append('path', '/workspace/up.txt')
        fd.append('file', new Blob(['uploaded-by-probe\n'], {type: 'text/plain'}), 'up.txt')
        const up = await fetch(`${base}/v1/sandboxes/${id}/proxy/44772/files/upload`, {method: 'POST', headers: {'OPEN-SANDBOX-API-KEY': key}, body: fd})
        const upBody = (await up.text()).slice(0, 160)
        log('upload 朴素两字段', {status: up.status, body: upBody, 判定: up.status === 400 && /metadata file is missing/.test(upBody) ? '⚠️ 与 v1.5 实测一致：需按 WriteEntry 形态先传 metadata' : (up.status < 300 ? '✅ 已支持朴素两字段（契约变了，更新 §0.1）' : '❌ 新形态，需查')})

        /*7) 列举/搜索/中断端点*/
        log('directories/list', {status: (await via('/directories/list?path=/workspace')).status})
        log('files/search', (await via('/files/search?path=/workspace&pattern=*.txt')).text().slice(0, 160))
        const cancel = await via('/command', {method: 'DELETE'})
        log('DELETE /command 无 id', {status: cancel.status, 判定: cancel.status === 400 ? '✅ 中断端点存在（需 executionId）' : '❓ 端点形态变了'})

        /*8) 直连网关（记录传播延迟，不作失败判定）*/
        if (ep.endpoint) {
            try {
                const url = /^https?:/.test(ep.endpoint) ? ep.endpoint : `http://${ep.endpoint}`
                const d = await fetch(`${url}/ping`, {headers: {...(ep.headers || {})}})
                log('direct gateway /ping', {status: d.status, 判定: d.status === 200 ? '✅ 直连可用' : '⚠️ 直连不通（v1.5 实测为路由传播延迟），intake 请用 proxy'})
            } catch (e) { log('direct gateway /ping', {error: String(e.message || e)}) }
        }
    } finally {
        if (id) {
            const r = await fetch(`${base}/v1/sandboxes/${id}`, {method: 'DELETE', headers: {'OPEN-SANDBOX-API-KEY': key}})
            log('cleanup', {id, status: r.status, 判定: r.status === 204 ? '✅ 已删除' : '❌ 删除失败，请手工清理'})
        }
    }
}

/* ================= P-12：库存量审计（纯读） ================= */
async function probeInventory() {
    const uri = process.env.MONGO_URI || (() => {
        const u = cfgDefault(/uri: process\.env\['mongodbConfig_uri'\] \|\| '([^']+)'/, 'mongodbConfig.uri')
        const user = cfgDefault(/user: process\.env\['mongodbConfig_options_user'\] \|\| '([^']+)'/, 'user')
        const pass = cfgDefault(/pass: process\.env\['mongodbConfig_options_pass'\] \|\| '([^']+)'/, 'pass')
        const auth = cfgDefault(/authSource: process\.env\['mongodbConfig_options_authSource'\] \|\| '([^']+)'/, 'authSource')
        return u.replace('://', `://${user}:${pass}@`) + `/?authSource=${auth}`
    })()
    const dbName = cfgDefault(/dbName: process\.env\['mongodbConfig_options_dbName'\] \|\| '([^']+)'/, 'dbName')
    const req = createRequire(path.join(SRC, 'package.json'))
    const {MongoClient} = req('mongodb')
    const c = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 8000, maxPoolSize: 2})
    const d = c.db(dbName)
    const GB = (n) => Number((n / 1073741824).toFixed(2))
    try {
        const st = await d.stats()
        log('db', {name: dbName, collections: st.collections, dataGB: GB(st.dataSize), storageGB: GB(st.storageSize), indexMB: Math.round(st.indexSize / 1048576)})
        const names = (await d.listCollections().toArray()).map(x => x.name)
        const rows = []
        for (const n of names) {
            let s = {}
            try { s = await d.command({collStats: n, scale: 1}) } catch { continue }
            rows.push({n, count: s.count, sizeMB: Math.round((s.size || 0) / 104857.68) / 10, avgKB: s.count ? Number((s.size / s.count / 1024).toFixed(1)) : 0})
        }
        rows.sort((a, b) => b.sizeMB - a.sizeMB)
        log('collections', {top: rows.slice(0, 8)})

        /*检查点：阶段分布（postTools 是否出现过）+ 折叠是否生效*/
        const cp = d.collection('sessionCheckpoint')
        log('checkpoint', {
            n: await cp.countDocuments(),
            byPhase: await cp.aggregate([{$group: {_id: '$phase', n: {$sum: 1}}}, {$sort: {n: -1}}]).toArray(),
            folded: await cp.countDocuments({status: {$ne: 0}}),
            ttl: (await cp.indexes()).filter(i => i.expireAfterSeconds != null).map(i => ({name: i.name, after: i.expireAfterSeconds})),
        })
        /*message：progress 分布、被丢弃段数（PR-B 基线）、单条体积*/
        const m = d.collection('message')
        log('message', {
            n: await m.countDocuments(),
            byProgress: await m.aggregate([{$group: {_id: '$progress', n: {$sum: 1}}}]).toArray(),
            answerListDist: await m.aggregate([
                {$addFields: {n: {$cond: [{$isArray: '$extInfo.answerList'}, {$size: '$extInfo.answerList'}, 0]}}},
                {$group: {_id: '$n', c: {$sum: 1}}}, {$sort: {_id: 1}},
            ]).toArray(),
            withTools: await m.countDocuments({'extInfo.toolCalls.0': {$exists: true}}),
        })
        /*远程技能存量（PR-E0.1 复核面）*/
        log('grpcSkill', await d.collection('grpcSkill').aggregate([
            {$project: {skillName: 1, clientCode: 1, channels: 1, grpcHost: 1, status: 1, 'operator.userCode': 1, insertTime: 1, mdLen: {$strLenCP: {$ifNull: ['$skillMD', '']}}}},
            {$sort: {insertTime: -1}},
        ]).toArray())
    } finally {
        await c.close()
        log('inventory done', {note: '纯读，未写入任何集合'})
    }
}

if (DO_EXECD) await probeExecd()
if (DO_INV) await probeInventory()
console.log('# 结论回填 docs/session-run-plan.md §0.1 与 §25')
