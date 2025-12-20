/**
 * @fileOverview 大模型会话交互消息的结构
 * @author xianyang 2025/10/14
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import MessageProgressEnum from '../enum/MessageProgressEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义message的结构
 * @author xianyang
 * @property {String} messageCode 唯一标识
 * @property {String} conversationCode 会话标识
 * @property {String} channel 会话所属频道
 * @property {String} channelGroup 会话在频道内的分组
 * @property {String} llmModel 大模型配置节点
 * @property {Object} llmParams 大模型自定义参数
 * @property {Object} ragParams 知识库自定义参数
 * @property {String} query 用户问题
 * @property {Object[]} inputs 文档、多媒体等格式的输入内容
 * @property {Object[]} messages 大模型的输入消息列表
 * @property {Number} messageTokens 输入Token数量
 * @property {Number} messagePriceUnit 输入Token单价
 * @property {String} answer 大模型的输出内容
 * @property {Number} answerTokens 输出Token数量
 * @property {Number} answerPriceUnit 输出Token单价
 * @property {String} answerReasoning 大模型思考过程
 * @property {Boolean} answerFromCache 回答内容是否从缓存中读取的
 * @property {String} answerCacheCode 如果是从缓存读取的回答，记录缓存的标识
 * @property {Number} answerFeedback 用户对回答的反馈：-1=不喜欢，0-未反馈，1-喜欢
 * @property {Number} totalPrice 本次消息的总花销
 * @property {String} progress 消息进度：参见MessageProgressEnum
 * @property {String} error 出错信息
 * @property {Schema.Types.Mixed} operator 会话所属人
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Schema.Types.Mixed} extInfo 消息的扩展信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const messageSchema = new Schema({
    messageCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '消息标识',
        required: true
    },
    conversationCode: {type: String, description: '会话标识'},
    channel: {type: String, description: '会话所属频道'},
    channelGroup: {type: String, description: '会话在频道内的分组'},
    llmModel: {type: String, description: '大模型配置节点'},
    llmParams: {type: Object, description: '大模型自定义参数'},
    ragParams: {type: Object, description: '知识库自定义参数'},
    query: {type: String, description: '用户问题'},
    inputs: {type: [Object], description: '格式化的输入内容'},
    messages: {type: [Object], description: '大模型的输入消息列表'},
    messageTokens: {type: Number, description: '输入Token数量'},
    messagePriceUnit: {type: Number, description: '输入Token单价'},
    answer: {type: String, description: '大模型的输出内容'},
    answerTokens: {type: Number, description: '输出Token数量'},
    answerPriceUnit: {type: Number, description: '输出Token单价'},
    answerReasoning: {type: String, description: '大模型思考过程'},
    answerFromCache: {type: Boolean, default: false, description: '回答内容是否从缓存中读取的'},
    answerCacheCode: {type: String, description: '缓存标识'},
    answerFeedback: {type: Number, default: 0, description: '用户对回答的反馈'},
    totalPrice: {type: Number, description: '本次消息的总花销'},
    progress: {type: String, default: 'waiting', description: '消息进度', enum: MessageProgressEnum.toValues()},
    error: {type: String, description: '出错信息'},
    operator: {type: Object, description: '会话所属人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    extInfo: {type: Object, description: '消息的扩展信息'},
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
messageSchema.index({insertTime: 1})
messageSchema.index({updateTime: 1})
messageSchema.index({messageCode: 1})
messageSchema.index({conversationCode: 1})
messageSchema.index({'operator.userCode': 1})
messageSchema.index({'tags.key': 1})
messageSchema.index({'tags.value': 1})
messageSchema.index({channel: 1})
messageSchema.index({channel: 1, channelGroup: 1})

export default messageSchema