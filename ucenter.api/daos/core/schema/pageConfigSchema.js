/**
 * @fileOverview 页面路由的权限要求等配置信息
 * @author xianyang 2024/4/11
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'
import RequestMethodEnum from '../enum/RequestMethodEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义pageConfig的结构
 * @author xianyang
 * @property {String} pageConfigCode 配置标识
 * @property {String} clientCode 所属应用标识
 * @property {String} name 名称
 * @property {String} path 请求路径
 * @property {String[]} method 请求方法
 * @property {Boolean} auth 是否用户登录才能访问
 * @property {Boolean} clientAuth 是否第三方客户端登录才能访问
 * @property {String[]} privs 登录的用户拥有什么权限才能访问（拥有列表中任何一个权限即可，all-代表只要登录即可访问）
 * @property {String[]} clientPrivs 登录的第三方客户端拥有什么权限才能访问（拥有列表中任何一个权限即可，all-代表只要登录即可访问）
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Number} orderNum 排序（升序）
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const pageConfigSchema = new Schema({
    pageConfigCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '配置标识',
        required: true
    },
    clientCode: {type: String, description: '所属应用标识'},
    name: {type: String, description: '名称'},
    path: {type: String, description: '请求路径', required: true},
    method: {type: [String], description: '请求方法', required: true, enum: RequestMethodEnum.toValues()},
    auth: {type: Boolean, description: '是否用户登录才能访问'},
    clientAuth: {type: Boolean, description: '是否第三方客户端登录才能访问'},
    privs: {type: [String], description: '登录的用户拥有什么权限才能访问'},
    clientPrivs: {type: [String], description: '登录的第三方客户端拥有什么权限才能访问'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
    orderNum: {type: Number, default: 0, description: '排序'},
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
pageConfigSchema.index({insertTime: 1})
pageConfigSchema.index({updateTime: 1})
pageConfigSchema.index({path: 1})
pageConfigSchema.index({'tags.key': 1})
pageConfigSchema.index({'tags.value': 1})
pageConfigSchema.index({path: 1, method: 1})
pageConfigSchema.index({method: 1})

export default pageConfigSchema