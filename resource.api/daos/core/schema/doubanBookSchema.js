/**
 * @fileOverview 豆瓣图书的结构
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = resource.tools

/**
 * @description 定义doubanBook的结构
 * @property {String} resCode 资源唯一标识
 * @property {String} doubanCode 资源在豆瓣网上的标识
 * @property {String} doubanCodeNum 资源在豆瓣网上的标识（数字形式）
 * @property {String} isbn 图书的isbn号
 * @property {String} ubn 统一书号
 * @property {String} issn issn号
 * @property {String} title 标题
 * @property {String} subtitle 副标题
 * @property {String} coverUrl 封面地址
 * @property {String} abstract 资源简介
 * @property {String} creator 作者
 * @property {String} creatorAbstract 作者简介
 * @property {String} publisher 出版社
 * @property {String} producer 出品方
 * @property {String} publishDate 出版时间
 * @property {String} translator 译者
 * @property {String} originalName 原作名
 * @property {String} pageNum 总页数
 * @property {String} price 定价
 * @property {String} layout 装帧
 * @property {String} catalog 目录
 * @property {String} series 丛书
 * @property {String} singlePrice 单期定价
 * @property {String} websiteUrl 网站地址
 * @property {Schema.Types.Mixed} extData 扩展信息
 * @property {Number} [status=0] 数据状态：0-初始解析状态，1-已使用，2-重新使用
 * @property {Date} insertTime 插入时间
 * @property {Date} updateTime 最近修改时间
 */
const doubanBookSchema = new Schema({
    resCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '资源标识',
        required: true
    },
    doubanCode: {type: String},
    doubanCodeNum: {type: Number},
    isbn: {type: String},
    ubn: {type: String},
    issn: {type: String},
    title: {type: String},
    subtitle: {type: String},
    coverUrl: {type: String},
    abstract: {type: String},
    creator: {type: String},
    creatorAbstract: {type: String},
    publisher: {type: String},
    producer: {type: String},
    publishDate: {type: String},
    translator: {type: String},
    originalName: {type: String},
    pageNum: {type: String},
    price: {type: String},
    layout: {type: String},
    catalog: {type: String},
    series: {type: String},
    singlePrice: {type: String},
    websiteUrl: {type: String},
    extData: {type: Schema.Types.Mixed},
    status: {type: Number, default: 0},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        }
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        }
    },
    vector: {type: String},
    eigen: {type: Schema.Types.Mixed},
})

/**
 * @description 索引
 */
doubanBookSchema.index({insertTime: 1})
doubanBookSchema.index({doubanCode: 1})
doubanBookSchema.index({resCode: 1})
doubanBookSchema.index({isbn: 1})
doubanBookSchema.index({status: 1})
doubanBookSchema.index({updateTime: 1})
doubanBookSchema.index({doubanCodeNum: 1})

export default doubanBookSchema