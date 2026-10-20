/**
 * @fileOverview 长期记忆的向量索引服务
 * @author xianyang 2026-10-18
 * @module services/core/memoryIndex
 * @description 给 llm.api 的记忆召回提供语义检索后端。只存"可检索的表示"：
 * 命中的权威正文与全部字段仍以 llm.api 的 memoryAtom 为准，本服务返回 memoryCode + 文本副本 + 相似度。
 *
 * 隔离与注入：Milvus 的 filter 是表达式字符串，`userCode`/`channel` 来自调用方身份头，
 * 必须白名单清洗后再拼，否则等于把表达式注入送到向量库。
 */

import {upsertItems, deleteByQuery, search, memoryCollectionName} from '../../daos/milvus/dac/memoryDac.js'
import {getContentVector} from '../openai/embedding.js'

const tools = rag.tools
const logger = rag.logger

/** 单批向量化上限，过大交给上游分批 */
const MAX_BATCH = 200

/** 默认可召回的生命周期 */
const DEFAULT_STATE = 'active'

/**
 * @description 清洗要拼进 Milvus 表达式的字符串
 * @author xianyang
 * @param {String} value 原值
 * @returns {String} 安全值，非法字符直接拒绝
 */
export function safeExprValue(value) {
    const s = String(value ?? '')
    if (!s) {
        return ''
    }
    if (!/^[\w.:@+\-\u4e00-\u9fa5]+$/u.test(s)) {
        throw new Error(`非法标识: ${s.slice(0, 32)}`)
    }
    return s
}

/**
 * @description L2 距离折算余弦相似度。bge-m3 输出已归一化，d^2 = 2(1 - cos)
 * @author xianyang
 * @param {Number} distance milvus 返回的 L2 距离
 * @returns {Number} 0-1 相似度
 */
export function l2ToSimilarity(distance) {
    const d = Number(distance)
    if (!Number.isFinite(d)) {
        return 0
    }
    const cos = 1 - (d * d) / 2
    return Math.min(1, Math.max(0, cos))
}

/**
 * @description 写入或更新记忆向量
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object[]} params.items [{memoryCode, text, userCode, channel, workspaceId, kind, topic, state, insertTime}]
 * @returns {Promise<Object>} {upserted, failed[]}
 */
export async function upsertMemoryIndex({items = []} = {}) {
    const list = (items || []).slice(0, MAX_BATCH)
    if (!list.length) {
        return {upserted: 0, failed: []}
    }
    for (const it of list) {
        if (!it?.memoryCode || !it?.userCode || !it?.channel || !String(it?.text || '').trim()) {
            throw new Error('memoryCode/userCode/channel/text 均不可为空')
        }
        safeExprValue(it.userCode)
        safeExprValue(it.channel)
    }
    const vectors = await getContentVector(list.map(it => String(it.text)))
    if (!Array.isArray(vectors) || vectors.length !== list.length) {
        throw new Error('向量化结果与输入条数不一致')
    }
    /** 行式 fields_data，与 chunkDac 的调用方式一致（列式会被当成行里的字段名而报 field not exist） */
    const rows = list.map((it, i) => ({
        memoryCode: it.memoryCode,
        userCode: it.userCode,
        channel: it.channel,
        workspaceId: it.workspaceId || '',
        kind: it.kind || 'fact',
        topic: it.topic || 'general',
        state: it.state || 'active',
        text: String(it.text).slice(0, 8000),
        insertTime: Number(it.insertTime) || Date.now(),
        content: vectors[i],
    }))
    await upsertItems(rows)
    logger.info(`记忆向量写入 ${rows.length} 条 collection=${memoryCollectionName}`)
    return {upserted: rows.length, failed: []}
}

/**
 * @description 删除记忆向量（退役/被替代/用户清除时调用）
 * @author xianyang
 * @param {Object} params 入参
 * @param {String[]} params.memoryCodes 标识列表
 * @returns {Promise<Object>} {deleted}
 */
export async function deleteMemoryIndex({memoryCodes = [], userCode = '', channel = ''} = {}) {
    const codes = (memoryCodes || []).filter(Boolean).slice(0, MAX_BATCH)
    if (!codes.length) {
        return {deleted: 0}
    }
    const andFilters = [`memoryCode in ${JSON.stringify(codes)}`]
    /** 必须带归属条件：只凭 memoryCode 删，等于任何拿到标识的服务都能删别人的记忆 */
    if (userCode) {
        andFilters.push(`userCode == "${safeExprValue(userCode)}"`)
    }
    if (channel) {
        andFilters.push(`channel == "${safeExprValue(channel)}"`)
    }
    if (!userCode && !channel) {
        logger.warn('记忆向量删除未带归属条件，按标识直删')
    }
    const deleted = await deleteByQuery({filter: andFilters.join(' AND ')})
    /** milvus 返回的 delete_cnt 可能是字符串，统一成数字再交给调用方 */
    const n = Number(deleted) || 0
    logger.info(`记忆向量删除请求 ${codes.length} 条，实际 ${n} 条`)
    return {deleted: n}
}

/**
 * @description 语义检索记忆
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.text 查询文本
 * @param {String} params.userCode 用户标识，必填
 * @param {String} params.channel 频道标识，必填
 * @param {String} [params.workspaceId] 沙箱工作区
 * @param {String[]} [params.states] 允许的生命周期
 * @param {Number} [params.topK] 返回条数
 * @param {Number} [params.minSimilarity] 相似度下限
 * @returns {Promise<Object[]>} [{memoryCode, text, kind, topic, state, score}]
 */
export async function searchMemoryIndex(params = {}) {
    const {text, userCode, channel, workspaceId = null, states = ['active'], topK = 12, minSimilarity = 0} = params
    if (!text || !userCode || !channel) {
        return []
    }
    const andFilters = [
        `userCode == "${safeExprValue(userCode)}"`,
        `channel == "${safeExprValue(channel)}"`,
    ]
    /** 未启用沙箱时 workspaceId 是空串，必须显式匹配，否则会把别的沙箱记忆召回 */
    andFilters.push(`workspaceId == "${workspaceId ? safeExprValue(workspaceId) : ''}"`)
    const allow = (states || []).filter(s => s && /^[\w-]+$/.test(s))
    /** 传了 states 但没有一个合法时退回默认白名单，绝不能"过滤条件作废=全库可查" */
    const effective = allow.length ? allow : (states && states.length ? [DEFAULT_STATE] : [DEFAULT_STATE])
    andFilters.push(`state in ${JSON.stringify(effective)}`)
    const vector = (await getContentVector(String(text)))[0]
    if (!vector) {
        return []
    }
    const results = await search({
        vector,
        limit: Math.min(100, Number(topK) || 12),
        output_fields: ['memoryCode', 'text', 'kind', 'topic', 'state', 'insertTime'],
        filter: andFilters.join(' AND '),
        /** 刚写入的记忆要能立刻被召回（默认视图有可见性延迟，实测新写的首查会落空） */
        consistency_level: 'Strong',
    })
    return (results || [])
        .map(_ => {
            /**
             * 字段名坑：metric=L2 时 milvus 把**原始距离**放在 `score` 里（实测 0.873/1.012/1.114，越小越近），
             * bge-m3 输出已归一化，故 cos = 1 - d²/2（实测与手算余弦完全一致：0.5634/0.4937/0.4428）。
             */
            const distance = Number(_.score ?? _.distance)
            return {
                memoryCode: _.memoryCode,
                text: _.text || '',
                kind: _.kind,
                topic: _.topic,
                state: _.state,
                insertTime: _.insertTime,
                distance,
                score: l2ToSimilarity(distance),
            }
        })
        .filter(_ => _.score >= (Number(minSimilarity) || 0))
        .sort((a, b) => b.score - a.score)
}

export default {upsertMemoryIndex, deleteMemoryIndex, searchMemoryIndex, safeExprValue, l2ToSimilarity}
