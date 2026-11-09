/**
 * @fileOverview 操作mongodb中的llmUsage
 * @module daos/core/dac/llmUsageDac
 * @description
 * §14 自有账本的写入与聚合入口。G-6 门槛要的是"能出每 run 模型调用次数与每 run token 数"，
 * 所以这里除了 `upsertByMessageCode`，还把两个聚合做成方法：
 * 看板与探针都不该再自己写一遍 pipeline——口径一旦分叉，成本数字就对不上账。
 */

import {LlmUsage} from '../schema/index.js'
import {abandonedQuery, DEFAULT_OLDER_THAN_MS, LEDGER_PROGRESS} from '../policy/llmUsagePolicy.js'
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
     * @description run 一开始就落一行"进行中"的账本
     * @param {Object} info 至少含 messageCode/conversationCode/userCode/channel/llmModel/day
     * @returns {Promise<Object|null>} 落库后的记录
     * @description
     * **为什么要在开局写、而不是等收尾**：v1.32 实测证明现网容器里 SIGTERM 到不了应用，
     * 发版时的在途 run 是被 SIGKILL 的——那种情况下 `persistTurn` 和"结束时才写"都不会执行，
     * 于是**蒸发的 run 在两张表里都不存在**：成本查不到（我用账本自证时读出"损失 0"，那其实是盲区），
     * 恢复也无从扫起（PR-E 要扫"未终态 run"，**没有行就没有未终态**）。
     * 开局落一行 progress:'processing' 之后，硬杀留下的就是一个可查的未完成行。
     *
     * **为什么这不必等 PR-G**：D64 的耦合针对的是 `message.progress` 被三端折成 `done`、
     * 刷新后渲染出一条空的"已完成"回答；而 `llmUsage` **不是任何前端读的面**，写它零渲染风险。
     * 换句话说：同一份"进行中"状态，放在业务表上要等前端一起改，放在账本里现在就能落。
     */
    async markStarted(info = {}) {
        if (!info.messageCode) {
            throw new Error('messageCode 不能为空')
        }
        return await LlmUsage.findOneAndUpdate(
            {messageCode: info.messageCode},
            {
                $set: {...info, progress: LEDGER_PROGRESS.PROCESSING, updateTime: new Date()},
                $setOnInsert: {insertTime: new Date()},
            },
            {upsert: true, new: true, setDefaultsOnInsert: true},
        )
    }

    /**
     * @description 在途刷新：每次真正发起上游调用时把累计计数写回去
     * @param {Object} info 含 messageCode 与本 run 累计值
     * @returns {Promise<Object|null>} 更新后的记录
     * @description
     * **只更新计数字段、不碰 `progress`**（这里显式 delete 掉）：
     * 进度状态归收尾写管，两处都能写就会互相覆盖，最后谁赢取决于时序——那正是 §2E-2"两份同值分家"的形状。
     */
    async touchInflight(info = {}) {
        if (!info.messageCode) {
            throw new Error('messageCode 不能为空')
        }
        const {messageCode, ...rest} = info
        delete rest.progress
        return await LlmUsage.findOneAndUpdate(
            {messageCode},
            {$set: {...rest, updateTime: new Date()}},
            {new: true},
        )
    }

    /**
     * @description 查"被遗弃的 run"：progress 仍是从中、且早已不再刷新
     * @param {Object} params 参数
     * @param {Number} [params.olderThanMs] 多久没更新算遗弃（**必须大于一次正常 run 的墙钟上限**，否则把在途误判成损失）
     * @param {Number} [params.limit] 条数上限
     * @param {Function} [params.now] 时间源（测试注入用）
     * @returns {Promise<Object[]>} 未完成行
     * @description
     * 这是"发版到底丢了几轮"的**唯一可查口径**。v1.32 之前只能靠探针日志数（而我数错了两回），
     * 因为损失的 run 不留任何记录；有了它，PR-E 的恢复扫描和成本对账才第一次有数据源。
     * 默认 10 分钟的依据：实测 run 墙钟 2.3s / 10.2s / 24.0s、历史最长 31.2s，留一个量级的余量。
     */
    async listAbandoned({olderThanMs = DEFAULT_OLDER_THAN_MS, limit = 200, now = Date.now} = {}) {
        /**
         * 查询条件由 policy 生成，**不在这里重写判断**。
         * 一旦 dac 写一份、测试再手写一份，两者漂移时测试会去验证一个已经失效的口径；
         * 现在 dac 与用例共用同一个函数，规则只存在一份。
         */
        return await LlmUsage.find(abandonedQuery({olderThanMs, now}))
            .select({
                messageCode: 1, conversationCode: 1, userCode: 1, channel: 1, llmModel: 1,
                modelCalls: 1, billablePromptTokens: 1, completionTokens: 1, upstreamAttempts: 1,
                fallbackTo: 1, latencyMs: 1, insertTime: 1, updateTime: 1,
            })
            .lean()
            .limit(limit)
            .exec()
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
