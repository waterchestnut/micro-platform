/**
 * @fileOverview 第三方应用的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import OAuthGrantTypeEnum from "../enum/OAuthGrantTypeEnum.js"
import OAuthScopeEnum from "../enum/OAuthScopeEnum.js"
import Tag from "../definition/Tag.js"

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义client的结构
 * @author xianyang
 * @property {String} clientCode 唯一标识
 * @property {String} clientName 应用名称
 * @property {String} clientSecret 应用秘钥
 * @property {String[]} retUrls 授权后的回调地址
 * @property {String[]} grantTypes 授权模式：参见OAuthGrantTypeEnum
 * @property {String[]} scopes 授权范围：参见OAuthScopeEnum
 * @property {Number} status 状态：参见StatusEnum
 * @property {String} description 应用描述
 * @property {String} userCode 添加应用的人
 * @property {String[]} loginUrls 应用登录地址
 * @property {String[]} logoutUrls 应用退出地址
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String[]} modulePrivCodes 模块权限标识
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const clientSchema = new Schema({
    clientCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '应用标识',
        required: true
    },
    clientName: {type: String, description: '应用名称'},
    clientSecret: {type: String, description: '应用秘钥'},
    retUrls: {type: [String], description: '授权后的回调地址'},
    grantTypes: {type: [String], default: ['code'], description: '授权模式', enum: OAuthGrantTypeEnum.toValues()},
    scopes: {type: [String], default: ['myRead'], description: '授权范围', enum: OAuthScopeEnum.toValues()},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    description: {type: String, description: '应用描述'},
    userCode: {type: String, description: '添加应用的人'},
    loginUrls: {type: [String], description: '应用登录地址'},
    logoutUrls: {type: [String], description: '应用退出地址'},
    tags: {type: [Tag], description: '标签'},
    modulePrivCodes: {type: [String], description: '模块权限标识'},
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
clientSchema.index({insertTime: 1})
clientSchema.index({updateTime: 1})
clientSchema.index({clientCode: 1})

export default clientSchema