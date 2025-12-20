/**
 * @fileOverview 专利数据的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义patent的结构
 * @property {String} resCode 唯一标识
 * @property {String} title 标题
 * @property {String} patentCode 公开（公告）号
 * @property {String} source 数据来源：xianyu-闲鱼购买
 * @property {Number} status 状态
 * @property {Schema.Types.Mixed} extData 扩展信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const patentSchema = new Schema({
    resCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '资源标识',
        required: true
    },
    title: {type: String, description: '标题'},
    patentCode: {type: String, description: '公开（公告）号'},
    source: {type: String, default: 'xianyu', description: '数据来源'},
    status: {type: Number, default: 0, description: '状态'},
    extData: {type: Schema.Types.Mixed, description: '扩展信息'},
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
patentSchema.index({insertTime: 1})
patentSchema.index({updateTime: 1})
patentSchema.index({resCode: 1})
patentSchema.index({patentCode: 1})
patentSchema.index({source: 1})
patentSchema.index({status: 1})

export default patentSchema