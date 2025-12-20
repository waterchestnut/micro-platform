/**
 * @fileOverview 作者的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义作者的结构
 * @author xianyang
 * @property {String} userCode 用户标识
 * @property {String} realName 姓名
 */
export default new Schema({
    userCode: {type: String, description: '用户标识'},
    realName: {type: String, description: '姓名'},
})