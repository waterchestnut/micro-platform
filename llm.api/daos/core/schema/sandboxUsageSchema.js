/**
 * @fileOverview 沙箱用量账本的结构
 * @module daos/core/schema/sandboxUsageSchema
 * @description PR-15 的配额与成本数据来源。一行 = 一台沙箱的完整生命周期，
 * 按 `sandboxId` 唯一（重复上报直接 upsert 覆盖，避免销毁重试写两行）。
 * 为什么要单独一张表而不是塞进 `sessionCheckpoint`：检查点是"模型请求的现场"，
 * 生命周期比沙箱短（7 天 TTL 就回收），而配额要按用户跨天累计。
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 构造sandboxUsage的结构
 * @property {String} sandboxId 沙箱标识（唯一）
 * @property {String} userCode 归属用户，配额按它累计
 * @property {String} conversationCode 会话标识
 * @property {String} channel 频道
 * @property {String} poolRef 池标识；非池模式为空串
 * @property {String} usedFor 用途标记：run-code|skill|agent，便于分账
 * @property {Date} startedAt 建箱时间
 * @property {Date} endedAt 回收时间；未回收为 null
 * @property {Number} seconds 实际占用秒数（配额与价格都用它）
 * @property {Number} price 折算金额，秒数 × 单价
 * @property {String} releaseReason 回收原因：done|error|quota-release
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最后更新时间
 * @author xianyang
 * @returns {Schema} schema 实例
 */
const sandboxUsageSchema = new Schema({
    sandboxId: {type: String, description: '沙箱标识（唯一）'},
    userCode: {type: String, description: '归属用户标识'},
    conversationCode: {type: String, description: '会话标识'},
    channel: {type: String, description: '频道标识'},
    poolRef: {type: String, default: '', description: '池标识，非池模式为空串'},
    usedFor: {type: String, default: 'run-code', description: '用途：run-code|skill|agent'},
    startedAt: {type: Date, description: '建箱时间'},
    endedAt: {type: Date, description: '回收时间，未回收为 null'},
    seconds: {type: Number, default: 0, description: '实际占用秒数'},
    price: {type: Number, default: 0, description: '折算金额（秒 × 单价）'},
    releaseReason: {type: String, default: '', description: '回收原因：done|error|quota-release'},
    operator: {type: Schema.Types.Mixed, description: '操作人'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '创建时间'
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最后更新时间'
    },
})

/** 一台沙箱一行：重复上报走 upsert 覆盖，不会累积多行 */
sandboxUsageSchema.index({sandboxId: 1}, {unique: true})
/** 配额主查询：按用户在时间窗口内累计秒数 */
sandboxUsageSchema.index({userCode: 1, startedAt: -1})
/** 会话级核对与分账 */
sandboxUsageSchema.index({conversationCode: 1})
sandboxUsageSchema.index({usedFor: 1, startedAt: -1})

export default sandboxUsageSchema
