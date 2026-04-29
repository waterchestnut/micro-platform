/**
 * @fileOverview 学校平台用户
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义PlatformUser的结构
 * @author xianyang
 * @property {String} userCode 用户标识
 * @property {String} realName 姓名
 * @property {String} platformCode 学校平台标识
 * @property {String} status 状态：0-正常，-1-禁用
 */
export default new Schema({
    userCode: {type: String, description: '用户标识'},
    realName: {type: String, description: '姓名'},
    platformCode: {type: String, description: '学校平台标识'},
    status: {type: Number, default: 0, description: '状态：0-正常，-1-禁用'},
}, {_id: false})