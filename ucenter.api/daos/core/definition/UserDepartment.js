/**
 * @fileOverview 用户和部门关联的结构
 * @author xianyang 2024/6/10
 * @module
 */

import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义UserDepartment的结构
 * @author xianyang
 * @property {String} userCode 用户标识
 * @property {String} departmentCode 部门标识
 * @property {String} jobCode 职位标识（部门内职位）
 * @property {String} jobStatus 职位状态：0-正常在岗，-1-停职
 */
export default new Schema({
    userCode: {type: String, description: '用户标识'},
    departmentCode: {type: String, description: '部门标识'},
    jobCode: {type: String, description: '职位标识'},
    jobStatus: {type: String, default: 0, description: '职位状态'},
})