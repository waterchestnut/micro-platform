/**
 * @fileOverview 持久用户文档（MEMORY.md / USER.md 的等价物）
 * @module daos/core/schema/memoryProfileSchema
 * @description owner 可编辑的权威文档。与自动抽取的原子冲突时，以本文档为准并软退役旧原子。
 * 模型侧的 memory_save 工具无权改写这两个字段，只能走 REST 接口。
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import Tag from '../definition/Tag.js'

const Schema = mongoose.Schema

/**
 * @description 定义memoryProfile的结构
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} workspaceId 沙箱工作区标识，Phase 4 启用
 * @property {String} userDoc 用户画像正文（USER.md 等价物），仅 owner 可写
 * @property {String} memoryDoc 强记忆正文（MEMORY.md 等价物），仅 owner 可写
 * @property {Number} docVersion 文档版本号，每次owner改写递增
 * @property {String} docHash 两份文档的合并摘要，用于召回侧去重比对
 * @property {String} updatedBy 最后改写人标识
 * @property {Schema.Types.Mixed} operator 创建人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const memoryProfileSchema = new Schema({
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    workspaceId: {type: String, description: '沙箱工作区标识，Phase 4 启用'},
    userDoc: {type: String, default: '', description: '用户画像正文'},
    memoryDoc: {type: String, default: '', description: '强记忆正文'},
    docVersion: {type: Number, default: 0, description: '文档版本'},
    docHash: {type: String, description: '文档合并摘要'},
    updatedBy: {type: String, description: '最后改写人'},
    operator: {type: Object, description: '创建人'},
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
memoryProfileSchema.index({userCode: 1, channel: 1}, {unique: true})
memoryProfileSchema.index({'operator.userCode': 1})

export default memoryProfileSchema
