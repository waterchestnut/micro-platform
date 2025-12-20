/**
 * @fileOverview 标签的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义Tag的结构
 * @author xianyang
 * @property {String} key 键名
 * @property {String} value 键值
 */
export default new Schema({
    key: {type: String, description: '键名'},
    value: {type: String, description: '键值'},
})