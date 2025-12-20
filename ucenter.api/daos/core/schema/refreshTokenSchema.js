/**
 * @fileOverview OAuth2.0授权的refreshToken记录信息
 * @author xianyang 2024/4/11
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import OAuthTypeEnum from "../enum/OAuthTypeEnum.js"

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义refreshToken的结构
 * @author xianyang
 * @property {String} refreshToken refreshToken的值
 * @property {String} clientCode 应用标识
 * @property {String} userCode 用户标识
 * @property {Number} expiresTime 过期时间(单位：毫秒)
 * @property {String[]} scopes 授权范围
 * @property {String} retUrl 应用回调地址
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} oauthType OAuth认证类型：参见OAuthTypeEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const refreshTokenSchema = new Schema({
    refreshToken: {type: String, description: 'refreshToken的值', required: true},
    clientCode: {type: String, description: '应用标识'},
    userCode: {type: String, description: '用户标识'},
    expiresTime: {type: Number, description: '过期时间'},
    scopes: {type: [String], description: '授权范围'},
    retUrl: {type: String, description: '应用回调地址'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    oauthType: {type: Number, default: 0, description: 'OAuth认证类型', enum: OAuthTypeEnum.toValues()},
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
refreshTokenSchema.index({insertTime: 1})
refreshTokenSchema.index({updateTime: 1})
refreshTokenSchema.index({refreshToken: 1})
refreshTokenSchema.index({clientCode: 1})
refreshTokenSchema.index({userCode: 1})
refreshTokenSchema.index({userCode: 1, clientCode: 1})

export default refreshTokenSchema