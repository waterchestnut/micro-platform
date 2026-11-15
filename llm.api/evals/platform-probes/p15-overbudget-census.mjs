/**
 * @fileOverview P-15 重跑：越界触发率普查（PR-K2 的规模由它定，D65 方法论）
 * @module evals/platform-probes/p15-overbudget-census
 * @description
 * §5.3 的排期条件是"真出现越界（长文档、多工具链频道）再由 P-15 重跑触发"，而 v1.18 的
 * finalize 15.2s 读数说明多工具链会话是现网真实。这一把不猜：直接从库里读三个事实——
 *   1) `extInfo.contextUsage.total/budget` 的比值分布：**越界率**决定 T3 的触发面；
 *   2) `llmUsage.promptTokens` 对窗口线的分布（loopTokens 是本地估算，promptTokens 是上游实测，两口径都要）；
 *   3) 工具链形态：`iterationCount` 分布 + 带 finalize 的轮数（T3 clearing 的候选人群是"深工具史"会话）。
 * 判据口径照 §5.2 的验收变更：**非缓存字节**才是 T1/T3 的收益面，这里顺带报 cached 口径核对。
 * 用法（在 `src/` 下）：node evals/platform-probes/p15-overbudget-census.mjs [--days=30] [--limit=3000]
 */
await import('../../init.js')
const {Message} = await import('../../daos/core/schema/index.js')
const {LlmUsage} = await import('../../daos/core/schema/index.js')

const days = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=30').split('=')[1])
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=3000').split('=')[1])
const since = new Date(Date.now() - days * 86400000)

const rows = await Message.find(
    {insertTime: {$gte: since}, 'extInfo.contextUsage': {$ne: null}},
    {'extInfo.contextUsage': 1, 'extInfo.iterationCount': 1, 'extInfo.forcedFinal': 1, 'extInfo.loopExit': 1, insertTime: 1},
).sort({insertTime: -1}).limit(limit).lean()

function pct(arr, q) {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}
const ratios = []
const totals = []
let over = 0
let iterN = []
let finalized = 0
let noBudget = 0
for (const r of rows) {
    const cu = r.extInfo?.contextUsage || {}
    if (Number.isFinite(cu.total)) totals.push(cu.total)
    if (Number.isFinite(cu.total) && Number.isFinite(cu.budget) && cu.budget > 0) {
        ratios.push(cu.total / cu.budget)
        if (cu.total > cu.budget) over++
    } else if (Number.isFinite(cu.total)) { noBudget++ }
    if (Number.isFinite(r.extInfo?.iterationCount)) iterN.push(r.extInfo.iterationCount)
    if (r.extInfo?.forcedFinal) finalized++
}
const usage = await LlmUsage.find(
    {insertTime: {$gte: since}, promptTokens: {$gt: 0}},
    {promptTokens: 1, cachedTokens: 1, completionTokens: 1},
).sort({insertTime: -1}).limit(limit).lean()
const prompts = usage.map((u) => u.promptTokens)
const nonCached = usage.filter((u) => u.promptTokens > 0).map((u) => Math.max(0, u.promptTokens - (u.cachedTokens || 0)))

console.log(JSON.stringify({
    样本: {天数: days, 带contextUsage的档案: rows.length, 账本带promptTokens行: usage.length},
    越界: {
        档案越界条数: over,
        越界率: rows.length ? (over / rows.length).toFixed(4) : null,
        比值p50: pct(ratios, 0.5), p90: pct(ratios, 0.9), p99: pct(ratios, 0.99), max: ratios.length ? Math.max(...ratios) : null,
        无budget可比的行: noBudget,
        total_p50: pct(totals, 0.5), total_p99: pct(totals, 0.99),
    },
    上游实测口径: {
        promptTokens_p50: pct(prompts, 0.5), p90: pct(prompts, 0.9), p99: pct(prompts, 0.99), max: prompts.length ? Math.max(...prompts) : null,
        非缓存_p50: pct(nonCached, 0.5), 非缓存_p99: pct(nonCached, 0.99), 非缓存max: nonCached.length ? Math.max(...nonCached) : null,
    },
    工具链形态: {
        iteration_p50: pct(iterN, 0.5), iteration_p90: pct(iterN, 0.9), iteration_p99: pct(iterN, 0.99),
        带finalize条数: finalized,
    },
}, null, 1))
process.exit(0)
