/**
 * @fileOverview 材料的文本数据定义
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义材料文本数据的结构
 * @author xianyang
 * @property {String} text 材料文本
 * @property {Number} wordCount 材料的字符数量
 * @property {Number} tokens 材料的tokens数量
 * @property {String} language 材料的语言
 * @property {Number} isOriginal 是否为原文：1-原文，0-翻译的文本
 * @property {String} fileCode 文件的唯一标识
 */
export default new Schema({
    text: {type: String, description: '材料文本'},
    wordCount: {type: Number, default: 1, description: '材料的字符数量'},
    tokens: {type: Number, default: 1, description: '材料的tokens数量'},
    language: {type: String, description: '材料的语言'},
    isOriginal: {type: Number, default: 1, description: '是否为原文'},
    fileCode : {type: String, description: '文件的唯一标识'},
})