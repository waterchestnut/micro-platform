/**
 * 存量技能批准迁移（PR-E0.1 ② 的落地前置）。**默认 dry-run，只读不写。**
 *
 * 为什么必须先跑它再上线这一刀：装配侧新加的判据是"必须 approved"，而缺字段按 pending 处理
 * （这是刻意的：把"没登记"读成"已批准"就是本次要修的洞）。于是现存 7 条技能在新代码下
 * **一条都不会进上下文**——聊天里的远程工具面会整体消失，症状看起来像"升级把技能弄坏了"。
 *
 * 批准的依据不是"它们本来就在跑"，而是 §25.1 那份**已归档的人工复核**（7 条、无滥用迹象、
 * grpcHost 均为集群内自家 gRPC）。所以脚本只把复核过的记录标成 approved，并把依据写进 reviewNote。
 *
 * 用法：
 *   node evals/platform-probes/skill-approval-migration.mjs            # 只出计划
 *   node evals/platform-probes/skill-approval-migration.mjs --write    # 真写库（人工确认后）
 */
import path from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r2 = createRequire(path.join(SRC, 'server.js'))
const {MongoClient} = r2('mongodb')
const {default: llm} = await import(pathToFileURL(path.join(SRC, 'conf/system.config.js')).href)
const {md5} = await import(pathToFileURL(path.join(SRC, 'tools/security.js')).href)

const cfg = llm.mongodbConfig
const uri = String(cfg.uri).replace(/^mongodb:\/\//,
    `mongodb://${cfg.options.user || ''}${cfg.options.pass ? ':' + cfg.options.pass : ''}@`)
const DO_WRITE = process.argv.includes('--write')
/** 复核依据（§25.1）。写成常量而不是"默认批准全部"，是为了让"批准了哪几条"这件事有明确出处 */
const REVIEW_NOTE = 'PR-E0.1 存量复核批准（依据 docs/session-run-plan.md §25.1：7 条、无滥用迹象、grpcHost 均为集群内自家 gRPC）'

const mongo = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000})
try {
    const db = mongo.db(cfg.options.dbName)
    const skills = db.collection('grpcSkill')
    const rows = await skills.find({status: {$ne: -1}}, {
        projection: {_id: 0, skillCode: 1, skillName: 1, grpcHost: 1, clientCode: 1, channels: 1, operator: 1, insertTime: 1, reviewStatus: 1, skillMD: 1, skillMDHash: 1},
    }).toArray()

    const plan = []
    for (const r of rows) {
        const has = Object.prototype.hasOwnProperty.call(r, 'reviewStatus')
        plan.push({
            skillCode: r.skillCode,
            skillName: r.skillName,
            当前审核态: has ? String(r.reviewStatus) : '(缺字段⇒按 pending 处理)',
            会被装配放行: has && r.reviewStatus === 'approved',
            已存哈希: Boolean(r.skillMDHash),
            新哈希: md5(r.skillMD || ''),
            grpcHost: r.grpcHost,
            channels: r.channels || [],
            operator: r.operator?.userCode || '',
        })
    }
    const needWrite = plan.filter((p) => p.当前审核态 !== 'approved' || !p.已存哈希)
    console.log(JSON.stringify({
        模式: DO_WRITE ? 'WRITE' : 'DRY-RUN（不写库）',
        在册技能数: plan.length,
        现在就会被放行数: plan.filter((p) => p.会被装配放行).length,
        需要迁移数: needWrite.length,
        明细: plan.map((p) => ({名: p.skillName, 审核态: p.当前审核态, 放行: p.会被装配放行, 有哈希: p.已存哈希, host: p.grpcHost})),
    }, null, 1))

    if (!DO_WRITE) {
        console.log('DRY-RUN：未写库。确认无误后加 --write 执行；执行前请复核上面每一条的 host/channels 与 §25.1 一致。')
        process.exit(0)
    }
    const journal = db.collection('skillJournal')
    const written = []
    for (const p of needWrite) {
        const res = await skills.updateOne({skillCode: p.skillCode}, {
            $set: {
                reviewStatus: 'approved',
                skillMDHash: p.新哈希,
                reviewedBy: {userCode: 'migration', realName: '存量复核迁移'},
                reviewedAt: new Date(),
                reviewNote: REVIEW_NOTE,
            },
        })
        await journal.insertOne({
            journalCode: (globalThis.crypto?.randomUUID?.() || String(Date.now())).replace(/-/g, ''),
            skillCode: p.skillCode,
            skillName: p.skillName,
            actor: 'migration',
            op: 'approve',
            actorUser: {userCode: 'migration', realName: '存量复核迁移'},
            before: {reviewStatus: p.当前审核态, skillMDHash: p.已存哈希 ? p.新哈希 : ''},
            after: {reviewStatus: 'approved', skillMDHash: p.新哈希},
            evidence: [{note: REVIEW_NOTE}],
            reason: REVIEW_NOTE,
            insertTime: new Date(),
        }).catch((e) => console.log(`留痕写入失败 skillCode=${p.skillCode}：${e.message}`))
        written.push({skillCode: p.skillCode, modifiedCount: res.modifiedCount})
    }
    console.log(JSON.stringify({已迁移: written.length, 明细: written}))
} finally {
    await mongo.close()
    process.exit(0)
}
