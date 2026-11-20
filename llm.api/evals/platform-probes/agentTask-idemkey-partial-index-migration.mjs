/**
 * @fileOverview 编排 root 幂等索引 partial 修正迁移（P-8 实锤 bug 的存量修复）
 * @module evals/platform-probes/agentTask-idemkey-partial-index-migration
 * @description
 * 背景（P-8 压测实锤）：`uniq_orchestratedRoot_idemKey` 旧 partialFilterExpression
 * 为 `{agentRole:'root', orchestrated:true}`——**不含 idemKey 存在性条件**，unique 索引
 * 把 missing 字段按 null 收录且 null 相等 ⇒ 同会话第二棵不带 taskCode 的编排 root 必撞
 * E11000（"受理键一次性"演变成"没有受理键就同会话终身一棵树"）。
 * 新定义加 `'params.idemKey': {$type: 'string'}`：只有真给了字符串受理键的行进索引。
 *
 * 为什么必须脚本：partialFilterExpression 变更**不会被 autoIndex 重建**——同名索引
 * 选项冲突（code 85）只会打日志，旧定义会一直躺在存量集合上。
 * 写操作确认门：--confirm=WRITE（exec-claim 探针先例——改库结构的事必须点名确认）。
 * 安全性：drop 前统计旧索引下的 (conversationCode,null) 重复组——**没有数据会被删**，
 * 只是索引重建；新 partial 下这些行不再进索引，不存在"重建撞重复"的风险。
 * 用法：node evals/platform-probes/agentTask-idemkey-partial-index-migration.mjs [--confirm=WRITE]
 */
import { MongoClient } from 'mongodb'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const confirm = val('confirm', '')

const cfg = (await import('../../conf/system.config.js')).default.mongodbConfig
// MongoClient 不吃 mongoose 方言的 options（autoIndex/user/pass/authSource 要换成驱动形）
const o = cfg.options || {}
const client = new MongoClient(cfg.uri, {
    dbName: o.dbName,
    auth: {username: o.user, password: o.pass},
    authSource: o.authSource || 'admin',
    maxPoolSize: o.maxPoolSize, minPoolSize: o.minPoolSize,
    socketTimeoutMS: o.socketTimeoutMS, serverSelectionTimeoutMS: o.serverSelectionTimeoutMS,
})
const out = {}

try {
    await client.connect()
    const db = client.db(cfg.options.dbName)
    const coll = db.collection('agentTask')
    const idxs = await coll.indexes()
    const old = idxs.find((x) => x.name === 'uniq_orchestratedRoot_idemKey')
    out.现状 = old ? {partial: old.partialFilterExpression, unique: old.unique} : '无此索引'

    const needMigrate = !old || !old.partialFilterExpression || !old.partialFilterExpression['params.idemKey']
    if (!needMigrate) {
        out.结论 = '已是新定义（$type 条件在位），无需迁移'
    } else if (confirm !== 'WRITE') {
        out.结论 = '需要迁移，但未带 --confirm=WRITE——改库结构必须点名确认，本次零写入'
    } else {
        // 迁移前体检：旧索引语义下"同会话多棵无键 root"的真实存量（只读数，不删数据）
        const dupStat = await coll.aggregate([
            {$match: {agentRole: 'root', orchestrated: true}},
            {$group: {_id: {c: '$conversationCode', k: '$params.idemKey'}, n: {$sum: 1}}},
            {$match: {'_id.k': null, n: {$gt: 1}}},
            {$count: 'groups'},
        ]).toArray()
        out.存量重复组 = dupStat[0]?.groups || 0

        if (old) await coll.dropIndex('uniq_orchestratedRoot_idemKey')
        await coll.createIndex(
            {conversationCode: 1, 'params.idemKey': 1},
            {
                unique: true,
                name: 'uniq_orchestratedRoot_idemKey',
                partialFilterExpression: {agentRole: 'root', orchestrated: true, 'params.idemKey': {$type: 'string'}},
            },
        )
        const after = (await coll.indexes()).find((x) => x.name === 'uniq_orchestratedRoot_idemKey')
        out.迁移后 = after?.partialFilterExpression
        out.结论 = '迁移完成：无键行已排除出索引，同会话多棵无 taskCode 的 root 合法共存'
    }
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 500)
} finally {
    await client.close().catch(() => {})
}
console.log(JSON.stringify(out, null, 1))
process.exit(out.错误 ? 2 : 0)
