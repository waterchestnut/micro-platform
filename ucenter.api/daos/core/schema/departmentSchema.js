/**
 * @fileOverview 部门的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义department的结构
 * @author xianyang
 * @property {String} departmentCode 唯一标识
 * @property {String} departmentName 部门名称
 * @property {String} parentCode 父部门标识
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} levelNum 部门层级
 * @property {Number} orderNum 部门排序（升序）
 * @property {String} orgCode 所属机构
 * @property {String} adminCode 部门既有的行政编号，机构内唯一
 * @property {String[]} path 从顶级到当前部门的全路径标识
 * @property {Number} isTemp 是否临时组织：1是，0不是
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const departmentSchema = new Schema({
    departmentCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '部门标识',
        required: true
    },
    departmentName: {type: String, description: '部门名称', required: true},
    parentCode: {type: String, description: '父部门标识'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    levelNum: {type: Number, default: 0, description: '部门层级'},
    orderNum: {type: Number, default: 0, description: '部门排序'},
    orgCode: {type: String, description: '所属机构'},
    adminCode: {type: String, description: '部门既有的行政编号，机构内唯一'},
    path: {type: [String], description: '从顶级到当前部门的全路径标识'},
    isTemp: {type: Number, default: 0, description: '是否临时组织'},
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
departmentSchema.index({insertTime: 1})
departmentSchema.index({updateTime: 1})
departmentSchema.index({departmentCode: 1})

export default departmentSchema