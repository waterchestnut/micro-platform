/**
 * @fileOverview 知识库加入申请的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义加入申请的结构
 * @property {String} applicationCode 申请标识
 * @property {String} userCode 申请人标识
 * @property {String} realName 申请人姓名
 * @property {Number} status 申请状态：0-待审批，1-已同意，2-已拒绝
 * @property {Date} insertTime 申请时间
 * @property {Date} handleTime 处理时间
 */
export default new Schema({
    applicationCode: {type: String, description: '申请标识'},
    userCode: {type: String, description: '申请人标识'},
    realName: {type: String, description: '申请人姓名'},
    status: {type: Number, default: 0, description: '申请状态：0-待审批，1-已同意，2-已拒绝'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '申请时间'
    },
    handleTime: {type: Date, description: '处理时间'},
}, {_id: false})
