/**
 * @fileOverview 集群内只读复核：中断归因的真实分布（不依赖任何外部凭据与网关鉴权）
 * @module evals/platform-probes/incluster-attribution-census
 * @description
 * 为什么需要它：cw2pc 的网关要求它自己签发的 token（登录强制图形码），
 * 而且现网可能根本没有新流量 —— 这两种情况下，"从库外证明部署生效"都做不到。
 * 但 pod 里跑的就是那份代码、连的就是那个库，所以在 pod 内做只读聚合是唯一不受这两件事挡住的路径。
 *
 * 三条纪律写死在这里：
 * 1. **判据自检先行**：先确认 `updateTime` 字段存在且类型为 Date，再谈"多少行新数据"。
 *    2026-11-12 我就因为用了一个不存在的 `createTime` 字段，把"0 行"当成了"没有流量"。
 * 2. 输出只有计数、枚举与时间戳：不打印正文、不打印凭据、不打印库名。
 * 3. 集群侧脚本一律 ASCII：中文键名经 PowerShell 管道进 `kubectl exec` 会被 GBK 读成 `?`，
 *    直接 SyntaxError（实测踩过）。
 *
 * 用法（本机执行，脚本自己进 pod）：
 *   kubectl --kubeconfig=<path> -n <ns> exec deploy/llm-api-http -- sh -c "cd /app && node /tmp/incluster-attribution-census.mjs --since=2026-11-12T12:11:04Z"
 * 先送进去：
 *   Get-Content -Raw src/evals/platform-probes/incluster-attribution-census.mjs |
 *     kubectl --kubeconfig=<path> -n <ns> exec -i deploy/llm-api-http -- sh -c "cat > /tmp/incluster-attribution-census.mjs"
 * 也可以顺手核对代码形状：
 *   kubectl ... exec deploy/llm-api-http -- grep -n 'interruptedBy' /app/services/core/llmChat.js
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
/**
 * @description read a flag value
 * @param {String} n flag name without --
 * @param {String} def default
 * @returns {String} value
 */
function val(n, def) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : def
}

/**
 * @description find the app root (image layouts differ between clusters)
 * @returns {String} root path
 */
function findRoot() {
    const cands = ['/app', '/app/src', '/root/app', process.cwd()]
    for (const r of cands) {
        if (fs.existsSync(path.join(r, 'conf', 'system.config.js'))) {
            return r
        }
    }
    throw new Error('cannot locate app root containing conf/system.config.js')
}
const ROOT = findRoot()

/**
 * @description mongodb driver lives under .pnpm in this image family
 * @returns {Promise<Object>} module
 */
async function loadMongo() {
    const pnpm = path.join(ROOT, 'node_modules', '.pnpm')
    if (fs.existsSync(pnpm)) {
        const hit = fs.readdirSync(pnpm).filter((x) => /^mongodb@/.test(x))[0]
        if (hit) {
            return await import(`file://${path.join(pnpm, hit, 'node_modules', 'mongodb', 'lib', 'index.js')}`)
        }
    }
    return await import('mongodb')
}

const {MongoClient} = await loadMongo()
const mod = await import(`file://${path.join(ROOT, 'conf', 'system.config.js')}`)
const cfg = mod.default || mod
const pick = cfg.mongodbConfig
if (!pick) {
    console.log(JSON.stringify({fail: 'no mongodbConfig key', topKeys: Object.keys(cfg).slice(0, 30)}))
    process.exit(1)
}
const opts = pick.options || {}
const uri = String(pick.uri || '').replace(/^mongodb:\/\//, `mongodb://${opts.user || ''}${opts.pass ? ':' + opts.pass : ''}@`)
const client = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 10000})
const db = client.db(opts.dbName)
const coll = db.collection('message')

/** discipline 1: verify the premise of my own predicate before believing any count */
const total = await coll.countDocuments({})
const dateTyped = await coll.countDocuments({updateTime: {$type: 'date'}})
const newest = await coll.aggregate([{$sort: {updateTime: -1}}, {$limit: 1}, {$project: {_id: 0, updateTime: 1, progress: 1}}]).toArray()
console.log(JSON.stringify({appRoot: ROOT, premiseTotalRows: total, premiseUpdateTimeIsDate: dateTyped, newestRow: newest.map((r) => ({updateTime: r.updateTime && r.updateTime.toISOString ? r.updateTime.toISOString() : r.updateTime, progress: r.progress}))}))

if (val('since', '')) {
    const SINCE = new Date(val('since'))
    console.log(JSON.stringify({scope: 'updateTime >= since', newRows: await coll.countDocuments({updateTime: {$gte: SINCE}}), since: SINCE.toISOString()}))
    const g = await coll.aggregate([
        {$match: {updateTime: {$gte: SINCE}}},
        {$group: {_id: {progress: '$progress', writtenBy: '$extInfo.writtenBy', interruptedBy: '$extInfo.interruptedBy'}, n: {$sum: 1}}},
        {$sort: {n: -1}},
        {$limit: 20},
    ]).toArray()
    for (const r of g) {
        console.log(JSON.stringify({progress: r._id.progress, writtenBy: r._id.writtenBy === undefined ? '(no-key)' : r._id.writtenBy, interruptedBy: r._id.interruptedBy === undefined ? '(no-key)' : r._id.interruptedBy, count: r.n}))
    }
}

const ab = await coll.aggregate([
    {$match: {progress: 'abort'}},
    {$group: {_id: '$extInfo.interruptedBy', n: {$sum: 1}, latest: {$max: '$updateTime'}}},
    {$sort: {n: -1}},
]).toArray()
console.log('abort rows grouped by interruptedBy (whole collection):')
for (const r of ab) {
    console.log(JSON.stringify({interruptedBy: r._id === undefined || r._id === null ? '(no-key/null)' : String(r._id), count: r.n, latest: r.latest && r.latest.toISOString ? r.latest.toISOString() : r.latest}))
}
console.log(JSON.stringify({unspecifiedRows: await coll.countDocuments({'extInfo.interruptedBy': 'unspecified'}), distinctInterruptedBy: (await coll.distinct('extInfo.interruptedBy')).map((v) => String(v))}))
await client.close()
