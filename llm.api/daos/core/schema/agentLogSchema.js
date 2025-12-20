/**
 * @fileOverview 智能体任务执行日志的结构
 * @author xianyang 2025/9/6
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义agentLog的结构
 * @author xianyang
 * @property {String} logCode 唯一标识
 * @property {String} agentCode 智能体标识
 * @property {String[]} agentCodePath 智能体标识路径，从顶层智能体到该智能体本身
 * @property {String} group 日志分组
 * @property {String} content 日志内容
 * @property {Schema.Types.Mixed} operator 创建者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Schema.Types.Mixed} extInfo 日志的扩展信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const agentLogSchema = new Schema({
    logCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '日志标识',
        required: true
    },
    agentCode: {type: String, description: '智能体标识'},
    agentCodePath: {type: [String], description: '智能体标识路径'},
    group: {type: String, description: '日志分组'},
    content: {type: String, description: '日志内容'},
    operator: {type: Object, description: '创建者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    extInfo: {type: Object, description: '日志的扩展信息'},
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
agentLogSchema.index({insertTime: 1})
agentLogSchema.index({updateTime: 1})
agentLogSchema.index({logCode: 1})
agentLogSchema.index({agentCode: 1})
agentLogSchema.index({agentCodePath: 1})
agentLogSchema.index({'operator.userCode': 1})
agentLogSchema.index({'tags.key': 1})
agentLogSchema.index({'tags.value': 1})

export default agentLogSchema