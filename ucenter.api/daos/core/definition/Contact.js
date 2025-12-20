/**
 * @fileOverview 联系人的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义Contact的结构
 * @author xianyang
 * @property {String} realName 姓名
 * @property {String} mobile 手机号
 * @property {String} phone 固定电话
 * @property {String} postcode 邮编
 * @property {String} email 邮箱
 */
export default new Schema({
    realName: {type: String, description: '姓名'},
    mobile: {type: String, description: '手机号'},
    phone: {type: String, description: '固定电话'},
    postcode: {type: String, description: '邮编'},
    email: {type: String, description: '邮箱'},
})