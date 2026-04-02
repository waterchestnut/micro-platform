/**
 * @fileOverview 远程gRPC技能的结构
 * @author xianyang 2026/4/1
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义grpcSkill的结构
 * @author xianyang
 * @property {String} skillCode 唯一标识
 * @property {String} name 技能名称
 * @property {String} description 技能描述（标准的SKILL.md格式）
 * @property {String} grpcHost 远程主机地址
 * @property {String} clientCode 所属应用标识
 * @property {String[]} channels 哪些聊天通道可以使用
 * @property {String} note 备注
 * @property {Schema.Types.Mixed} operator 创建者
 * @property {Number} status 状态：参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const grpcSkillSchema = new Schema({
    skillCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '技能标识',
        required: true
    },
    name: {type: String, description: '技能名称', required: true},
    description: {type: String, description: '技能描述（标准的SKILL.md格式）', required: true},
    grpcHost: {type: String, description: '远程主机地址', required: true},
    clientCode: {type: String, description: '所属应用标识', required: true},
    channels: {type: [String], description: '哪些聊天通道可以使用', required: true},
    note: {type: String, description: '备注'},
    operator: {type: Object, description: '创建者'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    tags: {type: [Tag], description: '标签'},
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
grpcSkillSchema.index({insertTime: 1})
grpcSkillSchema.index({updateTime: 1})
grpcSkillSchema.index({skillCode: 1})
grpcSkillSchema.index({name: 1})
grpcSkillSchema.index({grpcHost: 1})
grpcSkillSchema.index({clientCode: 1})
grpcSkillSchema.index({channels: 1})
grpcSkillSchema.index({'operator.userCode': 1})
grpcSkillSchema.index({'tags.key': 1})
grpcSkillSchema.index({'tags.value': 1})

export default grpcSkillSchema