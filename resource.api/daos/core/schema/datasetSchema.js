/**
 * @fileOverview 统计数据的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义dataset的结构
 * @property {String} resCode 唯一标识
 * @property {String} title 标题
 * @property {String} datasetCode 统计局平台的标识
 * @property {String} source 数据来源：gov-stats-国家统计局
 * @property {Number} status 状态
 * @property {Schema.Types.Mixed} extData 扩展信息
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const datasetSchema = new Schema({
    resCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '资源标识',
        required: true
    },
    title: {type: String, description: '标题'},
    datasetCode: {type: String, description: '统计局平台的标识'},
    source: {type: String, default: 'gov-stats', description: '数据来源'},
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
datasetSchema.index({insertTime: 1})
datasetSchema.index({updateTime: 1})
datasetSchema.index({resCode: 1})
datasetSchema.index({datasetCode: 1})
datasetSchema.index({source: 1})
datasetSchema.index({status: 1})

export default datasetSchema