/**
 * @fileOverview 记忆候选到原子的晋升判定（纯函数）
 * @module services/core/memory/promotion
 * @description 刻意与数据库操作分离：这里只回答"这条候选该怎么处置"，
 * 落库、索引、日志由 promote.js 执行，便于完整回归判定口径。
 *
 * 三条硬规则（对齐长期记忆系统的通行做法）：
 * 1. 只用结构化来源判定，不靠"像不像报错/像不像追问"的关键词；
 * 2. 用户显式保存的内容优先级最高，不被自动规则丢弃；
 * 3. 冲突不硬删：证据确凿才软退役并留下替代候选，不确定时两条并存。
 */

/** 归一化时剔除的中文标点与空白，避免同句因标点判成两条 */
const NORM_STRIP = /[\s,，。.；;：:!！?？、~`'""''()（）\[\]【】{}%\-_/\\]+/g

/**
 * @description 文本归一化
 * @author xianyang
 * @param {String} text 原文
 * @returns {String} 归一化结果
 */
export function normalizeText(text) {
    return String(text || '').toLowerCase().replace(NORM_STRIP, '')
}

/**
 * @description 切二元组，中英文都适用（中文按字、英文按词）
 * @author xianyang
 * @param {String} text 原文
 * @returns {Set<string>} 特征集合
 */
export function shingles(text) {
    const norm = normalizeText(text)
    const set = new Set()
    if (!norm.length) {
        return set
    }
    /** 整串先行，保证短文本也能完全匹配 */
    set.add(norm)
    for (let i = 0; i + 2 <= norm.length; i++) {
        set.add(norm.slice(i, i + 2))
    }
    for (const w of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (w.length >= 2) {
            set.add(`w:${w}`)
        }
    }
    return set
}

/**
 * @description Jaccard 相似度
 * @author xianyang
 * @param {String} a 文本一
 * @param {String} b 文本二
 * @returns {Number} 0-1
 */
export function similarity(a, b) {
    const sa = shingles(a)
    const sb = shingles(b)
    if (!sa.size || !sb.size) {
        return 0
    }
    let inter = 0
    for (const s of sa) {
        if (sb.has(s)) {
            inter++
        }
    }
    return inter / (sa.size + sb.size - inter)
}

/**
 * @description 一条陈述是否是另一条的子集。
 * Jaccard 会被"用户是…"这类前缀差异摊薄（实测 0.6667 低于 0.92 阈值），
 * 但语义上就是同一句话；短到没有区分度的文本不算包含，避免误伤。
 * @author xianyang
 * @param {String} a 文本一
 * @param {String} b 文本二
 * @param {Number} [minLen] 认定包含所需的最短归一化长度
 * @returns {Boolean} 是否互为子集
 */
export function isContained(a, b, minLen = 8) {
    const na = normalizeText(a)
    const nb = normalizeText(b)
    if (na.length < minLen || nb.length < minLen) {
        return false
    }
    return na.includes(nb) || nb.includes(na)
}

/**
 * @description 判定候选的处置方式
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.candidate 归一化后的候选（含 content/kind/confidence/source/eventCodes）
 * @param {Object[]} [params.existing] 同命名空间内生效中的原子
 * @param {Object} [params.config] 阈值配置
 * @param {Number|Date} [params.now] 基准时间
 * @returns {Object} {action, targetCode, reason, score}
 */
export function decidePromotion({candidate, existing = [], config, now = Date.now()} = {}) {
    if (!candidate || typeof candidate.content !== 'string') {
        return {action: 'reject', targetCode: null, reason: 'invalid_candidate', score: 0}
    }
    const cfg = config || {}
    const autoMin = cfg.autoMinConfidence ?? 0.6
    const dupAt = cfg.dupSimilarity ?? 0.92
    const conflictAt = cfg.conflictSimilarity ?? 0.55
    /** 显式保存与 owner 文档不受自动阈值约束 */
    const protected_ = candidate.source === 'user_save' || candidate.source === 'manual_doc'
    const sameKind = existing.filter(a => (a.kind || 'fact') === (candidate.kind || 'fact'))

    let bestDup = null
    let bestConflict = null
    for (const atom of sameKind) {
        const score = similarity(candidate.content, atom.content)
        if (score >= dupAt && (!bestDup || score > bestDup.score)) {
            bestDup = {atom, score}
        } else if (score >= conflictAt && (!bestConflict || score > bestConflict.score)) {
            bestConflict = {atom, score}
        }
    }

    /** 已有等价事实：不再新增条目，只把新证据并进去，避免同一句话堆积成多条 */
    if (bestDup) {
        return {
            action: 'merge',
            targetCode: bestDup.atom.atomCode,
            reason: 'duplicate_content',
            score: bestDup.score,
        }
    }

    /** 与已有事实高度相关但不等价：可能是更新，也可能是并存的不同侧面 */
    if (bestConflict) {
        const newer = new Date(candidate.insertTime ?? now).getTime() >= new Date(bestConflict.atom.updateTime ?? bestConflict.atom.insertTime ?? 0).getTime()
        const oldWeak = (bestConflict.atom.confidence ?? 0) < autoMin
        /** 证据确凿（本次置信度达标、且旧条目更弱或更早）才允许软退役并留下替代候选 */
        if (!protected_ && candidate.confidence >= autoMin && newer && (oldWeak || bestConflict.atom.source === 'auto')) {
            return {
                action: 'supersede',
                targetCode: bestConflict.atom.atomCode,
                reason: 'conflict_newer_stronger',
                score: bestConflict.score,
            }
        }
        /** 拿不准就并存，交人工判断，绝不静默覆盖用户显式保存的内容 */
        return {
            action: 'review',
            targetCode: bestConflict.atom.atomCode,
            reason: bestConflict.atom.source === 'user_save' ? 'conflicts_user_save' : 'uncertain_conflict',
            score: bestConflict.score,
        }
    }

    if (!protected_ && candidate.confidence < autoMin) {
        return {action: 'review', targetCode: null, reason: 'low_confidence', score: 0}
    }
    return {action: 'promote', targetCode: null, reason: 'no_conflict', score: 1}
}

/**
 * @description 生成 owner 文档变更后的冲突处置
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.atom 现有原子
 * @param {Object[]} params.docLines owner 文档拆出的陈述句
 * @param {Object} [params.config] 阈值配置
 * @returns {Object} {action, reason, score}
 */
export function reconcileWithDocuments({atom, docLines = [], config} = {}) {
    if (!atom) {
        return {action: 'keep', reason: 'no_atom', score: 0}
    }
    const conflictAt = config?.conflictSimilarity ?? 0.55
    let best = null
    for (const line of docLines) {
        const score = similarity(atom.content, line)
        /** owner 文档常省略主语，子集关系与高相似度同等对待 */
        const contained = isContained(atom.content, line)
        if ((score >= conflictAt || contained) && (!best || score > best.score)) {
            best = {line, score: contained ? Math.max(score, conflictAt) : score}
        }
    }
    if (!best) {
        return {action: 'keep', reason: 'no_doc_conflict', score: 0}
    }
    /** owner 手改的文档是权威：可证冲突时软退役旧原子并留下复核候选 */
    if (best.score >= (config?.dupSimilarity ?? 0.92) || isContained(atom.content, best.line)) {
        return {action: 'suppress_duplicate', reason: 'doc_duplicate', score: best.score}
    }
    if (atom.source === 'user_save') {
        return {action: 'keep', reason: 'protected_user_save', score: best.score}
    }
    return {action: 'retire_and_review', reason: 'doc_conflict', score: best.score}
}
