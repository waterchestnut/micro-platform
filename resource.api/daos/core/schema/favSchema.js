/**
 * @fileOverview 收藏的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义fav的结构
 * @property {String} favCode 收藏标识
 * @property {String} resCode 资源标识
 * @property {String} resType 资源类型
 * @property {String} userCode 用户标识
 * @property {Date} favTime 收藏时间
 * @property {Date} insertTime 插入时间
 * @property {String} sourcePlatform 来源平台
 */
const favSchema = new Schema({
    favCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '收藏标识',
        required: true
    },
    resCode: {
        type: String,
        description: '资源标识',
        required: true
    },
    resType: {
        type: String,
        description: '资源类型',
        required: true
    },
    userCode: {
        type: String,
        description: '用户标识',
        required: true
    },
    favTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '收藏时间'
    },
    sourcePlatform: {
        type: String,
        description: '来源平台'
    },
    insertTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '插入时间'
    },
    updateTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '最近更新时间'
    },
    status: {
        type: Number,
        default: 0,
        description: '状态',
        enum: [0, -1]
    },
    remark: {
        type: String,
        description: '备注'
    }
})

/**
 * @description 索引
 */
favSchema.index({ favCode: 1 })
favSchema.index({ resCode: 1 })
favSchema.index({ userCode: 1 })
favSchema.index({ favTime: -1 })
favSchema.index({ insertTime: -1 })
favSchema.index({ sourcePlatform: 1 })
favSchema.index({ status: 1 })
favSchema.index({ resCode: 1, userCode: 1 }, { unique: true })

export default favSchema