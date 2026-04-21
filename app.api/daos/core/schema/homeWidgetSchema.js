/**
 * @fileOverview 用户首页小组件排布的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'
import HomeEndpointEnum from '../enum/HomeEndpointEnum.js'
import HomeTypeEnum from '../enum/HomeTypeEnum.js'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义homeWidget的结构
 * @author xianyang
 * @property {String} homeWidgetCode 唯一标识
 * @property {String} widgetCode 小组件标识
 * @property {Number} order 小组件排布的顺序（值越小排序越靠前）
 * @property {String} userCode 排布的用户
 * @property {String} homeEndpoint 首页排布访问端，参见HomeEndpointEnum
 * @property {String} homeType 首页排布类型，参见HomeTypeEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const homeWidgetSchema = new Schema({
    homeWidgetCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '排布标识',
        required: true
    },
    widgetCode: {type: String, description: '小组件标识', required: true},
    order: {type: Number, description: '排序'},
    userCode: {type: String, description: '排布的用户'},
    homeEndpoint: {type: String, default: 'pc', description: '首页排布访问端', enum: HomeEndpointEnum.values},
    homeType: {type: String, description: '首页排布类型', enum: HomeTypeEnum.values},
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
homeWidgetSchema.index({insertTime: 1})
homeWidgetSchema.index({updateTime: 1})
homeWidgetSchema.index({homeWidgetCode: 1})
homeWidgetSchema.index({widgetCode: 1})
homeWidgetSchema.index({userCode: 1})

export default homeWidgetSchema