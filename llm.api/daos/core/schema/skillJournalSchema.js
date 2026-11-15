/**
 * @fileOverview 远程技能变更留痕
 * @module daos/core/schema/skillJournalSchema
 * @description
 * PR-E0.1 ⑦：注册与审核变更必须留痕，形态复用 `memoryJournalSchema` 的 `actor/op/before/after/evidence`。
 *
 * 为什么单独一张表而不是塞进技能记录的数组里：
 * 1. **只追加不修改**是审计的底线，而技能记录会被反复 `update`，把历史放进可改文档等于把历史交给改文档的人；
 * 2. 撤销/驳回的理由常常比结论更需要留着——技能记录一旦删除（`status:-1`），那些理由会跟着消失；
 * 3. 与 `memoryJournal` 同形，读审计的人只需要学一种形状。
 *
 * 这里**不写 skillMD 正文**（只写哈希与长度）：留痕要回答"谁在什么时候把内容从哪版改到哪版"，
 * 正文本身在技能记录里已有一份，复制进审计表等于多一处需要脱敏与清理的地方。
 */
import mongoose from 'mongoose'

const Schema = mongoose.Schema
const tools = llm.tools

/**
 * @description skillJournal 的结构（与同目录其它 schema 一样直接导出 schema 对象）
 */
const skillJournalSchema = new Schema({
    journalCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '留痕标识',
        required: true,
    },
    skillCode: {type: String, description: '被改动的技能标识', required: true},
    skillName: {type: String, description: '当时的技能名称（改名后仍能对上）'},
    /** 谁做的：user（含管理员）/ system（装配期自动降级）/ migration（存量批准脚本） */
    actor: {type: String, default: 'user', enum: ['user', 'system', 'migration'], description: '动作来源'},
    op: {
        type: String,
        enum: ['add', 'update', 'delete', 'enable', 'disable', 'approve', 'reject', 'revoke', 'auto-pending'],
        description: '动作类型',
        required: true,
    },
    /** 操作者身份快照：只留 userCode/realName，不留整份 userInfo（里面有与本次审计无关的字段） */
    actorUser: {type: Object, description: '操作者 {userCode, realName}'},
    before: {type: Object, description: '改动前摘要（reviewStatus/skillMDHash/channels/grpcHost，不含正文）'},
    after: {type: Object, description: '改动后摘要（同上口径）'},
    evidence: {type: [Object], description: '依据：权限判定结果、扫描命中类别、哈希比对结果等'},
    reason: {type: String, description: '一句话理由（驳回/撤销必填）'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        }, description: '留痕时间',
    },
})

/**
 * @description 索引
 */
skillJournalSchema.index({skillCode: 1, insertTime: -1})
skillJournalSchema.index({op: 1, insertTime: -1})
skillJournalSchema.index({insertTime: 1})

export default skillJournalSchema
