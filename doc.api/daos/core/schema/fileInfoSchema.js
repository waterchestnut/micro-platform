/**
 * @fileOverview 文件信息的结构
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from "../enum/StatusEnum.js"
import Tag from "../definition/Tag.js"
import SourceTypeEnum from "../enum/SourceTypeEnum.js"
import StoreTypeEnum from "../enum/StoreTypeEnum.js"
import Operator from "../definition/Operator.js"

const Schema = mongoose.Schema
const tools = doc.tools

/**
 * @description 定义fileInfo的结构
 * @author xianyang
 * @property {String} fileCode 唯一标识
 * @property {String} fileName 文件名
 * @property {String} filePath 文件在minio中的路径
 * @property {String} fileHashCode 文件的hash值
 * @property {String} fileExt 文件后缀
 * @property {Number} fileSize 文件大小（byte）
 * @property {String} sourceType 文件来源：参见SourceTypeEnum
 * @property {String} storeType 文件存储类型：参见StoreTypeEnum
 * @property {String} thumbnailUrl 文件缩略图
 * @property {String} srcFileCode 转换的文件对应的原文件标识
 * @property {String} minioCode 在minio中存储的节点配置
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String} encoding 编码方式
 * @property {String} mimetype MIME类型
 * @property {Schema.Types.Mixed} extInfo 扩展信息
 * @property {Schema.Types.Mixed} operator 上传文件的用户，参加Operator
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const fileInfoSchema = new Schema({
    fileCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '文件标识',
        required: true
    },
    fileName: {type: String, description: '文件名称'},
    filePath: {type: String, description: '文件路径'},
    fileHashCode: {type: String, description: 'hash值'},
    fileExt: {type: String, description: '文件后缀'},
    fileSize: {type: Number, description: '文件大小'},
    sourceType: {type: String, default: 'upload', description: '文件来源', enum: SourceTypeEnum.toValues()},
    storeType: {type: String, default: 'random', description: '文件存储类型', enum: StoreTypeEnum.toValues()},
    thumbnailUrl: {type: String, description: '文件缩略图'},
    srcFileCode: {type: String, description: '原文件标识'},
    minioCode: {type: String, description: 'minio标识'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    encoding: {type: String, description: '编码方式'},
    mimetype: {type: String, description: 'MIME类型'},
    extInfo: {type: Object, description: '扩展信息'},
    operator: {type: Operator, description: '上传者'},
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
fileInfoSchema.index({insertTime: 1})
fileInfoSchema.index({updateTime: 1})
fileInfoSchema.index({fileCode: 1})
fileInfoSchema.index({filePath: 1})
fileInfoSchema.index({fileHashCode: 1})
fileInfoSchema.index({fileExt: 1})
fileInfoSchema.index({sourceType: 1})
fileInfoSchema.index({minioCode: 1})
fileInfoSchema.index({'operator.userCode': 1})
fileInfoSchema.index({'tags.key': 1})
fileInfoSchema.index({'tags.value': 1})

export default fileInfoSchema