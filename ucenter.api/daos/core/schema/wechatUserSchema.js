/**
 * @fileOverview 微信用户与平台用户的关联映射
 * @author
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema

const wechatUserSchema = new Schema({
    /** 微信openId，唯一标识 */
    openId: {type: String, required: true, description: '微信openId'},
    /** 微信unionId，开放平台下唯一 */
    unionId: {type: String, description: '微信unionId'},
    /** 绑定的平台用户标识 */
    userCode: {type: String, required: true, description: '平台用户标识'},
    /** 微信昵称 */
    nickName: {type: String, description: '微信昵称'},
    /** 微信头像 */
    avatarUrl: {type: String, description: '微信头像'},
    /** 性别 */
    gender: {type: Number, description: '性别'},
    /** 插入时间 */
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '插入时间'
    },
    /** 最近更新时间 */
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最近更新时间'
    },
})

wechatUserSchema.index({openId: 1}, {unique: true})
wechatUserSchema.index({unionId: 1})
wechatUserSchema.index({userCode: 1})

export default wechatUserSchema