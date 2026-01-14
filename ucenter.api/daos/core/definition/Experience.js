/**
 * @fileOverview 教育与工作经历的结构
 * @author xianyang
 * @module
 */

import mongoose from 'mongoose'
import ExperienceTypeEnum from '../enum/ExperienceTypeEnum.js'
import Address from './Address.js'
import DegreeEnum from '../enum/DegreeEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义Experience的结构
 * @author xianyang
 * @property {String} userCode 用户标识
 * @property {String} realName 姓名
 * @property {String} experienceType 经历的类型，参见ExperienceTypeEnum
 * @property {String} institutionCode 组织机构标识
 * @property {String} institutionName 组织机构名称
 * @property {String} jobCode 职位标识
 * @property {String} jobName 职位名称
 * @property {Schema.Types.Mixed} address 坐落地址，参见Address
 * @property {String} collegeCode 学院标识
 * @property {String} collegeName 学院名称
 * @property {String} specialtyCode 专业标识
 * @property {String} specialtyName 专业名称
 * @property {Number} degree 学位：参见DegreeEnum
 * @property {Date} startTime 开始时间
 * @property {Date} endTime 结束时间
 */
export default new Schema({
    userCode: {type: String, description: '用户标识'},
    realName: {type: String, description: '姓名'},
    experienceType: {type: String, description: '经历的类型', enum: ExperienceTypeEnum.toValues()},
    institutionCode: {type: String, description: '组织机构标识'},
    institutionName: {type: String, description: '组织机构名称'},
    jobCode: {type: String, description: '职位标识'},
    jobName: {type: String, description: '职位名称'},
    address: {type: Address, description: '坐落地址'},
    collegeCode: {type: String, description: '学院标识'},
    collegeName: {type: String, description: '学院名称'},
    specialtyCode: {type: String, description: '专业标识'},
    specialtyName: {type: String, description: '专业名称'},
    degree: {type: Number, description: '学位', enum: DegreeEnum.toValues()},
    startTime: {type: Date, description: '开始时间'},
    endTime: {type: Date, description: '结束时间'},
})