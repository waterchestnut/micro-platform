/**
 * @fileOverview 操作mongodb中的llmUsage
 * @module daos/core/dac/llmUsageDac
 * @description
 * §14 自有账本的写入与聚合入口。G-6 门槛要的是"能出每 run 模型调用次数与每 run token 数"，
 * 所以这里除了 `upsertByMessageCode`，还把两个聚合做成方法：
 * 看板与探针都不该再自己写一遍 pipeline——口径一旦分叉，成本数字就对不上账。
 */

import {LlmUsage} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class LlmUsageDac extends BaseDac {
    constructor(Model) {
        super(Model, 'messageCode')
    }

    /**
     * @description 按 messageCode 落一条 run 级用量（重复覆盖，一个 run 只一行）
     * @param {Object} info 用量记录，必须带 messageCode
     * @returns {Promise<Object|null>} 落库后的记录
     */
    async upsertByMessageCode(info = {}) {
        if (!info.messageCode) {
            throw new Error('messageCode 不能为空')
        }
        return await LlmUsage.findOneAndUpdate(
            {messageCode: info.messageCode},
            {$set: {...info, updateTime: new Date()}, $setOnInsert: {insertTime: new Date()}},
            {upsert: true, new: true, setDefaultsOnInsert: true},
        )
    }

    /**
     * @description 取某用户某天的用量合计（预算与配额的主查询）
     * @param {String} userCode 用户标识
     * @param {String} day 归属日 yyyy-mm-dd
     * @returns {Promise<{runs: Number, modelCalls: Number, promptTokens: Number, cachedTokens: Number, billablePromptTokens: Number, completionTokens: Number, reasoningTokens: Number}>} 合计
     */
    async sumUserDay(userCode, day) {
        const rows = await LlmUsage.aggregate([
            {$match: {userCode, day}},
            {
                $group: {
                    _id: null,
                    runs: {$sum: 1},
                    modelCalls: {$sum: '$modelCalls'},
                    promptTokens: {$sum: '$promptTokens'},
                    cachedTokens: {$sum: '$cachedTokens'},
                    billablePromptTokens: {$sum: '$billablePromptTokens'},
                    completionTokens: {$sum: '$completionTokens'},
                    reasoningTokens: {$sum: '$reasoningTokens'},
                },
            },
        ])
        return rows[0] || {runs: 0, modelCalls: 0, promptTokens: 0, cachedTokens: 0, billablePromptTokens: 0, completionTokens: 0, reasoningTokens: 0}
    }

    /**
     * @description 每 run 模型调用次数的分布（G-6 要的"循环告警基线"）
     * @param {Object} [match] 额外过滤条件（如 channel/day）
     * @param {Number} [limit] 样本上限
     * @returns {Promise<{n: Number, median: Number|null, p95: Number|null, max: Number|null, histogram: Object[], warnRuns: Number, noUsageRuns: Number}>} 分布
     * @description
     * 中位数单独算而不用 `$median`（Mongo 版本兼容性差），做法是取回排序后的数组在内存里定位——
     * 账本一行几百字节，十万行也只是几十 MB，比在聚合里做 `$bucket` 更可控。
     */
    async callCountDistribution(match = {}, limit = 100000) {
        const rows = await LlmUsage.find(match)
            .select({modelCalls: 1, callAlert: 1, hasUsage: 1})
            .lean()
            .limit(limit)
            .exec()
        const counts = (rows || []).map(r => Number(r.modelCalls) || 0).sort((a, b) => a - b)
        const n = counts.length
        if (!n) {
            return {n: 0, median: null, p95: null, max: null, histogram: [], warnRuns: 0, noUsageRuns: 0}
        }
        const at = (q) => counts[Math.min(n - 1, Math.floor(q * n))]
        const buckets = new Map()
        counts.forEach(c => buckets.set(c, (buckets.get(c) || 0) + 1))
        return {
            n,
            median: at(0.5),
            p95: at(0.95),
            max: counts[n - 1],
            histogram: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([calls, cnt]) => ({calls, runs: cnt})),
            warnRuns: rows.filter(r => r.callAlert && r.callAlert !== 'ok').length,
            /** 没取到 usage 的 run：账本的可信度指标，绝不能默认当成 0 */
            noUsageRuns: rows.filter(r => !r.hasUsage).length,
        }
    }

    /**
     * @description 每 run token 数的分布（主指标是非缓存输入 token，D41）
     * @param {Object} [match] 额外过滤条件
     * @param {Number} [limit] 样本上限
     * @returns {Promise<{n: Number, sumBillablePrompt: Number, sumCompletion: Number, avgBillablePrompt: Number|null, avgCompletion: Number|null, avgCalls: Number|null, cacheReadTotal: Number}>} 汇总
     */
    async tokenSummary(match = {}, limit = 100000) {
        const rows = await LlmUsage.find(match)
            .select({modelCalls: 1, billablePromptTokens: 1, completionTokens: 1, cachedTokens: 1, hasUsage: 1})
            .lean()
            .limit(limit)
            .exec()
        const list = (rows || []).filter(r => r.hasUsage)
        const n = list.length
        if (!n) {
            return {n: 0, sumBillablePrompt: 0, sumCompletion: 0, avgBillablePrompt: null, avgCompletion: null, avgCalls: null, cacheReadTotal: 0}
        }
        const sum = (key) => list.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
        return {
            n,
            sumBillablePrompt: sum('billablePromptTokens'),
            sumCompletion: sum('completionTokens'),
            avgBillablePrompt: Math.round(sum('billablePromptTokens') / n),
            avgCompletion: Math.round(sum('completionTokens') / n),
            avgCalls: Number((sum('modelCalls') / n).toFixed(2)),
            cacheReadTotal: sum('cachedTokens'),
        }
    }
}

export default new LlmUsageDac(LlmUsage)
