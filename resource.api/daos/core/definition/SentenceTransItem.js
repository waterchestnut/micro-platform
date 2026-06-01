/**
 * @fileOverview 逐句翻译的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义SentenceTransItem的结构
 * @author xianyang
 * @property {String} original 原文
 * @property {String} translation 译文
 */
export default new Schema({
    original: {type: String, description: '原文'},
    translation: {type: String, description: '译文'},
}, {_id: false})