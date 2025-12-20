/**
 * @fileOverview 大模型会话回答内容的缓存的结构
 * @author xianyang 2025/11/14
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools


/**
 * @description 定义answerCache的结构
 * @author xianyang
 * @property {String} answerCacheCode 唯一标识
 * @property {String} sourceConversationCode 来源会话标识
 * @property {String} sourceMessageCode 来源消息标识
 * @property {String} channel 会话所属频道
 * @property {String} channelCacheKey 频道内附加的缓存标识
 * @property {String} llmModel 大模型配置节点
 * @property {String} query 用户问题
 * @property {String} queryHashCode 用户问题的Hash值
 * @property {String} answer 大模型的输出内容
 * @property {Number} answerTokens 输出Token数量
 * @property {String} answerReasoning 大模型思考过程
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const answerCacheSchema = new Schema({
    answerCacheCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '缓存标识',
        required: true
    },
    sourceConversationCode: {type: String, description: '来源会话标识'},
    sourceMessageCode: {type: String, description: '来源消息标识'},
    channel: {type: String, description: '会话所属频道'},
    channelCacheKey: {type: String, description: '频道内附加的缓存标识'},
    llmModel: {type: String, description: '大模型配置节点'},
    query: {type: String, description: '用户问题'},
    queryHashCode: {type: String, description: '用户问题的Hash值'},
    answer: {type: String, description: '大模型的输出内容'},
    answerTokens: {type: Number, description: '输出Token数量'},
    answerReasoning: {type: String, description: '大模型思考过程'},
    operator: {type: Object, description: '操作人'},
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
answerCacheSchema.index({insertTime: 1})
answerCacheSchema.index({updateTime: 1})
answerCacheSchema.index({answerCacheCode: 1})
answerCacheSchema.index({sourceConversationCode: 1})
answerCacheSchema.index({sourceMessageCode: 1})
answerCacheSchema.index({'operator.userCode': 1})
answerCacheSchema.index({'tags.key': 1})
answerCacheSchema.index({'tags.value': 1})
answerCacheSchema.index({channel: 1})
answerCacheSchema.index({channel: 1, channelCacheKey: 1})
answerCacheSchema.index({channel: 1, channelCacheKey: 1, llmModel: 1, queryHashCode: 1})

export default answerCacheSchema