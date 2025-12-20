/**
 * @fileOverview 用户首页应用排布的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义homeClient的结构
 * @author xianyang
 * @property {String} homeClientCode 唯一标识
 * @property {String} clientCode 应用标识
 * @property {Number} order 应用排布的顺序（值越小排序越靠前）
 * @property {String} userCode 排布的用户
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const homeClientSchema = new Schema({
    homeClientCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '排布标识',
        required: true
    },
    clientCode: {type: String, description: '应用标识', required: true},
    order: {type: Number, description: '排序'},
    userCode: {type: String, description: '排布的用户'},
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
homeClientSchema.index({insertTime: 1})
homeClientSchema.index({updateTime: 1})
homeClientSchema.index({clientCode: 1})

export default homeClientSchema