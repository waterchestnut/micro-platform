/**
 * 只读：把候选 llmUsage 行的 progress / updateTime 打出来，并用同一份 predicate 复算
 * 目的：解释"视图说 9 条可回填、任务层说 9 条心跳新鲜"这个矛盾，不带猜测
 */
await import('../../init.js')
const {LlmUsage} = await import('../../daos/core/schema/index.js')
const {abandonedQuery, DEFAULT_OLDER_THAN_MS, isAbandonedRun} = await import('../../daos/core/policy/llmUsagePolicy.js')

const olderThanMs = DEFAULT_OLDER_THAN_MS
const now = Date.now()
const rows = await LlmUsage.find(abandonedQuery({olderThanMs}), {
    messageCode: 1, progress: 1, updateTime: 1, conversationCode: 1,
}).limit(20).lean()
console.log(JSON.stringify({
    阈值: olderThanMs, now,
    计数: rows.length,
    读数: rows.map(r => ({
        mc: (r.messageCode || '').slice(0, 8),
        conv: r.conversationCode,
        progress: r.progress,
        updateTime类型: r.updateTime instanceof Date ? 'Date' : typeof r.updateTime,
        updateTime: r.updateTime instanceof Date ? r.updateTime.toISOString() : r.updateTime,
        距今ms: r.updateTime instanceof Date ? now - r.updateTime.getTime() : null,
        isAbandonedRun: isAbandonedRun({progress: r.progress, updateTime: r.updateTime, olderThanMs, now: () => now}),
    })),
}, null, 1))
process.exit(0)
