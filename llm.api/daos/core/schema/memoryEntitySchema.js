/**
 * @fileOverview 记忆实体页（L3）的结构
 * @module daos/core/schema/memoryEntitySchema
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryEntity的结构
 * @property {String} entityCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} name 实体规范名
 * @property {String[]} aliases 别名，用于实体对齐
 * @property {String} headline 用于向量索引的一句话摘要
 * @property {String} content 聚合后的实体页正文
 * @property {String[]} atomCodes 关联的原子标识
 * @property {Boolean} dirty 是否需要重新生成
 * @property {Number} dirtyCount 自上次生成以来累积变更的原子数
 * @property {Date} regeneratedAt 最后一次重生时间
 * @property {String} ragSegmentCode 索引侧分段标识
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryEntitySchema = new Schema({
    entityCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '实体标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    name: {type: String, description: '实体规范名'},
    aliases: {type: [String], description: '别名'},
    headline: {type: String, description: '摘要句'},
    content: {type: String, description: '实体页正文'},
    atomCodes: {type: [String], description: '关联原子标识'},
    dirty: {type: Boolean, default: false, description: '是否需要重新生成'},
    dirtyCount: {type: Number, default: 0, description: '累积变更原子数'},
    regeneratedAt: {type: Date, description: '最后一次重生时间'},
    ragSegmentCode: {type: String, description: '索引侧分段标识'},
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
memoryEntitySchema.index({entityCode: 1}, {unique: true})
memoryEntitySchema.index({userCode: 1, channel: 1, name: 1})
memoryEntitySchema.index({userCode: 1, channel: 1, dirty: 1})

export default memoryEntitySchema
