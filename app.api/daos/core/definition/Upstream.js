/**
 * @fileOverview 应用上游节点的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义Upstream的结构
 * @author xianyang
 * @property {String} host 主机(含端口)
 * @property {String} weight 权重
 */
export default new Schema({
    host: {type: String, description: '主机(含端口)'},
    weight: {type: Number, default: 1, description: '权重'},
})