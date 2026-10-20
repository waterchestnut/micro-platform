/**
 * @fileOverview 记忆命名空间注册表
 * @module daos/core/schema/memoryNamespaceSchema
 * @description 命名空间 = userCode + channel（workspaceId 预留）。
 * 硬隔离边界落在检索侧：每个命名空间对应独立的 ragCode，越权召会在 filter 层就不可能命中。
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryNamespace的结构
 * @property {String} namespaceCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} workspaceId 沙箱工作区标识，Phase 4 启用
 * @property {String} ragCode 检索侧知识库标识
 * @property {String} ragMaterialCode 检索侧容器材料标识
 * @property {String} embeddingModelId 该命名空间使用的向量模型
 * @property {Number} atomCount 生效原子数，供容量核对与空命名空间回收
 * @property {Date} lastActiveAt 最后一次读写时间
 * @property {Schema.Types.Mixed} operator 创建人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryNamespaceSchema = new Schema({
    namespaceCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '命名空间标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    workspaceId: {type: String, description: '沙箱工作区标识，Phase 4 启用'},
    ragCode: {type: String, description: '检索侧知识库标识'},
    ragMaterialCode: {type: String, description: '检索侧容器材料标识'},
    embeddingModelId: {type: String, description: '向量模型标识'},
    atomCount: {type: Number, default: 0, description: '生效原子数'},
    lastActiveAt: {type: Date, description: '最后活动时间'},
    operator: {type: Object, description: '创建人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '插入时间'
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最近更新时间'
    },
})

/**
 * @description 索引
 */
memoryNamespaceSchema.index({namespaceCode: 1})
memoryNamespaceSchema.index({userCode: 1, channel: 1, workspaceId: 1}, {unique: true})
memoryNamespaceSchema.index({ragCode: 1})
memoryNamespaceSchema.index({lastActiveAt: 1})

export default memoryNamespaceSchema
