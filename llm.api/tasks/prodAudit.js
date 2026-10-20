/**
 * @fileOverview prod（online/union）迁移核对工具 —— **只读，绝不写**
 * @module tasks/prodAudit
 * @description runbook 在 memory-plan §6.6。分工：本工具只出计数与判定；
 * dropIndex / 回填这类**写动作留在人工命令**里做 —— 迁移的前提是先拿到这里的数字。
 * 三个核对面：
 * 1. **索引实态 vs 声明**：Mongo 不会改同名既有索引的选项（§5.4 的坑），
 *    所以 unique/TTL 是"看起来建了其实没对"的重灾区，必须逐个比对实态。
 * 2. **answerCache 唯一索引重建预检**：drop 前必须确认重复键组为 0，本工具把这一步固化成断言。
 * 3. **expireAt 存量回填判定**：TTL 索引是后加的（§6.5），缺字段的文档 Mongo 不回收，
 *    首轮需要 runRetention 回填 —— 缺多少条要数出来，不是"上线了就会自己好"。
 * @author xianyang
 */

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

/** 各集合的索引期望：keys 按字段集合比对，unique/ttlSeconds 比对选项 */
const INDEX_EXPECTATIONS = [
    {
        model: 'AnswerCache', collection: 'answerCache',
        indexes: [
            {keys: ['channel', 'channelCacheKey', 'llmModel', 'queryHashCode'], unique: true, note: '§5.4/§6.3：prod 存量环境必须实测 unique=true，否则去重形同未做'},
            {keys: ['expireAt'], ttlSeconds: 0, note: '§6.5：新索引名 expireAt_1，自动建；缺的是存量文档的字段，见 backfill 检查'},
        ],
    },
    {
        model: 'MemoryEvent', collection: 'memoryEvent',
        indexes: [{keys: ['insertTime'], ttlSeconds: 720 * 3600, note: '事件层 30 天 TTL'}],
    },
    {
        model: 'MemoryCandidate', collection: 'memoryCandidate',
        indexes: [{keys: ['insertTime'], ttlSeconds: 168 * 3600, note: '候选层 7 天 TTL'}],
    },
    {
        model: 'MemoryJournal', collection: 'memoryJournal',
        indexes: [{keys: ['insertTime'], ttlSeconds: 8760 * 3600, note: '日志层 1 年 TTL'}],
    },
    {
        model: 'MemoryAtom', collection: 'memoryAtom',
        indexes: [{keys: ['atomCode'], unique: true, note: '原子唯一键'}],
    },
    {
        model: 'MemoryNamespace', collection: 'memoryNamespace',
        indexes: [{keys: ['userCode', 'channel', 'workspaceId'], unique: true, note: '隔离边界复合键（PR-16 ③ 的分区实现在这）'}],
    },
    {
        model: 'SessionCheckpoint', collection: 'sessionCheckpoint',
        indexes: [
            {keys: ['insertTime'], ttlSeconds: 7 * 24 * 3600, note: '检查点是现场，7 天回收'},
            {keys: ['sandboxId'], note: 'PR-16 ②：快照仓库 join key'},
        ],
    },
    {
        model: 'SandboxUsage', collection: 'sandboxUsage',
        indexes: [{keys: ['sandboxId'], unique: true, note: '§5.26：按台去重的账本唯一键'}],
    },
]

function sameKeys(a, b) {
    const ka = Object.keys(a || {}).sort().join(',')
    const kb = [...(b || [])].sort().join(',')
    return ka === kb
}

/**
 * @description 跑一轮核对，输出报告与总判定
 * @author xianyang
 * @param {Object} [opts] {verbose}
 * @returns {Promise<Object>} {fail, warn, lines}
 */
export async function runProdAudit(opts = {}) {
    const schema = await import('../daos/core/schema/index.js')
    const fail = []
    const warn = []
    const lines = []
    const say = s => { lines.push(s); logger().info(`[prodAudit] ${s}`) }

    for (const spec of INDEX_EXPECTATIONS) {
        const M = schema[spec.model]
        if (!M) {
            fail.push(`${spec.model} 未注册（schema/index.js 缺导出？）`)
            continue
        }
        let actual = []
        try {
            actual = await M.collection.indexes()
        } catch (e) {
            fail.push(`${spec.collection} 索引读取失败：${e.message}`)
            continue
        }
        for (const want of spec.indexes) {
            const hit = actual.find(ix => sameKeys(ix.key, want.keys))
            if (!hit) {
                fail.push(`${spec.collection} 缺索引 [${want.keys.join(',')}]（${want.note}）`)
                continue
            }
            if (want.unique && !hit.unique) {
                fail.push(`${spec.collection}.${hit.name} 存在但 **unique 未生效** —— Mongo 不改同名索引，须走 §6.6 查重→drop→重建`)
            }
            if (want.ttlSeconds !== undefined && Number(hit.expireAfterSeconds ?? -1) !== want.ttlSeconds) {
                fail.push(`${spec.collection}.${hit.name} TTL 实为 ${hit.expireAfterSeconds}，声明 ${want.ttlSeconds} —— 同样要 drop 重建`)
            }
            say(`${spec.collection}.${hit.name} 在位 unique=${hit.unique ? 'true' : 'false'} ttl=${hit.expireAfterSeconds ?? '-'}`)
        }
        const n = await M.countDocuments({})
        say(`${spec.collection} 文档数=${n}`)
    }

    /* ---- answerCache 唯一索引重建预检（§6.3：确认 0 重复组才允许 drop） ---- */
    const AC = schema.AnswerCache
    /** 聚合失败与"零重复组"必须区分：$count 无匹配时返回空数组，那是 0 不是错 */
    const dupGroups = await AC.aggregate([
        {$match: {channel: {$ne: null}}},
        {$group: {_id: {channel: '$channel', channelCacheKey: '$channelCacheKey', llmModel: '$llmModel', queryHashCode: '$queryHashCode'}, c: {$sum: 1}}},
        {$match: {c: {$gt: 1}}},
        {$count: 'groups'},
    ]).catch(e => ({err: e.message}))
    if (dupGroups && dupGroups.err) {
        warn.push(`answerCache 重复组预检聚合失败：${dupGroups.err}（drop 前必须人工完成同等查重）`)
    } else {
        const dup = dupGroups?.[0]?.groups ?? 0
        if (dup > 0) {
            fail.push(`answerCache 存在 ${dup} 组重复键 —— 唯一索引重建前必须先清重（或保留最新一条）`)
        } else {
            say('answerCache 重复键组 = 0（可以安全执行 drop→重建）')
        }
    }

    /* ---- expireAt 存量回填判定（§6.5：缺字段的不会被 TTL 回收） ---- */
    const noExpire = await AC.countDocuments({expireAt: {$exists: false}}).catch(() => -1)
    if (noExpire > 0) {
        warn.push(`answerCache 缺 expireAt 的存量=${noExpire} 条 —— 需首轮 runRetention 回填（带 channel 逐个跑）或等每日 03:45 cron；回填后超过留存期的会删，上线初期命中率会小幅下降`)
    } else if (noExpire === 0) {
        say('answerCache 存量全部带 expireAt（回填已完成/无存量）')
    }

    const verdict = fail.length ? 'FAIL' : (warn.length ? 'WARN' : 'PASS')
    say(`总判定=${verdict}（fail=${fail.length} warn=${warn.length}）`)
    fail.forEach(f => logger().error(`[prodAudit][FAIL] ${f}`))
    warn.forEach(w => logger().warn(`[prodAudit][WARN] ${w}`))
    return {verdict, fail, warn, lines}
}

export default {runProdAudit}
