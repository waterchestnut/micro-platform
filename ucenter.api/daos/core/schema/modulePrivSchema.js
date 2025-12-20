/**
 * @fileOverview 功能模块权限的结构
 * @author xianyang 2024/5/21
 * @module
 */

import mongoose from 'mongoose'
import PrivVerbEnum from '../enum/PrivVerbEnum.js'
import StatusEnum from '../enum/StatusEnum.js'
import AuthTypeEnum from '../enum/AuthTypeEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义modulePriv的结构
 * @author xianyang
 * @property {String} modulePrivCode 唯一标识
 * @property {String} modulePrivName 模块权限名称
 * @property {String} moduleCode 模块标识
 * @property {String} privVerb 权限动作：参见PrivVerbEnum
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} authType 授权类型：参见AuthTypeEnum
 * @property {String} clientCode 所属应用标识
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const modulePrivSchema = new Schema({
    modulePrivCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '模块权限标识',
        required: true
    },
    modulePrivName: {type: String, description: '模块权限名称', required: true},
    moduleCode: {type: String, description: '模块标识', required: true},
    privVerb: {type: String, default: 'browse', description: '权限动作', required: true, enum: PrivVerbEnum.toValues()},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    authType: {type: Number, default: 0, description: '授权类型', enum: AuthTypeEnum.toValues()},
    clientCode: {type: String, description: '所属应用标识'},
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
modulePrivSchema.index({insertTime: 1})
modulePrivSchema.index({updateTime: 1})
modulePrivSchema.index({modulePrivCode: 1})

export default modulePrivSchema