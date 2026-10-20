/**
 * @fileOverview 记忆候选（L1）的结构
 * @module daos/core/schema/memoryCandidateSchema
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import MemoryStatusEnum from '../enum/MemoryStatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryCandidate的结构
 * @property {String} candidateCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} workspaceId 沙箱工作区标识，Phase 4 启用
 * @property {String[]} eventCodes 抽取来源的事件标识
 * @property {String} content 候选事实文本
 * @property {String} topic 主题标签
 * @property {String} kind 事实类别
 * @property {Schema.Types.Mixed[]} entities 涉及实体
 * @property {Number} confidence 置信度 0-1
 * @property {Schema.Types.Mixed[]} evidence 证据引用，逐条指向事件与原文片段
 * @property {String} state 晋升结果，参见MemoryStatusEnum
 * @property {String} atomCode 晋升后指向的原子标识
 * @property {String} rejectReason 未晋升的原因
 * @property {String} source 来源：auto|user_save|manual_doc
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryCandidateSchema = new Schema({
    candidateCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '候选标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    workspaceId: {type: String, description: '沙箱工作区标识，Phase 4 启用'},
    eventCodes: {type: [String], description: '抽取来源的事件标识'},
    content: {type: String, description: '候选事实文本'},
    topic: {type: String, description: '主题标签'},
    kind: {
        type: String,
        default: 'fact',
        description: '事实类别',
        enum: ['fact', 'preference', 'decision', 'profile', 'episode', 'entity']
    },
    entities: {type: [Object], description: '涉及实体'},
    confidence: {type: Number, default: 0, description: '置信度'},
    evidence: {type: [Object], description: '证据引用'},
    state: {type: String, default: 'review', description: '晋升结果', enum: MemoryStatusEnum.toValues()},
    atomCode: {type: String, description: '晋升后的原子标识'},
    rejectReason: {type: String, description: '未晋升原因'},
    source: {type: String, default: 'auto', description: '来源', enum: ['auto', 'user_save', 'manual_doc']},
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
memoryCandidateSchema.index({candidateCode: 1})
memoryCandidateSchema.index({userCode: 1, channel: 1, state: 1})
memoryCandidateSchema.index({atomCode: 1})
memoryCandidateSchema.index({insertTime: 1}, {expireAfterSeconds: 7 * 24 * 3600})

export default memoryCandidateSchema
