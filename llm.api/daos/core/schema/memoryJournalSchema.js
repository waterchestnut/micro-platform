/**
 * @fileOverview 记忆变更日志（L4）的结构
 * @module daos/core/schema/memoryJournalSchema
 * @description 只追加不修改。所有对记忆生效内容的变更都必须留痕，可回溯可申诉。
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description 定义memoryJournal的结构
 * @property {String} journalCode 唯一标识
 * @property {String} userCode 记忆归属的用户标识
 * @property {String} channel 频道标识
 * @property {String} actor 变更发起方：user|agent|system|promoter|retention
 * @property {String} op 操作类型
 * @property {String} targetType 目标类型
 * @property {String} targetCode 目标标识
 * @property {Schema.Types.Mixed} before 变更前的关键字段快照
 * @property {Schema.Types.Mixed} after 变更后的关键字段快照
 * @property {Schema.Types.Mixed[]} evidence 支撑本次变更的证据
 * @property {String} reason 变更理由
 * @property {Schema.Types.Mixed} operator 操作人
 * @property {Number} status 状态，参见StatusEnum
 * @property {Date} insertTime 创建时间
 */
const memoryJournalSchema = new Schema({
    journalCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '日志标识',
        required: true
    },
    userCode: {type: String, description: '记忆归属的用户标识', required: true},
    channel: {type: String, description: '频道标识', required: true},
    actor: {
        type: String,
        default: 'system',
        description: '变更发起方',
        enum: ['user', 'agent', 'system', 'promoter', 'retention']
    },
    op: {
        type: String,
        description: '操作类型',
        enum: ['create', 'merge', 'supersede', 'retire', 'restore', 'edit', 'index', 'drop']
    },
    targetType: {type: String, description: '目标类型', enum: ['event', 'candidate', 'atom', 'entity', 'profile']},
    targetCode: {type: String, description: '目标标识'},
    before: {type: Object, description: '变更前快照'},
    after: {type: Object, description: '变更后快照'},
    evidence: {type: [Object], description: '支撑证据'},
    reason: {type: String, description: '变更理由'},
    operator: {type: Object, description: '操作人'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '插入时间'
    },
})

/**
 * @description 索引
 */
memoryJournalSchema.index({journalCode: 1})
memoryJournalSchema.index({userCode: 1, channel: 1, insertTime: -1})
memoryJournalSchema.index({targetType: 1, targetCode: 1})
memoryJournalSchema.index({insertTime: 1}, {expireAfterSeconds: 365 * 24 * 3600})

export default memoryJournalSchema
