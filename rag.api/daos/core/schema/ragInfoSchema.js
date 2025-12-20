/**
 * @fileOverview 知识库的结构
 * @author xianyang 2025/4/21
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import RagTypeEnum from '../enum/RagTypeEnum.js'
import RagPermissionEnum from '../enum/RagPermissionEnum.js'
import Operator from '../definition/Operator.js'
import Member from '../definition/Member.js'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义ragInfo的结构
 * @author xianyang
 * @property {String} ragCode 知识库标识
 * @property {String} ragType 知识库类型，参加RagTypeEnum
 * @property {String} title 知识库标题
 * @property {String} description 知识库描述
 * @property {Schema.Types.Mixed} metas 扩展元数据信息
 * @property {Schema.Types.Mixed} operator 知识库所有者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String} embeddingModelProvider 向量模型提供商
 * @property {String} embeddingModelId 向量模型ID
 * @property {String} permission 召回权限，参加RagPermissionEnum
 * @property {String[]} permissionDepartmentCodes 能召回的部门标识列表，当召回权限为直属部门成员可用、部门及下属部门成员可用时使用
 * @property {Schema.Types.Mixed[]} members 成员，参见Member
 * @property {Number} needTrans 是否需要把非中文的材料翻译为中文，0-不需要，1-需要
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const ragInfoSchema = new Schema({
    ragCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '知识库标识',
        required: true
    },
    title: {type: String, description: '知识库标题'},
    description: {type: String, description: '知识库描述'},
    ragType: {type: String, default: 'builtIn', description: '知识库类型', enum: RagTypeEnum.toValues()},
    metas: {type: Object, description: '扩展元数据'},
    operator: {type: Operator, description: '知识库所有者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    embeddingModelProvider: {type: String, default: 'xinference', description: '向量模型提供商'},
    embeddingModelId: {type: String, default: 'bge-m3', description: '向量模型ID'},
    permission: {type: String, default: 'member', description: '召回权限', enum: RagPermissionEnum.toValues()},
    permissionDepartmentCodes: {type: [String], default: [], description: '能召回的部门标识列表'},
    members: {type: [Member], description: '成员'},
    needTrans: {type: Number, default: 0, description: '是否需要把非中文的材料翻译为中文'},
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
ragInfoSchema.index({insertTime: 1})
ragInfoSchema.index({updateTime: 1})
ragInfoSchema.index({ragCode: 1})
ragInfoSchema.index({status: 1})
ragInfoSchema.index({'operator.userCode': 1})
ragInfoSchema.index({'tags.key': 1})
ragInfoSchema.index({'tags.value': 1})

export default ragInfoSchema