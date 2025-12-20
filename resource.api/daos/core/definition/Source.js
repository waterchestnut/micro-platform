/**
 * @fileOverview 资源来源的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义Source的结构
 * @property {String} title 来源标题
 * @property {String} description 来源描述
 * @property {String} href 访问链接
 * @property {String} sourceKey 来源标识，列如literature-viewer：文献解读标注存储，pptonline-在线课件制作积累的素材
 * @property {Boolean} openAccess 是否能开放获取
 */
export default new Schema({
    title: {type: String, description: '标题'},
    description: {type: String, description: '描述'},
    href: {type: String, description: '链接'},
    sourceKey: {type: String, description: '来源标识'},
    openAccess: {type: Boolean, description: '是否能开放获取'},
})