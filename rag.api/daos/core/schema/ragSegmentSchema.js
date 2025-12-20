/**
 * @fileOverview 知识库材料分段的结构
 * @author xianyang 2025/6/3
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import Operator from '../definition/Operator.js'
import UsageEnum from '../enum/UsageEnum.js'
import HandleStatusEnum from '../enum/HandleStatusEnum.js'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义ragSegment的结构
 * @author xianyang
 * @property {String} ragSegmentCode 唯一标识
 * @property {String} ragCode 知识库标识
 * @property {String} ragMaterialCode 材料标识
 * @property {String} content 分段文本
 * @property {Number} position 分段所在材料所有分段中的序号
 * @property {Number} wordCount 分段的字符数量
 * @property {Number} tokens 分段的tokens数量
 * @property {String} language 材料的语言
 * @property {Schema.Types.Mixed} operator 材料所有者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Number} usage 材料使用情况，参加UsageEnum
 * @property {Number} handleStatus 数据处理状态：参见HandleStatusEnum
 * @property {String} handleError 数据处理出错信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const ragSegmentSchema = new Schema({
    ragSegmentCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '分段标识',
        required: true
    },
    ragCode: {type: String, description: '知识库标识'},
    ragMaterialCode: {type: String, description: '材料标识'},
    content: {type: String, required: true, description: '分段文本'},
    position: {type: Number, default: 1, description: '分段位置序号'},
    wordCount: {type: Number, default: 1, description: '分段的字符数量'},
    tokens: {type: Number, default: 1, description: '分段的tokens数量'},
    language: {type: String, description: '材料的语言'},
    operator: {type: Operator, description: '材料所有者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    usage: {type: Number, default: 0, description: '材料使用情况', enum: UsageEnum.toValues()},
    handleStatus: {type: Number, default: 0, description: '数据处理状态', enum: HandleStatusEnum.toValues()},
    handleError: {type: String, description: '数据处理出错信息'},
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
ragSegmentSchema.index({insertTime: 1})
ragSegmentSchema.index({updateTime: 1})
ragSegmentSchema.index({ragSegmentCode: 1})
ragSegmentSchema.index({ragCode: 1})
ragSegmentSchema.index({ragMaterialCode: 1})
ragSegmentSchema.index({status: 1})
ragSegmentSchema.index({handleStatus: 1})
ragSegmentSchema.index({'operator.userCode': 1})
ragSegmentSchema.index({'tags.key': 1})
ragSegmentSchema.index({'tags.value': 1})

export default ragSegmentSchema