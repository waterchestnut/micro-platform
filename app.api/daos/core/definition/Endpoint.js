/**
 * @fileOverview 应用访问端的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import EndpointTypeEnum from '../enum/EndpointTypeEnum.js'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义Endpoint的结构
 * @author xianyang
 * @property {String} endpointType 访问端类型
 * @property {String} visitPath 访问地址
 * @property {Number} status 状态：参见StatusEnum
 */
export default new Schema({
    endpointType: {type: String, description: '访问端类型', enum: EndpointTypeEnum.toValues()},
    visitPath: {type: String, description: '访问地址'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
})