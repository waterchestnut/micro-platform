/**
 * @fileOverview 记忆召回管线
 * @module services/core/memory/recall
 * @description 十个阶段中，除 gather 触达存储外全部为纯函数，便于回归排序与预算口径：
 * cache -> parse -> route -> gather -> policy -> rerank -> diversify -> suppress -> budget -> render
 *
 * 两条硬约束：
 * 1. 召回失败或超时一律降级为空注入，绝不让记忆模块拖慢或打断聊天；
 * 2. 召回内容注入 user 消息尾部而不是 system，保持系统前缀稳定以命中上游提示词缓存。
 */

import {dedupeHits} from './store/hit.js'
import {getMemoryStore} from './store/index.js'
import {scoreMemory} from './policy.js'
import {calcMessagesTokenCount} from '../../openai/util.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)

/** 无信息量的检索词，命中它们不如不召回 */
const STOP_TERMS = new Set(['继续', '然后', '还有', '为什么', '怎么办', '请问', '谢谢', '帮我', '一下', '这个', '那个'])

/** 归档检索是子串匹配，超过这个长度的整句几乎不可能原样出现在历史里，留着只会拖慢查询 */
const MAX_TERM_LEN = 16

/**
 * @description 解析检索词。
 * 仓库没有中文分词依赖，这里只按标点切句并丢掉不可能命中的长串；
 * 语义匹配交给原子检索与（Q3 之后的）向量源，原始事件检索只当短词兜底。
 * @author xianyang
 * @param {String} query 用户问题
 * @returns {String[]} 去重后的检索词
 */
export function parseQuery(query) {
    if (typeof query !== 'string' || !query.trim()) {
        return []
    }
    const parts = query
        .split(/[\s,，。.;；:：!！?？、~`'""''()（）\[\]【】{}%\-_/\\|]+/)
        .map(_ => _.trim())
        .filter(_ => _.length >= 2 && _.length <= MAX_TERM_LEN)
        .filter(_ => !STOP_TERMS.has(_))
    return [...new Set(parts)].slice(0, 6)
}

/**
 * @description 决定本次要走哪些召回源
 * @author xianyang
 * @param {Object} params 入参
 * @returns {String[]} 源名列表
 */
export function routeSources({hasTerms, entityResolved, vectorCapable}) {
    const routes = ['atom']
    if (hasTerms) {
        routes.push('raw')
    }
    if (entityResolved) {
        routes.push('entity')
    }
    if (vectorCapable) {
        routes.push('vector')
    }
    return routes
}

/**
 * @description 持久命中足够时压制原始事件回退，并排除本会话自己的内容
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Object[]} 过滤后的条目
 */
export function applyRawPolicy({atoms = [], events = [], currentConversationCode, suppressRaw = true, minDurable = 2}) {
    const outside = (events || []).filter(e => !currentConversationCode || e.conversationCode !== currentConversationCode)
    if (suppressRaw && atoms.length >= minDurable) {
        return []
    }
    return outside
}

/**
 * @description 每主题限额，避免同一主题堆满窗口
 * @author xianyang
 * @param {Object[]} items 已排序条目
 * @param {Number} cap 每主题上限
 * @returns {Object[]} 保留的条目
 */
export function diversify(items, cap = 2) {
    const seen = new Map()
    const kept = []
    for (const item of items || []) {
        const topic = item.topic || 'general'
        const n = seen.get(topic) || 0
        if (n >= cap) {
            continue
        }
        seen.set(topic, n + 1)
        kept.push(item)
    }
    return kept
}

/**
 * @description 与 owner 文档重复的条目抑制掉，避免同一句话注入两遍。
 * 除 Jaccard 外还认子集关系：owner 文档常省略"用户是…"这类主语，仅靠相似度会漏。
 * @author xianyang
 * @param {Object[]} items 条目
 * @param {String} manualContext owner 文档合并文本
 * @param {Number} dupAt 重复阈值
 * @returns {Object[]} 保留的条目
 */
export async function suppressAgainstManualContext(items, manualContext, dupAt = 0.92) {
    if (!manualContext || !items?.length) {
        return items || []
    }
    const {similarity, isContained} = await import('./promotion.js')
    const docLines = String(manualContext).split(/\r?\n/).map(_ => _.trim()).filter(Boolean)
    if (!docLines.length) {
        return items
    }
    return items.filter(item => {
        for (const line of docLines) {
            if (similarity(item.content, line) >= dupAt || isContained(item.content, line)) {
                return false
            }
        }
        return true
    })
}

/**
 * @description 按 token 预算裁剪，超限时丢分低的而不是丢字符
 * @author xianyang
 * @param {Object[]} items 已按分数降序
 * @param {Number} budget token 预算
 * @param {Object} [options] 计数选项
 * @returns {{kept: Object[], droppedCount: Number, tokens: Number}} 结果
 */
export function budgetCut(items, budget, options) {
    const kept = []
    let tokens = 0
    let droppedCount = 0
    for (const item of items || []) {
        const cost = calcMessagesTokenCount([{role: 'user', content: item.content}], options)
        if (tokens + cost > budget) {
            droppedCount++
            continue
        }
        tokens += cost
        kept.push({...item, tokens: cost})
    }
    return {kept, droppedCount, tokens}
}

/**
 * @description 渲染为注入模型的一段文本
 * @author xianyang
 * @param {Object[]} items 条目
 * @returns {String} 文本，无内容时空串
 */
export function renderRecall(items) {
    if (!items?.length) {
        return ''
    }
    const body = items.map(item => {
        const day = item.insertTime ? new Date(item.insertTime).toISOString().slice(0, 10) : ''
        const tag = [item.atomCode ? `记忆 ${String(item.atomCode).slice(0, 8)}` : '近期对话', day].filter(Boolean).join(' | ')
        return `- ${item.content}（${tag}）`
    })
    return ['## 已知记忆', ...body, ''].join('\n')
}

/**
 * @description 单个来源的超时保护
 * @author xianyang
 * @param {Promise} promise 任务
 * @param {Number} ms 超时毫秒
 * @param {String} label 源名
 * @returns {Promise<Object[]|null>} 失败或超时返回 null
 */
export function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(null), ms)),
    ]).catch(e => {
        logger().warn(`记忆召回源 ${label} 失败: ${e.message}`)
        return null
    })
}

/**
 * @description 组装召回注入内容
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object[]} [params.atoms] 命中的原子
 * @param {Object[]} [params.events] 命中的原始事件（兜底）
 * @param {Object[]} [params.entities] 命中的实体页
 * @param {String} [params.manualContext] owner 文档
 * @param {String} [params.currentConversationCode] 本会话标识，需排除
 * @param {Number} [params.budget] token 预算
 * @param {Object} [params.tokenizerOptions] 计数选项
 * @param {Object} [params.config] 召回配置
 * @param {Number|String|Date} [params.now] 基准时间
 * @returns {Promise<Object>} {text, items, stats}
 */
export async function composeRecall({
    atoms = [], events = [], entities = [], manualContext = '',
    currentConversationCode, budget = 1500, tokenizerOptions, config: cfg, now = Date.now(),
} = {}) {
    const pool = [
        ...entities.map(e => ({...e, kind: e.kind || 'entity'})),
        ...atoms.map(a => ({...a, kind: a.kind || 'atom'})),
    ]
    /**
     * 相关度必须先在同批内归一，再乘来源权重。
     * 各后端的分数量纲不同（词法是 0-1 覆盖度、向量可能是 0.3-0.6 的余弦），
     * 直接乘 sourceWeight(user_save=3) 会让"用户主动保存"永远盖过"最相关的那条"，
     * 实测语义召回因此从最高命中率掉到与不召回持平。
     */
    const maxScore = pool.reduce((m, i) => Math.max(m, Number(i.score) || 0), 0) || 1
    const weighted = pool.map(item => {
        const raw = Number(item.score)
        return {
            ...item,
            score: scoreMemory({
                lexical: Number.isFinite(raw) ? raw / maxScore : 1,
                confidence: item.confidence ?? 0.5,
                source: item.source || 'auto',
                insertTime: item.insertTime ?? now,
                config: {sourceWeight: cfg?.sourceWeight, recall: cfg?.recall},
                now,
            }),
        }
    })

    const fallback = applyRawPolicy({
        atoms: weighted,
        events,
        currentConversationCode,
        suppressRaw: cfg?.recall?.suppressRaw,
        minDurable: cfg?.recall?.minDurable ?? 2,
    }).map(e => ({
        atomCode: null,
        content: typeof e.content === 'string' ? e.content.slice(0, 300) : '',
        topic: e.topic || 'recent',
        confidence: 0,
        source: 'raw',
        insertTime: e.insertTime ?? now,
        score: 0.2,
    }))

    const ranked = dedupeHits([...weighted, ...fallback])
        .map(h => (h.atom ? h : {...h}))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    /** 同主题两代说法先塌缩成一条，再谈每主题限额 */
    const collapsed = await suppressStaleSiblings(ranked, {
        overlapSimilarity: cfg?.recall?.siblingOverlapSimilarity ?? 0.25,
        dupSimilarity: cfg?.promotion?.dupSimilarity,
    })
    const deduped = await suppressAgainstManualContext(
        diversify(collapsed, cfg?.recall?.perTopicCap ?? 2),
        manualContext,
        cfg?.promotion?.dupSimilarity,
    )
    const {kept, droppedCount, tokens} = budgetCut(deduped, budget, tokenizerOptions)
    return {
        text: renderRecall(kept),
        items: kept,
        stats: {
            atoms: atoms.length, events: events.length, entities: entities.length,
            ranked: ranked.length, kept: kept.length, budgetDropped: droppedCount,
            siblingsDropped: ranked.length - collapsed.length, tokens, budget,
        },
    }
}

/**
 * @description 面向一次聊天请求的召回：查存储、拼注入文本
 *
 * 总开关与频道门禁由调用方判定；本函数任何异常都返回空注入，不向上抛。
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.userCode 用户标识
 * @param {String} params.channel 频道标识
 * @param {String} [params.workspaceId] 沙箱工作区
 * @param {String} params.query 当前问题
 * @param {String} [params.conversationCode] 当前会话
 * @param {Number} [params.budget] token 预算
 * @param {Object} [params.tokenizerOptions] 计数选项
 * @returns {Promise<Object>} {text, items, stats, fromCache}
 */
export async function recallForPrompt({
    userCode, channel, workspaceId = null, query, conversationCode,
    budget, tokenizerOptions,
} = {}) {
    const empty = {text: '', items: [], stats: null, fromCache: false}
    if (!userCode || !channel || !query) {
        return empty
    }
    const cfg = llm.config.memory || {}
    const timeoutMs = cfg.recall?.timeoutMs ?? 800
    const tokenBudget = budget ?? cfg.recall?.tokens ?? 1500
    let cacheKey = null
    try {
        const {md5} = await import('../../../tools/security.js')
        const redisClient = (await import('../../../daos/cache/redisClient.js')).default
        cacheKey = `mem:recall:${userCode}:${channel}:${md5(`${workspaceId || ''}|${query}`)}`
        const cached = await withTimeout(redisClient.getValue(cacheKey), timeoutMs, 'cache')
        if (cached?.items) {
            return {text: cached.text || '', items: cached.items || [], stats: cached.stats, fromCache: true}
        }
        const terms = parseQuery(query)
        const store = await getMemoryStore()
        const routes = routeSources({
            hasTerms: terms.length > 0,
            entityResolved: false,
            vectorCapable: store.capabilities?.has?.('semantic'),
        })

        const gather = []
        const labels = []
        for (const route of routes) {
            if (route === 'atom' || route === 'vector') {
                labels.push(route)
                gather.push(withTimeout(store.search({
                    userCode, channel, workspaceId, text: query, topK: cfg.recall?.topK ?? 12,
                    minConfidence: cfg.recall?.minConfidence ?? 0,
                }), timeoutMs, route))
                continue
            }
            if (route === 'raw') {
                labels.push('raw')
                gather.push(withTimeout(gatherRawEvents({userCode, channel, workspaceId, terms, limit: 8}), timeoutMs, 'raw'))
            }
        }
        const settled = await Promise.all(gather)
        const hits = []
        const rawEvents = []
        settled.forEach((res, i) => {
            if (!res) {
                return
            }
            if (labels[i] === 'raw') {
                rawEvents.push(...res)
            } else {
                hits.push(...res)
            }
        })

        const profile = await withTimeout(loadManualContext({userCode, channel, workspaceId}), timeoutMs, 'profile')
        const composed = await composeRecall({
            atoms: hits, events: rawEvents, manualContext: profile?.text || '',
            currentConversationCode: conversationCode,
            budget: tokenBudget, tokenizerOptions, config: cfg,
        })
        const result = {...composed, fromCache: false, docVersion: profile?.docVersion ?? 0}
        if (composed.items.length) {
            /** 只缓存注入文本与条目，避免把 owner 文档原样回传给别的请求 */
            await withTimeout(redisClient.setValue(
                cacheKey,
                {text: composed.text, items: composed.items, stats: composed.stats},
                cfg.recall?.cacheTtlSeconds ?? 600,
            ), timeoutMs, 'cache-write')
        }
        return result
    } catch (e) {
        logger().error(`记忆召回异常，降级为空注入(${userCode}/${channel}): ${e.message}`)
        return empty
    }
}

/**
 * @description 无持久命中时回退到近期原始事件
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Promise<Object[]>} 事件列表
 */
export async function gatherRawEvents({userCode, channel, workspaceId = null, terms = [], limit = 8}) {
    if (!terms.length) {
        return []
    }
    const memoryEventDac = (await import('../../../daos/core/dac/memoryEventDac.js')).default
    const MemoryStatusEnum = (await import('../../../daos/core/enum/MemoryStatusEnum.js')).default
    /** 只回退"仍可用"的事件：已退役/被替代的事实其证据事件会被降级，不能再从归档里注回来 */
    const injectableStates = [MemoryStatusEnum.active.value, MemoryStatusEnum.review.value]
    const buckets = await Promise.all(terms.slice(0, 3).map(term => withTimeout(
        memoryEventDac.getTop(limit, {userCode, channel, workspaceId, content: term, states: injectableStates}, {insertTime: -1}),
        600, 'raw-event',
    )))
    const map = new Map()
    for (const rows of buckets) {
        for (const row of rows || []) {
            if (row?.eventCode && !map.has(row.eventCode)) {
                map.set(row.eventCode, row)
            }
        }
    }
    return [...map.values()].slice(0, limit)
}

/**
 * @description 读 owner 文档（USER/MEMORY 等价物），作为注入去重基准
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Promise<Object>} {text, docVersion}
 */
export async function loadManualContext({userCode, channel, workspaceId = null}) {
    const memoryProfileDac = (await import('../../../daos/core/dac/memoryProfileDac.js')).default
    const doc = await memoryProfileDac.getByNamespace(userCode, channel, workspaceId)
    if (!doc) {
        return {text: '', docVersion: 0}
    }
    const text = [doc.userDoc, doc.memoryDoc].filter(_ => _ && _.trim()).join('\n')
    return {text, docVersion: doc.docVersion || 0}
}

/**
 * @description 同主题的"两代说法"只注入较新的一条。
 * PR-5 记录过：短句改词的相似度（实测 0.2813）低于晋升侧的冲突阈值 0.55，
 * 于是库里会并存一条旧说法与一条新说法；而同用户毫不相干的两条事实在相同字面前缀下
 * 只有 0.087~0.1455，所以 [overlapAt, dupAt) 这一段正是"同一件事的两种说法"的可分区间。
 * 只处理**注入侧**同时出现的问题：不改库、不判定谁对，旧事实仍是可回溯的证据。
 * @author xianyang
 * @param {Object[]} items 已排序条目
 * @param {Object} [opts] 阈值
 * @param {Number} [opts.overlapSimilarity] 认定"同一件事"的最低相似度
 * @param {Number} [opts.dupSimilarity] 认定为重复的相似度
 * @returns {Promise<Object[]>} 保留的条目
 */
export async function suppressStaleSiblings(items, opts = {}) {
    const overlapAt = opts.overlapSimilarity ?? 0.25
    const dupAt = opts.dupSimilarity ?? 0.92
    if (!items?.length || items.length < 2) {
        return items || []
    }
    const {similarity, isContained} = await import('./promotion.js')
    const byTopic = new Map()
    for (const item of items) {
        const topic = item.topic || 'general'
        if (!byTopic.has(topic)) {
            byTopic.set(topic, [])
        }
        byTopic.get(topic).push(item)
    }
    const drop = new Set()
    for (const list of byTopic.values()) {
        if (list.length < 2) {
            continue
        }
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i]
                const b = list[j]
                if (!a.content || !b.content || isContained(a.content, b.content)) {
                    continue
                }
                const sim = similarity(a.content, b.content)
                if (sim < overlapAt || sim >= dupAt) {
                    continue
                }
                /** 同一件事的两种说法：留新的，旧的不再占用注入预算（详情与归档仍可查） */
                const at = new Date(a.insertTime || 0).getTime()
                const bt = new Date(b.insertTime || 0).getTime()
                const older = bt > at ? a : b
                drop.add(older.atomCode || older.content)
            }
        }
    }
    if (!drop.size) {
        return items
    }
    return items.filter(item => !drop.has(item.atomCode || item.content))
}
