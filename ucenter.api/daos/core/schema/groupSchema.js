/**
 * @fileOverview 用户组的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import SchemaEnum from '../enum/SchemaEnum.js'
import Tag from '../definition/Tag.js'
import AuthTypeEnum from '../enum/AuthTypeEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义group的结构
 * @author xianyang
 * @property {String} groupCode 唯一标识
 * @property {String} groupName 用户组名称
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} authType 授权类型：参见AuthTypeEnum
 * @property {String[]} modulePrivCodes 模块权限标识
 * @property {String} orgCode 所属机构
 * @property {String} description 描述备注
 * @property {String[]} schemaCodes 使用模式：参见SchemaEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const groupSchema = new Schema({
    groupCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '用户组标识',
        required: true
    },
    groupName: {type: String, description: '用户组名称', required: true},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    authType: {type: Number, default: 0, description: '授权类型', enum: AuthTypeEnum.toValues()},
    modulePrivCodes: {type: [String], description: '模块权限标识'},
    orgCode: {type: String, description: '所属机构'},
    description: {type: String, description: '描述备注'},
    schemaCodes: {type: [String], default: ['default'], description: '使用模式', enum: SchemaEnum.toValues()},
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
groupSchema.index({insertTime: 1})
groupSchema.index({updateTime: 1})
groupSchema.index({groupCode: 1})

export default groupSchema