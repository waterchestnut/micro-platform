/**
 * @fileOverview 统计消息信息的结构
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from "../enum/StatusEnum.js"
import Tag from "../definition/Tag.js"
import Operator from '../definition/Operator.js'

const Schema = mongoose.Schema
const tools = statistic.tools

/**
 * @description 定义msgInfo的结构
 * @author xianyang
 * @property {String} msgCode 唯一标识
 * @property {String} operateType 操作类型
 * @property {String} title 消息标题
 * @property {String} sysCode 日志发生的系统标识
 * @property {String} sysName 日志发生的系统名称
 * @property {String} clientCode 第三方应用标识
 * @property {String} clientName 第三方应用名称
 * @property {Number} browseTime 日期记录的时间戳
 * @property {Schema.Types.Mixed} content 详细的日志信息
 * @property {String} ip 记录日志的客户端IP
 * @property {String} url 浏览器端：当前URL
 * @property {String} lang 浏览器端：headers['accept-language']
 * @property {String} referrer 浏览器端：headers['referrer']
 * @property {String} userAgent 浏览器端：headers['user-agent']
 * @property {String} cookieId 浏览器端：cookies['param-cookieId']
 * @property {Schema.Types.Mixed} operator 操作者，参见Operator
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const msgInfoSchema = new Schema({
    msgCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '统计消息标识',
        required: true
    },
    operateType: {type: String, description: '操作类型'},
    title: {type: String, description: '消息标题'},
    sysCode: {type: String, description: '日志发生的系统标识'},
    sysName: {type: String, description: '日志发生的系统名称'},
    clientCode: {type: String, description: '第三方应用标识'},
    clientName: {type: String, description: '第三方应用名称'},
    browseTime: {type: Number, description: '日期记录的时间戳'},
    content: {type: Object, description: '详细的日志信息'},
    operator: {type: Operator, description: '操作者'},
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
msgInfoSchema.index({insertTime: 1})
msgInfoSchema.index({updateTime: 1})
msgInfoSchema.index({msgCode: 1})
msgInfoSchema.index({operateType: 1})
msgInfoSchema.index({'operator.userCode': 1})
msgInfoSchema.index({'tags.key': 1})
msgInfoSchema.index({'tags.value': 1})

export default msgInfoSchema