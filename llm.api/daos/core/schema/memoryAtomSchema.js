/**
 * @fileOverview 记忆原子（L2）的结构
 * @module daos/core/schema/memoryAtomSchema
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import MemoryStatusEnum from '../enum/MemoryStatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryAtom的结构
 * @property {String} atomCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} workspaceId 沙箱工作区标识，Phase 4 启用
 * @property {String} kind 事实类别
 * @property {String} content 事实正文，受索引侧长度约束
 * @property {String} headline 用于向量索引的摘要句
 * @property {String} topic 主题标签
 * @property {String[]} topics 主题链，替代 root-branch-leaf 的组织视图
 * @property {String} parentTopic 上级主题
 * @property {Schema.Types.Mixed[]} entities 涉及实体
 * @property {Number} confidence 置信度 0-1
 * @property {Schema.Types.Mixed[]} evidence 证据引用，缺证据的原子不生效
 * @property {String} source 来源：user_save|manual_doc|promoted|auto
 * @property {String} state 生命周期，参见MemoryStatusEnum
 * @property {String} supersededBy 被哪个原子替代
 * @property {String[]} mergedFrom 由哪些原子合并而来
 * @property {String} ragMaterialCode 索引侧材料标识
 * @property {String} ragSegmentCode 索引侧分段标识，承载全文
 * @property {Date} indexedAt 最后一次同步到检索索引的时间
 * @property {Number} hitCount 被召回命中的次数
 * @property {Date} lastHitAt 最后一次命中时间
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryAtomSchema = new Schema({
    atomCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '原子标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    workspaceId: {type: String, description: '沙箱工作区标识，Phase 4 启用'},
    kind: {
        type: String,
        default: 'fact',
        description: '事实类别',
        enum: ['fact', 'preference', 'decision', 'profile', 'episode', 'entity']
    },
    content: {type: String, description: '事实正文'},
    headline: {type: String, description: '用于向量索引的摘要句'},
    topic: {type: String, description: '主题标签'},
    topics: {type: [String], description: '主题链'},
    parentTopic: {type: String, description: '上级主题'},
    entities: {type: [Object], description: '涉及实体'},
    confidence: {type: Number, default: 0, description: '置信度'},
    evidence: {type: [Object], description: '证据引用'},
    source: {type: String, default: 'auto', description: '来源', enum: ['user_save', 'manual_doc', 'promoted', 'auto']},
    state: {type: String, default: 'active', description: '生命周期', enum: MemoryStatusEnum.toValues()},
    supersededBy: {type: String, description: '被替代到的原子标识'},
    mergedFrom: {type: [String], description: '合并来源的原子标识'},
    ragMaterialCode: {type: String, description: '索引侧材料标识'},
    ragSegmentCode: {type: String, description: '索引侧分段标识'},
    indexedAt: {type: Date, description: '最后一次同步索引时间'},
    hitCount: {type: Number, default: 0, description: '召回命中次数'},
    lastHitAt: {type: Date, description: '最后一次命中时间'},
    operator: {type: Object, description: '操作人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
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
memoryAtomSchema.index({atomCode: 1}, {unique: true})
memoryAtomSchema.index({userCode: 1, channel: 1, state: 1, confidence: -1})
memoryAtomSchema.index({userCode: 1, channel: 1, topic: 1})
memoryAtomSchema.index({supersededBy: 1})
memoryAtomSchema.index({ragSegmentCode: 1})
memoryAtomSchema.index({'entities.entityCode': 1})
memoryAtomSchema.index({'tags.key': 1})
memoryAtomSchema.index({'tags.value': 1})
/* Mongo 侧为权威存储，长期保留，不设 TTL */

export default memoryAtomSchema
