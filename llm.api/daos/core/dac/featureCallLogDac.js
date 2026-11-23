/**
 * @fileOverview 功能目录调用审计的落库层（platform-feature-map 刀4）
 * @module daos/core/dac/featureCallLogDac
 * @description
 * 只追加流水：一个 log 方法。刻意不做查询封装——读面归 runStats 聚合与后续值班工具，
 * 写面必须极简（审计宽接口=以后什么都往里塞，长歪没人管）。
 * 失败语义：log() 会抛（由调用方 log-and-forget 捕获——featureCatalogTool 的
 * finishAsync 已有兜底位；审计缺席坏过观测面，不坏检索）。
 */
import {FeatureCallLog} from '../schema/index.js'

export class FeatureCallLogDac {
    /**
     * @description 插一条流水（字段裁剪：只收 schema 声明面，多余键丢弃——宽进=脏进）
     * @param {Object} rec 审计记录
     * @returns {Promise<Object>} 插入结果
     */
    async log(rec = {}) {
        const doc = {
            kind: rec.kind || 'search',
            userCode: String(rec.userCode || ''),
            actorKind: 'ai',
            conversationCode: String(rec.conversationCode || ''),
            runCode: String(rec.runCode || ''),
            channel: String(rec.channel || ''),
            featureCode: String(rec.featureCode || ''),
            effectClass: String(rec.effectClass || ''),
            keyword: String(rec.keyword || ''),
            matchedCount: Number(rec.matchedCount) || 0,
            visibleCount: Number(rec.visibleCount) || 0,
            decision: String(rec.decision || ''),
            denyReason: String(rec.denyReason || ''),
            status: String(rec.status || ''),
            insertTime: new Date(),
        }
        return await FeatureCallLog.insertOne(doc)
    }
}

export default new FeatureCallLogDac()
