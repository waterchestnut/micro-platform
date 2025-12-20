/**
 * @fileOverview 资源的结构
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import ResTypeEnum from '../enum/ResTypeEnum.js'
import Tag from '../definition/Tag.js'
import Source from '../definition/Source.js'
import FileInfo from '../definition/FileInfo.js'
import ResManageTypeEnum from '../enum/ResManageTypeEnum.js'
import Operator from '../definition/Operator.js'
import RagStatusEnum from '../enum/RagStatusEnum.js'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义resInfo的结构
 * @property {String} resCode 唯一标识
 * @property {String} title 标题
 * @property {String[]} author 作者
 * @property {String} abstract 摘要与简介
 * @property {String} publisher 出版社
 * @property {String} publishDate 出版时间
 * @property {Schema.Types.Mixed} resType 类型
 * @property {Schema.Types.Mixed[]} sources 来源：参见Source
 * @property {String} url 链接
 * @property {Schema.Types.Mixed} operator 创建者
 * @property {String} coverUrl 封面图
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String[]} keywords 关键词
 * @property {Schema.Types.Mixed[]} fileList 上传的文件材料，参见FileInfo
 * @property {String[]} fileHashCodes 文件内容的hash值，文件材料的缓存值，方便筛选
 * @property {String[]} fileExts 文件后缀，文件材料的缓存值，方便筛选
 * @property {String} originalHashCode 源文件的hash值，方便文献解读等的历史数据管理
 * @property {String[]} manageTypes 资源管理类型，参见ResManageTypeEnum
 * @property {String} originalResCode 源资源标识，方便文献解读等的历史数据管理
 * @property {String} ragMaterialCode 资源RAG的材料标识
 * @property {Number} ragStatus 资源RAG的状态：参见RagStatusEnum
 * @property {String} llmChannelGroup 大模型会话频道内的分组
 * @property {String} llmExplain 大模型对资源内容的解读
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 * @property {Date} latestReadTime 最近阅读时间
 */
const resInfoSchema = new Schema({
    resCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '资源标识',
        required: true
    },
    title: {type: String, description: '标题'},
    author: {type: [String], description: '作者'},
    abstract: {type: String, description: '摘要与简介'},
    publisher: {type: String, description: '出版社'},
    publishDate: {type: String, description: '出版时间'},
    resType: {type: String, description: '类型', enum: ResTypeEnum.toValues()},
    sources: {type: [Source], description: '来源'},
    url: {type: String, description: '链接'},
    operator: {type: Operator, description: '创建者'},
    coverUrl: {type: String, description: '封面图'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    keywords: {type: [String], description: '关键词'},
    fileList: {type: [FileInfo], description: '上传的文件材料'},
    fileHashCodes: {type: [String], description: '文件内容的hash值'},
    fileExts: {type: [String], description: '文件后缀'},
    originalHashCode: {type: String, description: '源文件的hash值'},
    manageTypes: {type: [String], default: ['self'], description: '资源管理类型', enum: ResManageTypeEnum.toValues()},
    originalResCode: {type: String, description: '源资源标识'},
    ragMaterialCode: {type: String, description: '资源RAG的材料标识'},
    ragStatus: {type: Number, default: 0, description: '资源RAG的状态', enum: RagStatusEnum.toValues()},
    llmChannelGroup: {type: String, description: '大模型会话频道内的分组'},
    llmExplain: {type: String, description: '大模型对资源内容的解读'},
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
    latestReadTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最近阅读时间'
    },
})

/**
 * @description 索引
 */
resInfoSchema.index({insertTime: 1})
resInfoSchema.index({updateTime: 1})
resInfoSchema.index({resCode: 1})
resInfoSchema.index({resType: 1})
resInfoSchema.index({status: 1})
resInfoSchema.index({'operator.userCode': 1})
resInfoSchema.index({'tags.key': 1})
resInfoSchema.index({'tags.value': 1})
resInfoSchema.index({'sources.sourceKey': 1})
resInfoSchema.index({'fileList.fileCode': 1})
resInfoSchema.index({fileHashCodes: 1})
resInfoSchema.index({fileExts: 1})
resInfoSchema.index({originalHashCode: 1})
resInfoSchema.index({manageTypes: 1})
resInfoSchema.index({latestReadTime: 1})

export default resInfoSchema