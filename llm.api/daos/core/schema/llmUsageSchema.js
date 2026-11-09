/**
 * @fileOverview 模型用量账本的结算
 * @module daos/core/schema/llmUsageSchema
 * @description
 * §14 的"自有账本"落库形态：**一行 = 一个 run（一条 message）的模型用量**。
 *
 * 为什么不塞进 `message.extInfo` 就完事：
 * - `message` 平均 32.9 KB/条，按天聚合等于在业务大表上做全表扫；
 * - 配额、预算、告警都是**按 userCode/channel/day 的时序聚合**，需要窄表；
 * - 而且 §2E-4 那类越权读取的风险，窄表不暴露任何用户内容。
 *
 * 口径遵循两条已定的决策：
 * - **D41**：主指标是 `billablePromptTokens`（= prompt - cached，这部分全价），不是命中率；
 * - **D42**：`hasUsage` 单独成列——"上游回了 0"和"上游没回"是两种不同的故障，
 *   混在一起会让看板把"读不到 usage"当成"全部命中缓存"。
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema

/**
 * @description 构造llmUsage的结构
 * @property {String} messageCode 本轮消息标识（与 message 一对一）
 * @property {String} conversationCode 会话标识
 * @property {String} userCode 归属用户（个人维度预算用它）
 * @property {String} channel 频道
 * @property {String} llmModel 模型档位
 * @property {String} day 归属日（UTC yyyy-mm-dd，账本的主聚合维度）
 * @property {Number} modelCalls 本 run 的模型调用次数（含无工具收尾补落）
 * @property {Number} promptTokens 输入 token 合计
 * @property {Number} completionTokens 输出 token 合计
 * @property {Number} totalTokens 总 token 合计
 * @property {Number} cachedTokens 命中缓存的输入 token
 * @property {Number} billablePromptTokens 非缓存输入 token（D41 主指标）
 * @property {Number} reasoningTokens 推理输出 token（单列，按输出费率计费）
 * @property {Boolean} hasUsage 上游是否真的回了 usage
 * @property {String} callAlert 调用次数告警级别：ok|warn|critical
 * @property {String} loopExit 主循环退出方式（break/exhausted/…），循环失控的旁证
 * @property {String} progress 本轮落库进度
 * @property {Number} latencyMs 本轮端到端耗时
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最后更新时间
 * @returns {Schema} schema 实例
 */
const llmUsageSchema = new Schema({
    messageCode: {type: String, description: '本轮消息标识'},
    conversationCode: {type: String, description: '会话标识'},
    userCode: {type: String, description: '归属用户'},
    channel: {type: String, description: '频道'},
    llmModel: {type: String, description: '模型档位'},
    day: {type: String, description: '归属日 yyyy-mm-dd'},
    modelCalls: {type: Number, default: 0, description: '本 run 模型调用次数'},
    promptTokens: {type: Number, default: 0},
    completionTokens: {type: Number, default: 0},
    totalTokens: {type: Number, default: 0},
    cachedTokens: {type: Number, default: 0},
    billablePromptTokens: {type: Number, default: 0, description: '非缓存输入 token（主指标）'},
    reasoningTokens: {type: Number, default: 0},
    hasUsage: {type: Boolean, default: false, description: '上游是否真的回了 usage'},
    callAlert: {type: String, default: 'ok', description: '调用次数告警：ok|warn|critical'},
    /**
     * PR-0.5：上游重试与换档留痕。四列都是"看板上必须能区分慢与抖"的最小集：
     * - `upstreamAttempts` 本 run 真正发起过几次上游调用（含重试）；
     * - `upstreamRetried` 其中属于重试的次数（= attempts - 首轮），成本就乘在这里；
     * - `fallbackFrom`/`fallbackTo` 换档的来龙去脉；不换档就留空。
     *
     * 为什么单列而不塞进 extInfo：**"重试花了多少钱"是要按天/按频道聚合的问题**，
     * 塞在大文档里就没法聚合，而这张表存在的理由正是窄表可聚合（见文件头）。
     */
    upstreamAttempts: {type: Number, default: 0, description: '本 run 发起上游调用的次数（含重试）'},
    upstreamRetried: {type: Number, default: 0, description: '其中属于重试的次数'},
    fallbackFrom: {type: String, default: '', description: '换档前的档位 key（未换为空）'},
    fallbackTo: {type: String, default: '', description: '换档后的档位 key（未换为空）'},
    loopExit: {type: String, default: '', description: '主循环退出方式'},
    progress: {type: String, default: '', description: '本轮进度'},
    latencyMs: {type: Number, default: 0},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '创建时间',
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最后更新时间',
    },
})

/** 一个 run 一行：重发/重试都覆盖，不产生第二行 */
llmUsageSchema.index({messageCode: 1}, {unique: true})
/** 账本主查询：某用户某天用了多少 */
llmUsageSchema.index({userCode: 1, day: -1})
/** 频道维度预算与分账 */
llmUsageSchema.index({channel: 1, day: -1})
/** 告警巡检：只看非 ok 的 run */
llmUsageSchema.index({callAlert: 1, insertTime: -1})
/** 会话维度下钻 */
llmUsageSchema.index({conversationCode: 1})

export default llmUsageSchema
