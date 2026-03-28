/**
 * @fileOverview 协议结构
 * @author menglb
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import AgreementTypeEnum from '../enum/AgreementTypeEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义agreement的结构
 * @author menglb
 * @property {String} agreementCode 协议标识
 * @property {String} title 协议标题
 * @property {String} content 协议内容
 * @property {Number} type 协议类型：参见AgreementTypeEnum
 * @property {String} version 协议版本号
 * @property {Number} status 状态：参见StatusEnum
 * @property {Date} effectiveTime 生效时间
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const agreementSchema = new Schema({
    agreementCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '协议标识',
        required: true
    },
    title: {
        type: String,
        description: '协议标题'
    },
    content: {
        type: String,
        description: '协议内容'
    },
    type: {
        type: Number,
        required: true,
        enum: AgreementTypeEnum.toValues(),
        description: '协议类型：参见AgreementTypeEnum'
    },
    version: {
        type: Number,
        required: true,
        description: '协议版本号'
    },
    status: {
        type: Number,
        default: 0,
        enum: StatusEnum.toValues(),
        description: '状态：参见StatusEnum'
    },
    effectiveTime: {
        type: Date,
        description: '生效时间'
    },
    insertTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '创建时间'
    },
    updateTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '更新时间'
    }
})

agreementSchema.index({agreementCode: 1}, {unique: true})
agreementSchema.index({type: 1, status: 1})
agreementSchema.index({version: -1})

export default agreementSchema
