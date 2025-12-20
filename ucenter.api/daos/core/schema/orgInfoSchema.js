/**
 * @fileOverview 机构基本信息的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import AuthTypeEnum from '../enum/AuthTypeEnum.js'
import Address from "../definition/Address.js"
import Contact from "../definition/Contact.js"
import OrgTypeEnum from "../enum/OrgTypeEnum.js"
import SchemaEnum from "../enum/SchemaEnum.js"

const Schema = mongoose.Schema
const tools = ucenter.tools

/**
 * @description 定义org的结构
 * @author xianyang
 * @property {String} orgCode 唯一标识
 * @property {String} orgName 机构名称
 * @property {String} orgNameEn 英文名称
 * @property {String} coverUrl 封面地址
 * @property {String} firstLetter 机构名称第一个首字母，小写
 * @property {String} letters 机构名称首字母集合，小写
 * @property {String} pinyin 机构名称拼音，小写
 * @property {String} des 机构介绍
 * @property {String} desEn 英文介绍
 * @property {Schema.Types.Mixed} address 坐落地址，参见Address
 * @property {Schema.Types.Mixed[]} contactList 联系人列表，参见Contact
 * @property {String[]} orgTypes 机构类型：参见OrgTypeEnum
 * @property {Number} status 状态：参见StatusEnum
 * @property {Number} authType 授权类型：参见AuthTypeEnum
 * @property {String[]} schemaCodes 使用模式：参见SchemaEnum
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const orgInfoSchema = new Schema({
    orgCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '机构标识',
        required: true
    },
    orgName: {type: String, description: '机构名称', required: true},
    orgNameEn: {type: String, description: '英文名称'},
    coverUrl: {type: String, description: '封面地址'},
    firstLetter: {type: String, description: '机构名称第一个首字母'},
    letters: {type: String, description: '机构名称首字母集合'},
    pinyin: {type: String, description: '机构名称拼音'},
    des: {type: String, description: '机构介绍'},
    desEn: {type: String, description: '英文介绍'},
    address: {type: Address, description: '坐落地址'},
    contactList: {type: [Contact], description: '联系人'},
    orgTypes: {type: [String], default: ['other'], description: '机构类型', enum: OrgTypeEnum.toValues()},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    authType: {type: Number, default: 0, description: '授权类型', enum: AuthTypeEnum.toValues()},
    schemaCodes: {type: [String], default: ['default'], description: '使用模式', enum: SchemaEnum.toValues()},
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
orgInfoSchema.index({insertTime: 1})
orgInfoSchema.index({updateTime: 1})
orgInfoSchema.index({orgCode: 1})
orgInfoSchema.index({firstLetter: 1})
orgInfoSchema.index({letters: 1})
orgInfoSchema.index({pinyin: 1})

export default orgInfoSchema