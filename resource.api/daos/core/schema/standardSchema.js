/**
 * @fileOverview 标准数据的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义standard的结构
 * @property {String} resCode 唯一标识
 * @property {String} title 标题
 * @property {String} standardCode 国家标准全文公开系统的标识
 * @property {String} source 数据来源：samr-openstd-国家标准全文公开系统
 * @property {Number} status 状态
 * @property {Schema.Types.Mixed} extData 扩展信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const standardSchema = new Schema({
    resCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '资源标识',
        required: true
    },
    title: {type: String, description: '标题'},
    standardCode: {type: String, description: '国家标准全文公开系统的标识'},
    source: {type: String, default: 'samr-openstd', description: '数据来源'},
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
standardSchema.index({insertTime: 1})
standardSchema.index({updateTime: 1})
standardSchema.index({resCode: 1})
standardSchema.index({standardCode: 1})
standardSchema.index({source: 1})
standardSchema.index({status: 1})

export default standardSchema