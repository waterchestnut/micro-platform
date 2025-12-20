/**
 * @fileOverview 职位的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义job的结构
 * @author xianyang
 * @property {String} jobCode 唯一标识
 * @property {String} jobName 职位名称
 * @property {String} parentCode 父职位标识
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} levelNum 职位层级
 * @property {Number} orderNum 职位排序（升序）
 * @property {String} orgCode 所属机构
 * @property {String} adminCode 职位既有的行政编号，机构内唯一
 * @property {String[]} path 从顶级到当前职位的全路径标识
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const jobSchema = new Schema({
    jobCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '职位标识',
        required: true
    },
    jobName: {type: String, description: '职位名称', required: true},
    parentCode: {type: String, description: '父职位标识'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    levelNum: {type: Number, default: 0, description: '职位层级'},
    orderNum: {type: Number, default: 0, description: '职位排序'},
    orgCode: {type: String, description: '所属机构'},
    adminCode: {type: String, description: '职位既有的行政编号，机构内唯一'},
    path: {type: [String], description: '从顶级到当前职位的全路径标识'},
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
jobSchema.index({insertTime: 1})
jobSchema.index({updateTime: 1})
jobSchema.index({jobCode: 1})

export default jobSchema