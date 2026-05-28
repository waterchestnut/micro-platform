/**
 * @fileOverview CARSI用户与平台用户的关联映射
 * @author
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema

const carsiUserSchema = new Schema({
    /** eduPersonPrincipalName，CARSI唯一标识 */
    eppn: {type: String, required: true, description: 'CARSI用户eppn'},
    /** 绑定的平台用户标识 */
    userCode: {type: String, required: true, description: '平台用户标识'},
    /** 用户显示名称 */
    displayName: {type: String, description: '显示名称'},
    /** 邮箱 */
    email: {type: String, description: '邮箱'},
    /** 原始eduPersonScopedAffiliation */
    affiliation: {type: String, description: '身份归属'},
    /** 解析后的角色: student / teacher */
    role: {type: String, description: '角色'},
    /** 插入时间 */
    insertTime: {type: Date, default: () => new Date(), description: '插入时间'},
    /** 最近更新时间 */
    updateTime: {type: Date, default: () => new Date(), description: '最近更新时间'},
})

carsiUserSchema.index({eppn: 1}, {unique: true})
carsiUserSchema.index({userCode: 1})

export default carsiUserSchema