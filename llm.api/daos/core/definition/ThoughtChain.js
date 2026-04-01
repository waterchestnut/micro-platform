/**
 * @fileOverview 智能体思维链的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'
import MessageProgressEnum from '../enum/MessageProgressEnum.js'
import Tag from './Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义ThoughtChain的结构
 * @author xianyang
 * @property {String} thoughtChainCode 思维链标识
 * @property {String} progress 处理进度：参见MessageProgressEnum
 */
export default  new Schema({
    thoughtChainCode: {type: String, description: '思维链标识'},
    progress: {type: String, default: 'waiting', description: '处理进度', enum: MessageProgressEnum.toValues()},
    title: {type: String, description: '标题'},
    description: {type: String, description: '描述'},
    children: {type: [Object], description: '子思维链', default: []},
    tags: {type: [Tag], description: '标签'},
}, {_id: false})