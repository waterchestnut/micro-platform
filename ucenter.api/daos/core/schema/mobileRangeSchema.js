/**
 * @fileOverview 手机号码段归属地
 * @author xianyang 2024/4/15
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义mobileRange的结构
 * @author xianyang
 * @property {String} mobileRangeCode 唯一标识
 * @property {Number} startNumber 手机号码段起始段
 * @property {Number} endNumber 手机号码段结束段
 * @property {String} provName 所属省份
 * @property {String} cityName 所属城市
 * @property {String} areaCode 区号
 * @property {Number} status 状态：参见StatusEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const mobileRangeSchema = new Schema({
    mobileRangeCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '号码段记录标识',
        required: true
    },
    startNumber: {type: Number},
    endNumber: {type: Number},
    provName: {type: String},
    cityName: {type: String},
    areaCode: {type: String},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
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
mobileRangeSchema.index({insertTime: 1})
mobileRangeSchema.index({updateTime: 1})
mobileRangeSchema.index({mobileRangeCode: 1})
mobileRangeSchema.index({startNumber: 1})
mobileRangeSchema.index({endNumber: 1})
mobileRangeSchema.index({startNumber: 1, endNumber: 1})
mobileRangeSchema.index({areaCode: 1})

export default mobileRangeSchema