/**
 * @fileOverview 功能模块的结构
 * @author xianyang 2024/5/11
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import AuthTypeEnum from '../enum/AuthTypeEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义module的结构
 * @author xianyang
 * @property {String} moduleCode 唯一标识
 * @property {String} moduleName 模块名称
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} authType 授权类型：参见AuthTypeEnum
 * @property {String} clientCode 所属应用标识
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const moduleSchema = new Schema({
    moduleCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '模块标识',
        required: true
    },
    moduleName: {type: String, description: '模块名称', required: true},
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
moduleSchema.index({insertTime: 1})
moduleSchema.index({updateTime: 1})
moduleSchema.index({moduleCode: 1})

export default moduleSchema