/**
 * @fileOverview 记忆原始事件（L0）的结构
 * @module daos/core/schema/memoryEventSchema
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import MemoryStatusEnum from '../enum/MemoryStatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryEvent的结构
 * @property {String} eventCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识，命名空间主键之一
 * @property {String} channel 频道标识，命名空间主键之一
 * @property {String} workspaceId 沙箱工作区标识，Phase 4 才启用，先留空
 * @property {String} conversationCode 来源会话标识
 * @property {String} messageCode 来源消息标识
 * @property {String} role 事件角色：user|assistant|tool
 * @property {String} content 原始文本
 * @property {Number} tokens 文本token估算值
 * @property {Object} provenance 结构化来源标记，采集判定只认它不认关键词
 * @property {Boolean} provenance.runtimeError 是否为运行时失败的合成内容
 * @property {Boolean} provenance.captureExclude 是否被显式排除采集
 * @property {Boolean} provenance.userSaved 是否用户显式要求记住
 * @property {String} state 处理进度，参见MemoryStatusEnum
 * @property {Schema.Types.Mixed[]} extractedCodes 由此事件抽出的候选标识
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryEventSchema = new Schema({
    eventCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '事件标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    workspaceId: {type: String, description: '沙箱工作区标识，Phase 4 启用'},
    conversationCode: {type: String, description: '来源会话标识'},
    messageCode: {type: String, description: '来源消息标识'},
    role: {type: String, description: '事件角色', enum: ['user', 'assistant', 'tool']},
    content: {type: String, description: '原始文本'},
    tokens: {type: Number, description: '文本token估算值'},
    provenance: {
        type: Object,
        description: '结构化来源标记',
        default: function () {
            return {runtimeError: false, captureExclude: false, userSaved: false}
        }
    },
    state: {type: String, default: 'review', description: '处理进度', enum: MemoryStatusEnum.toValues()},
    extractedCodes: {type: [String], description: '抽出的候选标识'},
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
memoryEventSchema.index({eventCode: 1})
memoryEventSchema.index({userCode: 1, channel: 1, insertTime: -1})
memoryEventSchema.index({conversationCode: 1, insertTime: -1})
memoryEventSchema.index({messageCode: 1})
memoryEventSchema.index({state: 1})
memoryEventSchema.index({insertTime: 1}, {expireAfterSeconds: 30 * 24 * 3600})

export default memoryEventSchema
