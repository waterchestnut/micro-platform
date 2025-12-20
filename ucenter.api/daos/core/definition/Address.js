/**
 * @fileOverview 地址的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义Address的结构
 * @author xianyang
 * @property {String} continent 洲code
 * @property {String} continentName 洲名称
 * @property {String} country 国家code
 * @property {String} countryName 国家名称
 * @property {String} province 省code
 * @property {String} provinceName 省名称
 * @property {String} city 市code
 * @property {String} cityName 市名称
 * @property {String} district 区code
 * @property {String} districtName 区名称
 * @property {String} content 详细地址
 */
export default new Schema({
    continent: {type: String, description: '洲code'},
    continentName: {type: String, description: '洲名称'},
    country: {type: String, description: '国家code'},
    countryName: {type: String, description: '国家名称'},
    province: {type: String, description: '省code'},
    provinceName: {type: String, description: '省名称'},
    city: {type: String, description: '市code'},
    cityName: {type: String, description: '市名称'},
    district: {type: String, description: '区code'},
    districtName: {type: String, description: '区名称'},
    content: {type: String, description: '详细地址'},
})