/**
 * @fileOverview 功能目录调用审计账的结构（platform-feature-map Phase 1 刀4）
 * @module daos/core/schema/featureCallLogSchema
 * @description
 * 回答"谁经 AI 摸过平台的哪些功能"——检索/推荐/调用/确认/拒绝的只追加账。
 * 与 skillWriteJournal 分家：那张是"这件事干过没有"的幂等账（可被确认环改写状态），
 * 这张是"发生过什么"的流水（只插不改——混用后果与 skillWriteJournalSchema 头注同族：
 * 审计清理会删幂等依据，反过来幂等状态机也不该拖着流水一起变）。
 * 形状纪律：
 * - 不 llm.tools（离线可测，skillWriteJournalSchema 同款）；
 * - actorKind human|ai（V9：谁干的第一问；human 不经本账——那是子系统自己的访问日志，
 *   这里专记 AI 代理面，字段留作显式声明而非漏项）；
 * - denyReason 独立列：越权尝试（feature-denied/browse-denied）与探测告警都从这列聚合，
 *   "模型被诱导尝试越权"是攻击面探测器（防线 3）。
 */
import mongoose from 'mongoose'

const Schema = mongoose.Schema

export const FEATURE_LOG_KINDS = ['search', 'invoke', 'propose', 'confirm', 'refused']

const featureCallLogSchema = new Schema({
    kind: {type: String, enum: FEATURE_LOG_KINDS, required: true, description: '事件类型'},
    /** 事件主体永远是会话用户（AI 只是手，责任在人——与 B0-1 身份覆写同一原则） */
    userCode: {type: String, default: '', description: '会话用户'},
    actorKind: {type: String, default: 'ai', enum: ['ai'], description: '本账只收 AI 代理面（human 走子系统访问日志），显式声明非漏项'},
    conversationCode: {type: String, default: '', description: '会话'},
    runCode: {type: String, default: '', description: 'run（messageCode 口径，单源同 artifact §7）'},
    channel: {type: String, default: '', description: '频道'},
    featureCode: {type: String, default: '', description: '目录条目 skillCode（search 事件可空=聚合面）'},
    effectClass: {type: String, default: '', description: 'guide|read|write 快照（条目后续变更不回改本行）'},
    /** search 面：命中数与关键词（关键词可能含用户意图敏感词——审计保留是设计选择：
     *  没有意图就没有"为什么推了它"的答案；访问权限按最严格审计面走） */
    keyword: {type: String, default: '', description: '检索关键词（search 事件）'},
    matchedCount: {type: Number, default: 0, description: '检索命中数'},
    visibleCount: {type: Number, default: 0, description: '权限过滤后可见条目数（探测聚合基数）'},
    /** 决策与拒绝原因：ok/browse-denied/feature-denied:<p>/param-mismatch/proposed-unconfirmed… */
    decision: {type: String, default: '', description: '结果码'},
    denyReason: {type: String, default: '', description: '拒绝原因（攻击面聚合列）'},
    status: {type: String, default: '', description: '降级态标记：permission-service-unavailable|catalog-unreadable'},
    insertTime: {
        type: Date,
        default: function () {
            return new Date()
        },
        description: '创建时间',
    },
})

featureCallLogSchema.index({userCode: 1, insertTime: -1})
featureCallLogSchema.index({featureCode: 1, insertTime: -1})
featureCallLogSchema.index({denyReason: 1, insertTime: -1})
featureCallLogSchema.index({kind: 1, insertTime: -1})
featureCallLogSchema.index({insertTime: 1})

export default featureCallLogSchema
