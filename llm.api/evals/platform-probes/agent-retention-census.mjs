/**
 * @fileOverview agentTask / agentLog 留存普查（只读，给"要不要加 retention、留多久"提供决策数据）
 * @module evals/platform-probes/agent-retention-census
 * @description
 * §16.1 有一条待办：`agentTask/agentLog 无 TTL 无归档`，v1.5 实测两集合占 dev 库约 98%。
 * 但 `tasks/retention.js` 只管 answerCache / sessionCheckpoint / memoryNamespace，**这两个集合没有任何回收路径**。
 * 于是先问一个"能不能就地决定删法"之前，必须先把事实量清楚——而且**那条 98% 是 v1.5 的老数，可能已变**：
 * 本档的纪律是"引用现状前先重核"，所以这探针先回答三件事：
 *   1. 现在到底多大、占比多少（验证 98% 还成不成立）；
 *   2. 按时间怎么分布（>90/180/365 天各多少）——这决定"若按窗口 W 清理能回收多少"；
 *   3. 哪些**绝不能删**：未结束的 agentTask（handleStatus 非终态）、以及仍被现存任务引用的 agentLog（孤儿率）。
 *
 * **只读，不删任何东西。** 把"删除窗口/保留策略"这个决策留给运维——探针只把"删了会回收多少、会不会断链"摆出来，
 * 就像 §11.3 给模型配置决策数据、backfill/retention 默认关那样：先有数，再由有权限的人扳机。
 *
 * 输出只有计数、大小、时间桶、状态分布与孤儿率；**不打印任何文档正文、agentCode 具体值或凭据**。
 *
 * 用法（在 pod 里跑，连库由环境给；也可本地带 mongodb env）：
 *   node /app/evals/platform-probes/agent-retention-census.mjs [--out=/tmp/census.json]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const OUT = val('out', '')

await import('../../init.js')
const {AgentTask, AgentLog} = await import('../../daos/core/schema/index.js')

// 原生 Db 从 model 的连接链取（model.db 在此版本是 Connection、没有 .command）；取不到就跳过 size，不影响行数/年龄读数
let db = null
try {
    db = AgentTask.collection.conn.db || AgentTask.db.db
} catch (e) {
    db = null
}
const DAY = 24 * 3600 * 1000

async function collStats(name) {
    if (!db) {
        return {skipped: 'no-native-db-handle'}
    }
    try {
        const s = await db.command({collStats: name})
        return {count: s.count, storageSizeMB: Math.round((s.storageSize || 0) / 1048576), avgObjSizeBytes: Math.round(s.avgObjSize || 0)}
    } catch (e) {
        return {error: String(e?.message || e).slice(0, 80), name}
    }
}

async function ageBuckets(Model) {
    const now = Date.now()
    const cnt = (f) => Model.countDocuments(f).maxTimeMS(20000)
    const bucket = async (gteDays, ltDays) => {
        const f = {}
        if (ltDays != null) f.insertTime = {$lt: new Date(now - ltDays * DAY)}
        if (gteDays != null) f.insertTime = {...(f.insertTime || {}), $gte: new Date(now - gteDays * DAY)}
        return cnt(f)
    }
    return {
        total: await cnt({}),
        days_0_30: await bucket(30, null),
        days_30_90: await bucket(90, 30),
        days_90_180: await bucket(180, 90),
        days_180_365: await bucket(365, 180),
        days_over_365: await bucket(null, 365),
    }
}

async function statusDist(Model) {
    const rows = await Model.aggregate([{$group: {_id: '$status', n: {$sum: 1}}}], {maxTimeMS: 20000})
    const out = {}
    for (const r of rows) out[`status_${r._id}`] = r.n
    return out
}

// 哪些 agentTask 还在跑（handleStatus 非终态）绝不能删；这里只按状态计数，含义由 AgentHandleStatusEnum 定
async function handleStatusDist(Model) {
    const rows = await Model.aggregate([{$group: {_id: '$handleStatus', n: {$sum: 1}}}], {maxTimeMS: 20000})
    const out = {}
    for (const r of rows) out[`handle_${r._id}`] = r.n
    return out
}

// 孤儿量级（不把大数组拉进 node）：分别用服务端聚合取"不同 agentCode 数"，差值给量级参考。
// 精确孤儿集（agentLog.code 不在现存 agentTask 里）留给真正的清理脚本用 $lookup 算，census 不在这拖 dev。
async function distinctCodeCount(Model) {
    try {
        const r = await Model.aggregate([
            {$match: {agentCode: {$exists: true, $ne: null}}},
            {$group: {_id: '$agentCode'}},
            {$count: 'n'},
        ], {maxTimeMS: 20000})
        return r[0]?.n ?? 0
    } catch (e) {
        return {error: String(e?.message || e).slice(0, 80)}
    }
}
async function orphanScale() {
    const taskCodes = await distinctCodeCount(AgentTask)
    const logCodes = await distinctCodeCount(AgentLog)
    return {
        taskDistinctCodes: taskCodes,
        logDistinctCodes: logCodes,
        note: '两者是"不同 agentCode 数"的量级；精确孤儿数需清理脚本用 $lookup 现算，census 不在只读探针里跑重跨集合比对',
    }
}

// 异常 handleStatus 的时间定性：归一修复在 2026-10-27（commit 7dee5df，agentExecutor 把 uint32 的 4294967295 归一回 -1）。
// 修复日之后仍有新写入 => 还有第二条没经过归一的写库路径（现行 bug）；否则是修复前的历史脏数据（回填问题）。
async function abnormalHandleTimes() {
    const FIX = new Date('2026-10-27T11:00:39+08:00')
    const bad = 4294967295
    const total = await AgentTask.countDocuments({handleStatus: bad}).maxTimeMS(20000)
    let byUpdate = {error: 'skipped'}
    try {
        byUpdate = await AgentTask.countDocuments({handleStatus: bad, updateTime: {$gte: FIX}}).maxTimeMS(20000)
    } catch (e) {
        byUpdate = {error: String(e?.message || e).slice(0, 60)}
    }
    let byInsert = null
    try {
        byInsert = await AgentTask.countDocuments({handleStatus: bad, insertTime: {$gte: FIX}}).maxTimeMS(20000)
    } catch (e) {
        byInsert = {error: String(e?.message || e).slice(0, 60)}
    }
    return {
        fixDate: '2026-10-27', totalAbnormal: total,
        abnormalUpdatedAfterFix: byUpdate, abnormalInsertedAfterFix: byInsert,
        verdict: (typeof byUpdate === 'number' && byUpdate > 0)
            ? '现行：修复日之后仍有 agentTask 被写成 4294967295 ⇒ execAgentTask 之外还有未归一的写库/聚合路径'
            : '历史：异常行的 updateTime 都在修复日之前 ⇒ 是 7dee5df 之前的存量脏数据，回填修正即可（清理/回填脚本用 handleStatus 原值判等，别用 enum）',
    }
}

let dbSize = null
try {
    const d = db ? await db.command({dbStats: 1, scale: 1}) : null
    dbSize = d ? {storageSizeMB: Math.round((d.storageSize || 0) / 1048576)} : {skipped: 'no-native-db-handle'}
} catch (e) {
    dbSize = {error: String(e?.message || e).slice(0, 80)}
}

const result = {
    probe: 'agent-retention-census',
    at: new Date().toISOString(),
    db: dbSize,
    agentTask: {
        stats: await collStats('agentTask'),
        age: await ageBuckets(AgentTask),
        status: await statusDist(AgentTask),
        handleStatus: await handleStatusDist(AgentTask),
        abnormalHandle: await abnormalHandleTimes(),
    },
    agentLog: {
        stats: await collStats('agentLog'),
        age: await ageBuckets(AgentLog),
        status: await statusDist(AgentLog),
        orphansVsLiveTasks: await orphanScale(),
    },
    note: '只读普查，未删除任何文档。决策项：留存窗口（能回收=各时间桶之和）、非终态 agentTask 不可删、agentLog 孤儿需先于其任务删除。98% 占比请用 agentTask+agentLog 的 storageSizeMB / db.storageSizeMB 复核（v1.5 是旧数，可能已变）。',
}
const line = JSON.stringify(result, null, 1)
console.log(line)
if (OUT) fs.writeFileSync(OUT, line, 'utf8')
process.exit(0)
