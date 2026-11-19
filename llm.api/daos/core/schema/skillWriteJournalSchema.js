/**
 * @fileOverview skill 写面幂等账本的结构
 * @module daos/core/schema/skillWriteJournalSchema
 * @description
 * 一行 = 一次"写面工具调用"的保险记录：claim 时 started，执行完 settle 成 done 并带结果快照。
 * 它**不是审计表**（skillJournal/memoryJournal 是"谁改了什么"的只追加留痕；这张是
 * "这件事干过没有"的幂等账），语义不同所以分表——混用的下场是审计清理会删掉幂等依据。
 * 身份=idempotencyKey 本身（一键一行），不设 journalCode；也不引 llm.tools——
 * 顶层引用 llm 的 schema 在离线测试必炸（本文件曾带 journalCode default 时正是如此）。
 *
 * 判据在 `services/core/skill/skillWriteIdempotency.js`；这里只管形状：
 * - idempotencyKey 唯一是**并发终裁**（同 artifactSchema §7 line 741 的先例；接线层的先查后 claim
 *   只是快路径，撞键必须回查而不是多一行）；
 * - done 必带快照（replay 的资本）；started 无快照（执行没完成，没什么可回放——回放语义交给判据 refuse 档）；
 * - status 词表校验器拒生造值：写坏状态的行会被判据归入 unknown-status⇒refuse（危险面），
 *   但校验器先把"写坏"本身拦在门口。
 */
import mongoose from 'mongoose'

const Schema = mongoose.Schema

/** 状态词表（与判据 decideSkillWriteGate 的处理面一一对应；测试级对账防漂移） */
const STATUSES = ['started', 'done']

/**
 * @description skillWriteJournal 的结构
 * @property {String} idempotencyKey `${runCode}:${toolCallId}`（唯一；本表每行都必须有键）
 * @property {String} runCode run 标识（llmChat=messageCode，§7:741 口径）
 * @property {String} toolCallId 模型给的 toolCall.id
 * @property {String} toolName 工具名（白名单命中的那个）
 * @property {String} conversationCode 会话（排障定位用，不做权限面）
 * @property {String} userCode 发起者
 * @property {String} status started|done
 * @property {String} resultSnapshot done 时回放给模型的 tool 消息 content（钳过带标）
 * @property {Boolean} snapshotTruncated 快照是否被钳
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最后更新时间
 */
const skillWriteJournalSchema = new Schema({
    idempotencyKey: {type: String, required: true, description: '幂等键 ${runCode}:${toolCallId}'},
    runCode: {type: String, default: '', description: '产生它的 run'},
    toolCallId: {type: String, default: '', description: '模型给的 toolCall.id'},
    toolName: {type: String, default: '', description: '工具名'},
    conversationCode: {type: String, default: '', description: '会话标识'},
    userCode: {type: String, default: '', description: '发起者'},
    status: {type: String, enum: STATUSES, default: 'started', description: 'started|done'},
    resultSnapshot: {type: String, default: '', description: 'done 时回放的 tool 消息 content'},
    snapshotTruncated: {type: Boolean, default: false, description: '快照是否被钳'},
    insertTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '创建时间',
    },
    updateTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '最后更新时间',
    },
})

/** 并发终裁：同键第二行必撞（接线层撞键回查，不多执行一次） */
skillWriteJournalSchema.index({idempotencyKey: 1}, {unique: true})
skillWriteJournalSchema.index({runCode: 1})
skillWriteJournalSchema.index({insertTime: 1})

/** 词表单源（测试对账判据用；schema enum 与它同一数组实例） */
skillWriteJournalSchema.STATUSES = STATUSES

export default skillWriteJournalSchema
