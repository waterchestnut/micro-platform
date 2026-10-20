/**
 * @fileOverview Mongo 词法检索后端（兜底实现）
 * @module services/core/memory/store/mongoLexicalStore
 * @description 不依赖任何外部服务即可跑通召回：用 memoryAtom 的文本索引与 n-gram 正则匹配。
 * 取词与打分是纯函数，放在 store/lexical.js 里单独可测；语义能力缺失是刻意的取舍，
 * rag.api 接通后由 ragStore 顶上。
 */

import memoryAtomDac from '../../../../daos/core/dac/memoryAtomDac.js'
import MemoryStatusEnum from '../../../../daos/core/enum/MemoryStatusEnum.js'
import {normalizeHit} from './hit.js'
import {clausesOf, gramsOf, totalGramWeight, alternationSource, lexicalScore, MAX_CLAUSES} from './lexical.js'

const tools = llm.tools

/** 词法召回单次拉取的候选上限，之后交给上层 rerank 精排 */
const FETCH_LIMIT = 200

export const mongoLexicalStore = {
    name: 'mongoLexical',
    capabilities: new Set([]),

    /**
     * @description 词法后端不需要外部资源，命名空间即 userCode+channel
     */
    async ensureNamespace(ns) {
        return {ragCode: null, workspaceId: ns?.workspaceId || null, created: false}
    },

    /**
     * @description 词法后端直接读权威库，无需双写
     */
    async upsert() {
        return {ok: true, skipped: true, reason: 'mongoLexical 直读 memoryAtom'}
    },

    async remove() {
        return {ok: true, skipped: true, reason: 'mongoLexical 直读 memoryAtom'}
    },

    /**
     * @description 词法检索生效中的记忆原子
     * @author xianyang
     * @param {Object} query 检索条件
     * @param {String} query.userCode 用户标识
     * @param {String} query.channel 频道标识
     * @param {String} [query.workspaceId] 沙箱工作区标识
     * @param {String} query.text 检索词
     * @param {Number} [query.topK] 返回条数
     * @param {Number} [query.minConfidence] 置信度下限
     * @returns {Promise<Object[]>} 归一化命中
     */
    async search(query = {}) {
        const {userCode, channel, workspaceId = null, text, topK = 12, minConfidence = 0} = query
        if (!userCode || !channel) {
            return []
        }
        const base = {userCode, channel, workspaceId, state: MemoryStatusEnum.active.value, minConfidence}
        const clauses = clausesOf(text).slice(0, MAX_CLAUSES)
        const grams = gramsOf(text)
        const weight = totalGramWeight(grams)

        if (grams.length) {
            /** 一次 alternation 正则取回所有含任一元组的候选，比逐词 N 次查询少 N-1 次往返 */
            const pattern = alternationSource(grams)
            const rows = await memoryAtomDac.getTop(FETCH_LIMIT, {
                ...base,
                complexFilter: [{content: new RegExpExt(pattern, 'i')}],
            }, {confidence: -1, updateTime: -1})
            const scored = (rows || [])
                .map(row => ({row, score: lexicalScore(row, {clauses, grams, totalWeight: weight})}))
                .filter(_ => _.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, topK)
            if (scored.length) {
                const max = scored[0].score || 1
                /** 归一到 0-1 供上层与其它检索源一起参与加权排序 */
                return scored.map(({row, score}) => normalizeHit({...row, score: score / max}))
            }
        }

        /** 一个字都匹配不上时按置信度+时间取头部，保证 profile/preference 类记忆仍可注入 */
        const rows = await memoryAtomDac.getTop(topK, base, {confidence: -1, updateTime: -1})
        const list = tools.isArray(rows) ? rows : []
        return list.map(row => normalizeHit({...row, score: 0.5}))
    },
}

export default mongoLexicalStore
