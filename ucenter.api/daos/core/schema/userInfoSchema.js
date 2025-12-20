/**
 * @fileOverview 用户基本信息的结构
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from "../enum/StatusEnum.js"
import AuthTypeEnum from "../enum/AuthTypeEnum.js"
import DegreeEnum from "../enum/DegreeEnum.js"
import GenderEnum from "../enum/GenderEnum.js"
import SchemaEnum from "../enum/SchemaEnum.js"
import Tag from "../definition/Tag.js"
import UserDepartment from "../definition/UserDepartment.js"
import AdminClass from "../definition/AdminClass.js";

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义userInfo的结构
 * @author xianyang
 * @property {String} userCode 唯一标识
 * @property {String} loginName 自定义登录名
 * @property {String} pwd 密码(加盐非对称加密)
 * @property {String} mobile 登录用的手机号
 * @property {String} email 登录用的邮箱
 * @property {String[]} mobileList 预留的联系手机号
 * @property {String[]} phoneList 预留的联系固定电话
 * @property {String[]} emailList 预留的联系邮箱
 * @property {String} realName 真实姓名
 * @property {String} nickName 昵称
 * @property {String} avatarUrl 头像路径
 * @property {String} office 办公地址
 * @property {String} nation 民族
 * @property {String} politics 政治面貌
 * @property {Date} birthday 生日
 * @property {Number} orderNum 排序
 * @property {Number} degree 学位：参见DegreeEnum
 * @property {Number} gender 性别：参见GenderEnum
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} authType 授权类型：参见AuthTypeEnum
 * @property {String[]} schemaCodes 使用模式：参见SchemaEnum
 * @property {String[]} orgCodes 所属机构
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String[]} modulePrivCodes 模块权限标识
 * @property {String[]} groupCodes 所属用户组
 * @property {Schema.Types.Mixed[]} departments 所属部门，参见UserDepartment
 * @property {String} mainJobCode 主职位标识
 * @property {Schema.Types.Mixed} adminClass 所属班级，参见AdminClass
 * @property {String} idNum 学号/工号
 * @property {String} grade 年级
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const userInfoSchema = new Schema({
    userCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '用户名',
        required: true
    },
    loginName: {type: String, description: '自定义登录名'},
    pwd: {type: String, description: '密码'},
    mobile: {type: String, description: '手机号'},
    email: {type: String, description: '邮箱'},
    mobileList: {type: [String], description: '联系手机号'},
    phoneList: {type: [String], description: '联系固定电话'},
    emailList: {type: [String], description: '联系邮箱'},
    realName: {type: String, description: '姓名'},
    nickName: {type: String, description: '昵称'},
    avatarUrl: {type: String, description: '头像'},
    office: {type: String, description: '办公地址'},
    nation: {type: String, description: '民族'},
    politics: {type: String, description: '政治面貌'},
    birthday: {type: Date, description: '生日'},
    orderNum: {type: Number, default: 0, description: '排序'},
    degree: {type: Number, default: 0, description: '学位', enum: DegreeEnum.toValues()},
    gender: {type: Number, default: 0, description: '性别', enum: GenderEnum.toValues()},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    authType: {type: Number, default: 0, description: '授权类型', enum: AuthTypeEnum.toValues()},
    schemaCodes: {type: [String], default: ['default'], description: '使用模式', enum: SchemaEnum.toValues()},
    orgCodes: {type: [String], description: '所属机构'},
    tags: {type: [Tag], description: '标签'},
    modulePrivCodes: {type: [String], description: '模块权限标识'},
    groupCodes: {type: [String], description: '所属用户组'},
    departments: {type: [UserDepartment], description: '所属部门'},
    mainJobCode: {type: String, description: '主职位标识'},
    adminClass: {type: AdminClass, description: '所属班级'},
    idNum: {type: String, description: '学号/工号'},
    grade: {type: String, description: '年级'},
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
userInfoSchema.index({insertTime: 1})
userInfoSchema.index({updateTime: 1})
userInfoSchema.index({userCode: 1})
userInfoSchema.index({loginName: 1})
userInfoSchema.index({mobile: 1})
userInfoSchema.index({email: 1})
userInfoSchema.index({schemaCodes: 1})
userInfoSchema.index({'tags.key': 1})
userInfoSchema.index({'tags.value': 1})

export default userInfoSchema