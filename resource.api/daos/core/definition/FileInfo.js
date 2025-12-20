/**
 * @fileOverview 上传文件的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义文件的结构
 * @author xianyang
 * @property {String} uid 上传组件定义的唯一标识
 * @property {Number} lastModified 最新修改时间的数值标识
 * @property {Date} lastModifiedDate 最新修改时间的日期格式
 * @property {String} name 原始文件名
 * @property {Number} size 文件大小
 * @property {String} type 文件的mime
 * @property {Number} percent 文件上传的百分比
 * @property {String} status 文件上传的状态
 * @property {String} fileCode 文件的唯一标识
 * @property {String} fileHashCode 文件内容的hash值
 * @property {String} fileExt 文件后缀
 * @property {String} url 文件下载地址
 */
export default new Schema({
    uid : {type: String, description: '上传组件定义的唯一标识'},
    lastModified : {type: Number, description: '最新修改时间的数值标识'},
    lastModifiedDate : {type: Date, description: '最新修改时间的日期格式'},
    name : {type: String, description: '原始文件名'},
    size : {type: Number, description: '文件大小'},
    type : {type: String, description: '文件的mime'},
    percent : {type: Number, description: '文件上传的百分比'},
    status : {type: String, description: '文件上传的状态'},
    fileCode : {type: String, description: '文件的唯一标识'},
    fileHashCode : {type: String, description: '文件内容的hash值'},
    fileExt : {type: String, description: '文件后缀'},
    url : {type: String, description: '文件下载地址'}
})