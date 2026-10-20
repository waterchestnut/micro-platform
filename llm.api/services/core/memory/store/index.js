/**
 * @fileOverview 记忆检索后端端口
 * @module services/core/memory/store/index
 * @description Mongo 是权威存储，检索后端只负责"可召回"。端口化以便在
 * mongoLexical（纯本仓、零外部依赖）与 rag（复用 rag.api 的 Milvus + ES）之间切换，
 * 上层召回管线不感知差异。
 *
 * 两个实现都延迟加载：它们会连带引入 daos（依赖 llm 全局与数据库连接），
 * 而召回管线的纯函数部分需要能在无基础设施的环境下被测试和复用。
 */

import {normalizeHit, dedupeHits} from './hit.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

let lexicalCache = undefined
let ragCache = undefined

async function loadLexical() {
    if (lexicalCache === undefined) {
        try {
            lexicalCache = (await import('./mongoLexicalStore.js')).mongoLexicalStore
        } catch (e) {
            logger().error(`mongoLexical 记忆检索后端加载失败: ${e.message}`)
            lexicalCache = null
        }
    }
    return lexicalCache
}

async function loadRag() {
    if (ragCache === undefined) {
        try {
            ragCache = (await import('./ragStore.js')).ragStore
        } catch (e) {
            logger().error(`rag 记忆检索后端加载失败，本次进程内回退到 mongoLexical: ${e.message}`)
            ragCache = null
        }
    }
    return ragCache
}

/**
 * @description 取当前配置的检索后端实现
 * @author xianyang
 * @returns {Promise<Object>} 实现对象，含 name/capabilities/ensureNamespace/upsert/remove/search
 */
export async function getMemoryStore() {
    const name = (typeof llm !== 'undefined' && llm.config?.memory?.store) || 'mongoLexical'
    if (name === 'rag') {
        const rag = await loadRag()
        if (rag) {
            return rag
        }
        logger().warn(`rag 后端不可用，回退到 mongoLexical`)
    }
    const lexical = await loadLexical()
    if (!lexical) {
        throw new Error('没有可用的记忆检索后端')
    }
    return lexical
}

export {normalizeHit, dedupeHits}
