/**
 * @fileOverview 知识库材料分句的结构
 * @author xianyang 2025/6/3
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import Operator from '../definition/Operator.js'
import UsageEnum from '../enum/UsageEnum.js'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义ragChunk的结构
 * @author xianyang
 * @property {String} ragChunkCode 唯一标识
 * @property {String} ragCode 知识库标识
 * @property {String} ragMaterialCode 材料标识
 * @property {String} ragSegmentCode 分段标识
 * @property {String} content 分句文本
 * @property {Number} position 分句所在分段所有分句中的序号
 * @property {Number} wordCount 分句的字符数量
 * @property {String} language 材料的语言
 * @property {Schema.Types.Mixed} operator 材料所有者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Number} usage 材料使用情况，参加UsageEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const ragChunkSchema = new Schema({
    ragChunkCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '分句标识',
        required: true
    },
    ragCode: {type: String, description: '知识库标识'},
    ragMaterialCode: {type: String, description: '材料标识'},
    ragSegmentCode: {type: String, description: '分段标识'},
    content: {type: String, required: true, description: '分句文本'},
    position: {type: Number, default: 1, description: '分句位置序号'},
    wordCount: {type: Number, default: 1, description: '分句的字符数量'},
    language: {type: String, description: '材料的语言'},
    operator: {type: Operator, description: '材料所有者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    usage: {type: Number, default: 0, description: '材料使用情况', enum: UsageEnum.toValues()},
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
ragChunkSchema.index({insertTime: 1})
ragChunkSchema.index({updateTime: 1})
ragChunkSchema.index({ragChunkCode: 1})
ragChunkSchema.index({ragCode: 1})
ragChunkSchema.index({ragMaterialCode: 1})
ragChunkSchema.index({ragSegmentCode: 1})
ragChunkSchema.index({status: 1})
ragChunkSchema.index({'operator.userCode': 1})
ragChunkSchema.index({'tags.key': 1})
ragChunkSchema.index({'tags.value': 1})

export default ragChunkSchema