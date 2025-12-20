/**
 * @fileOverview 知识库材料的结构
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import RagTypeEnum from '../enum/RagTypeEnum.js'
import UsageEnum from '../enum/UsageEnum.js'
import Operator from '../definition/Operator.js'
import MaterialDetail from '../definition/MaterialDetail.js'
import FileInfo from '../definition/FileInfo.js'
import HandleStatusEnum from '../enum/HandleStatusEnum.js'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义ragMaterial的结构
 * @author xianyang
 * @property {String} ragMaterialCode 唯一标识
 * @property {String} ragType 知识库类型，参加RagTypeEnum
 * @property {String} physicalPath 材料物理路径
 * @property {String} format 材料格式
 * @property {Schema.Types.Mixed[]} details 材料的文本数据信息，参见MaterialDetail
 * @property {Schema.Types.Mixed} metas 扩展元数据信息
 * @property {String} ragCode 知识库标识
 * @property {Number} usage 材料使用情况，参加UsageEnum
 * @property {Schema.Types.Mixed} operator 材料添加者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String} resCode 对应资源库中的资源唯一标识
 * @property {String} resTitle 资源标题
 * @property {String} resOriginalUrl 资源原文链接
 * @property {String} description 材料特别描述
 * @property {Schema.Types.Mixed[]} fileList 上传的文件材料，参见FileInfo
 * @property {Number} handleStatus 数据处理状态：参见HandleStatusEnum
 * @property {String} handleError 数据处理出错信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const ragMaterialSchema = new Schema({
    ragMaterialCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '材料标识',
        required: true
    },
    ragType: {type: String, default: 'builtIn', description: '知识库类型', enum: RagTypeEnum.toValues()},
    physicalPath: {type: String, description: '材料物理路径'},
    format: {type: String, description: '材料格式'},
    details: {type: [MaterialDetail], description: '材料的文本数据信息'},
    metas: {type: Object, description: '扩展元数据'},
    ragCode: {type: String, description: '知识库标识'},
    usage: {type: Number, default: 0, description: '材料使用情况', enum: UsageEnum.toValues()},
    operator: {type: Operator, description: '材料添加者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    resCode: {type: String, description: '资源标识'},
    resTitle: {type: String, description: '资源标题'},
    resOriginalUrl: {type: String, description: '资源原文链接'},
    description: {type: String, description: '材料特别描述'},
    fileList: {type: [FileInfo], description: '上传的文件材料'},
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
ragMaterialSchema.index({insertTime: 1})
ragMaterialSchema.index({updateTime: 1})
ragMaterialSchema.index({ragMaterialCode: 1})
ragMaterialSchema.index({ragCode: 1})
ragMaterialSchema.index({usage: 1})
ragMaterialSchema.index({status: 1})
ragMaterialSchema.index({handleStatus: 1})
ragMaterialSchema.index({'operator.userCode': 1})
ragMaterialSchema.index({'tags.key': 1})
ragMaterialSchema.index({'tags.value': 1})

export default ragMaterialSchema