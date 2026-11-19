/**
 * @fileOverview 消耗读数服务（PR-任务编排 §5-4 后半；薄 IO 壳，口径转调 taskAccounting）
 * @module services/core/usageStats
 * @description
 * 把"日汇总/树汇总"两个消费面集中在这里：dac 只做聚合原语（$sum），**归约语义单源在
 * taskAccounting.reduceDailyTotals**——口径散在 dac 与 routes 两处是本项目反复清过的病。
 * 消费面纪律与 /runStats 一致：日汇总只给**调用者本人**的账（自己的账不是枚举面）；
 * 树汇总的归属校验在调用端点做（root.operator.userCode === 当前用户），这里只提供聚合。
 */
import llmUsageDac from '../../daos/core/dac/llmUsageDac.js'
import {LlmUsage} from '../../daos/core/schema/index.js'
import { reduceDailyTotals } from './session/taskAccounting.js'

/**
 * @description 某用户某日的消耗汇总（credits 三值语义见 reduceDailyTotals）
 * @param {String} userCode 用户
 * @param {String} day yyyy-mm-dd
 * @returns {Promise<Object>} 各 token/credits 总量 + creditsPriced:true|false|null
 */
export async function getUserDailyUsage(userCode, day) {
    const raw = await llmUsageDac.sumUserDay(userCode, day)
    const {_id, ...clean} = raw // 聚合管道的 plumbing 字段不外漏给消费面
    return {day, ...reduceDailyTotals(clean)}
}

/**
 * @description 按 rootCode 聚合一棵任务树的账（§5-4 关联列的查询面：不再靠 conv 前缀反解）
 * @param {String} rootCode 编排 root
 * @returns {Promise<{rows:Number, tokens:Number, credits:Number, byRole:Object}>} byRole 各角色的 tokens/credits
 */
export async function getTreeUsage(rootCode) {
    const rows = await LlmUsage.aggregate([
        {$match: {rootCode: String(rootCode || '')}},
        {$group: {
            _id: '$agentRole',
            rows: {$sum: 1},
            tokens: {$sum: '$totalTokens'},
            credits: {$sum: '$credits'},
        }},
    ])
    const byRole = {}
    let tokens = 0
    let credits = 0
    let count = 0
    for (const r of rows) {
        const key = r._id || 'unknown'
        byRole[key] = {rows: r.rows, tokens: r.tokens, credits: Math.round(r.credits * 1e6) / 1e6}
        tokens += r.tokens || 0
        credits += r.credits || 0
        count += r.rows || 0
    }
    return {rows: count, tokens, credits: Math.round(credits * 1e6) / 1e6, byRole}
}

export default { getUserDailyUsage, getTreeUsage }
