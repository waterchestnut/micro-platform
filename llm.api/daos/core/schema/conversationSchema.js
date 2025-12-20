/**
 * @fileOverview 大模型会话的结构
 * @author xianyang 2025/10/14
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import ConversationTypeEnum from '../enum/ConversationTypeEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义conversation的结构
 * @author xianyang
 * @property {String} conversationCode 唯一标识
 * @property {String} title 会话标题
 * @property {String} channel 会话所属频道（一个子应用允许开通多个频道，频道标识建议以子应用的标识开头，例如文献助手命名为：pdfviewer_literature）
 * @property {String} channelGroup 会话在频道内的分组
 * @property {String} conversationType 会话类型：参见ConversationTypeEnum
 * @property {String} llmModel 默认大模型配置节点
 * @property {Schema.Types.Mixed} operator 会话所属人
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const conversationSchema = new Schema({
    conversationCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '会话标识',
        required: true
    },
    title: {type: String, description: '会话标题'},
    channel: {type: String, description: '会话所属频道'},
    channelGroup: {type: String, description: '会话在频道内的分组'},
    conversationType: {type: String, default: 'chat', description: '会话类型', enum: ConversationTypeEnum.toValues()},
    llmModel: {type: String, description: '大模型配置节点'},
    operator: {type: Object, description: '会话所属人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
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
conversationSchema.index({insertTime: 1})
conversationSchema.index({updateTime: 1})
conversationSchema.index({conversationCode: 1})
conversationSchema.index({'operator.userCode': 1})
conversationSchema.index({'tags.key': 1})
conversationSchema.index({'tags.value': 1})
conversationSchema.index({channel: 1})
conversationSchema.index({channel: 1, channelGroup: 1})

export default conversationSchema