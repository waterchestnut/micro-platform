/**
 * @fileOverview 区域的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义region的结构
 * @author xianyang
 * @property {String} regionCode 唯一标识
 * @property {String} regionName 区域名称
 * @property {String} fullName 全名
 * @property {String} parentCode 父区域标识
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} levelNum 区域层级
 * @property {Number} orderNum 区域排序（升序）
 * @property {String} adminCode 区域既有的行政编号，机构内唯一
 * @property {String[]} path 从顶级到当前区域的全路径标识
 * @property {String} typeName 区域类型名称：国家、省、市、区等
 * @property {String} nameEn 区域的英文名称
 * @property {String} shortName 区域的缩略名称
 * @property {String} shortNameEn 区域的缩略英文名称
 * @property {String} firstLetter 区域第一个首字母，小写
 * @property {String} letters 区域首字母集合，小写
 * @property {String} pinyin 区域中文拼音
 * @property {String} extra 区域附加信息，如壮族、回族等
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const regionSchema = new Schema({
    regionCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '区域标识',
        required: true
    },
    regionName: {type: String, description: '区域名称', required: true},
    fullName: {type: String, description: '全名'},
    parentCode: {type: String, description: '父区域标识'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    levelNum: {type: Number, default: 0, description: '区域层级'},
    orderNum: {type: Number, default: 0, description: '区域排序'},
    adminCode: {type: String, description: '区域既有的行政编号，机构内唯一'},
    path: {type: [String], description: '从顶级到当前区域的全路径标识'},
    typeName: {type: String, description: '区域类型名称'},
    nameEn: {type: String, description: '区域的英文名称'},
    shortName: {type: String, description: '区域的缩略名称'},
    shortNameEn: {type: String, description: '区域的缩略英文名称'},
    firstLetter: {type: String, description: '区域第一个首字母'},
    letters: {type: String, description: '区域首字母集合'},
    pinyin: {type: String, description: '区域中文拼音'},
    extra: {type: String, description: '区域附加信息'},
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
regionSchema.index({insertTime: 1})
regionSchema.index({updateTime: 1})
regionSchema.index({regionCode: 1})

export default regionSchema