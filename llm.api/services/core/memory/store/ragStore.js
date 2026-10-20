/**
 * @fileOverview rag.api 记忆向量检索后端
 * @module services/core/memory/store/ragStore
 * @description 语义检索能力由 rag.api 的独立 `memory` collection 提供（bge-m3 1024 维 + HNSW/L2）。
 *
 * 两条来自实测的设计约束：
 * 1. **不复用 rag 的材料/分块管线**：`handleSimpleMaterial` 在无 `fileList` 时直接返回，
 *    纯文本 ingest 走不通；把每条记忆写成一个"文件"再切片是荒谬的绕路。因此 rag.api 侧新增
 *    `/core/memory-index/{upsert,delete,search}` 三个专用端点（见 rag.api services/core/memoryIndex.js）。
 * 2. **向量库只当"可召回的索引"，不当权威**：`search` 拿到 memoryCode 后回 Mongo 读原子，
 *    正文、置信度、状态一律以 `memoryAtom` 为准——索引里留着已退役记忆的旧文本也不致注入过期内容。
 *
 * 身份与地址：直连 rag.api（决策 D5，绕开 llm.api→resource.api→llm.api 的环），
 * rag.api 信任网关注入的 `user-info`，内网直连必须自带该头。
 */

import {normalizeHit} from './hit.js'
import {md5} from '../../../../tools/security.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/** 记忆命名空间在 rag 侧的稳定标识，仅用于对账与回收，不再是知识库实体 */
function buildRagCode(userCode, channel, workspaceId) {
    const seed = [channel, userCode, workspaceId || ''].join('|')
    return `${'mem'}-${md5(seed)}`
}

async function ragRequest(path, body, {method = 'POST', userCode = '', realName = '', timeoutMs} = {}) {
    const base = config.ragConfig?.baseIntranetUrl || config.ragConfig?.baseUrl
    if (!base) {
        throw new Error('ragConfig 未配置，无法访问 rag.api')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs || config.ragConfig?.timeoutMs || 3000)
    const headers = {'content-type': 'application/json'}
    if (userCode) {
        headers['user-info'] = Buffer.from(JSON.stringify({userCode, realName: realName || userCode})).toString('base64')
    }
    try {
        const res = await fetch(base + path, {
            method,
            headers,
            body: method === 'GET' ? undefined : JSON.stringify(body),
            signal: controller.signal,
        })
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`rag.api ${path} 返回 ${res.status}: ${text.slice(0, 160)}`)
        }
        const ret = await res.json()
        return ret?.data ?? ret
    } finally {
        clearTimeout(timer)
    }
}

export const ragStore = {
    name: 'rag',
    capabilities: new Set(['semantic']),

    /**
     * @description 命名空间在向量侧无需建实体，返回稳定 ragCode 供对账
     * @author xianyang
     * @param {Object} params 入参
     * @returns {Promise<Object>} {ragCode, created:false}
     */
    async ensureNamespace({userCode, channel, workspaceId = null}) {
        return {ragCode: buildRagCode(userCode, channel, workspaceId), created: false}
    },

    /**
     * @description 写入/更新记忆向量
     * @author xianyang
     * @param {Object} params 入参
     * @param {String} params.userCode 用户标识
     * @param {String} params.channel 频道标识
     * @param {String} [params.workspaceId] 沙箱工作区
     * @param {Object[]} params.atoms 原子列表
     * @returns {Promise<Object>} {ok, upserted}
     */
    async upsert({userCode, channel, workspaceId = null, atoms = [], operator = null} = {}) {
        if (!userCode || !channel || !atoms?.length) {
            return {ok: false, reason: 'bad_params', upserted: 0}
        }
        const items = atoms.filter(a => a?.atomCode && a?.content).map(a => ({
            memoryCode: a.atomCode,
            text: a.headline && a.headline !== a.content ? `${a.content}\n${a.headline}` : a.content,
            /** channel 必须逐条带上：rag.api 以请求体为准建隔离字段，缺了会落成 unknown 导致检索永不命中 */
            channel: a.channel || channel,
            kind: a.kind || 'fact',
            topic: a.topic || 'general',
            state: a.state || 'active',
            workspaceId: workspaceId || '',
            insertTime: a.insertTime ? new Date(a.insertTime).getTime() : Date.now(),
        }))
        if (!items.length) {
            return {ok: false, reason: 'empty_items', upserted: 0}
        }
        const ret = await ragRequest('/core/memory-index/upsert', {items, channel}, {
            userCode, realName: operator?.realName || '', timeoutMs: config.memory?.index?.writeTimeoutMs || 8000,
        })
        return {ok: true, upserted: ret?.upserted ?? items.length}
    },

    /**
     * @description 删除记忆向量
     * @author xianyang
     * @param {Object} params 入参
     * @returns {Promise<Object>} {ok, deleted}
     */
    async remove({userCode, channel, atomCodes = [], operator = null} = {}) {
        const codes = (atomCodes || []).filter(Boolean)
        if (!userCode || !codes.length) {
            return {ok: false, reason: 'bad_params', deleted: 0}
        }
        const ret = await ragRequest('/core/memory-index/delete', {memoryCodes: codes, channel}, {
            userCode, realName: operator?.realName || '', timeoutMs: config.memory?.index?.writeTimeoutMs || 8000,
        })
        return {ok: true, deleted: ret?.deleted ?? 0}
    },

    /**
     * @description 语义检索并回权威库取完整原子
     * @author xianyang
     * @param {Object} query 检索条件
     * @returns {Promise<Object[]>} 归一化命中
     */
    async search(query = {}) {
        const {userCode, channel, workspaceId = null, text, topK = 12, minConfidence = 0} = query
        if (!userCode || !channel || !text) {
            return []
        }
        const MemoryStatusEnum = (await import('../../../../daos/core/enum/MemoryStatusEnum.js')).default
        const memoryAtomDac = (await import('../../../../daos/core/dac/memoryAtomDac.js')).default
        /** 多取一些，回权威库校验后可能缩水（索引里可能有退役或未落库的残留） */
        const ret = await ragRequest('/core/memory-index/search', {
            text,
            channel,
            workspaceId: workspaceId || null,
            states: [MemoryStatusEnum.active.value],
            topK: Math.min(100, topK * 3),
            minSimilarity: config.memory?.index?.minSimilarity ?? 0.5,
        }, {userCode})
        const rows = Array.isArray(ret) ? ret : (ret?.rows || [])
        if (!rows.length) {
            return []
        }
        const scoreByCode = new Map(rows.map(r => [r.memoryCode, Number(r.score) || 0]))
        const atoms = await memoryAtomDac.getTop(scoreByCode.size, {
            atomCodes: [...scoreByCode.keys()],
            userCode,
            channel,
            workspaceId,
            state: MemoryStatusEnum.active.value,
            minConfidence,
        })
        return (atoms || [])
            .map(atom => normalizeHit({...atom, score: scoreByCode.get(atom.atomCode) ?? 0}))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
    },
}

export default ragStore
