/**
 * @fileOverview 桌面小组件的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import Operator from '../definition/Operator.js'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义widget的结构
 * @author xianyang
 * @property {String} widgetCode 唯一标识
 * @property {String} clientCode 所属应用标识
 * @property {String} widgetName 小组件名称
 * @property {String} logoUrl 小组件的图标地址
 * @property {String} apiUrl 获取小组件内容的接口地址，该地址可以是绝对地址（需要支持跨域请求），也可以是相对地址（网关代理后的api地址）
 * @property {String} miniApiUrl 获取小组件内容的接口地址（小程序使用的代理后的地址），该地址只允许相对地址
 * @property {String} pcRedirectUrl PC端前端默认跳转地址
 * @property {String} miniRedirectUrl 小程序端前端默认跳转地址
 * @property {String} description 小组件描述
 * @property {Number} order 小组件在平台展示的顺序（值越小排序越靠前）
 * @property {Boolean} default2Home 是否默认显示在首页
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed} operator 小组件创建者
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const widgetSchema = new Schema({
    widgetCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '小组件标识',
        required: true
    },
    clientCode: {type: String, description: '所属应用标识', required: true},
    widgetName: {type: String, description: '小组件名称'},
    logoUrl: {type: String, description: '小组件图标'},
    apiUrl: {type: String, description: '获取小组件内容的接口地址'},
    miniApiUrl: {type: String, description: '获取小组件内容的接口地址（小程序使用的代理后的地址），该地址只允许相对地址'},
    pcRedirectUrl: {type: String, description: 'PC端前端默认跳转地址'},
    miniRedirectUrl: {type: String, description: '小程序端前端默认跳转地址'},
    description: {type: String, description: '小组件描述'},
    order: {type: Number, default: 0, description: '排序'},
    default2Home: {type: Boolean, default: true, description: '是否默认显示在首页'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    operator: {type: Operator, description: '小组件创建者'},
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
widgetSchema.index({insertTime: 1})
widgetSchema.index({updateTime: 1})
widgetSchema.index({widgetCode: 1})
widgetSchema.index({'operator.userCode': 1})

export default widgetSchema