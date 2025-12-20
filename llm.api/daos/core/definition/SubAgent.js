/**
 * @fileOverview 子智能体的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'
import AgentHandleStatusEnum from '../enum/AgentHandleStatusEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义SubAgent的结构
 * @author xianyang
 * @property {String} agentCode 子智能体标识
 * @property {Number} handleStatus 执行状态：参见AgentHandleStatusEnum
 */
export default new Schema({
    agentCode: {type: String, description: '子智能体标识'},
    handleStatus: {type: Number, default: 0, description: '执行状态', enum: AgentHandleStatusEnum.toValues()},
})