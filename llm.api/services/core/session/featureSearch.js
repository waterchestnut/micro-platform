/**
 * @fileOverview 功能目录检索判据（platform-feature-map Phase 1 刀2，纯函数）
 * @module services/core/session/featureSearch
 * @description
 * 目录条目的关键词匹配与打分——**判定与 IO 分离**：读库/取权限在 featureCatalogTool 壳，
 * 这里只管"给一批已过滤可见的条目 + 关键词，排出 top-k 并给出模型可直接引用的形状"。
 * 性格三条：
 * 1. **中文友好**：不做分词（没有分词依赖可指望），用"整串包含 + 字符 2-gram 重合率"两级——
 *    "导出周报" 能命中 "支持批量导出各类报告" 靠的是重合率不是词表；
 * 2. **排序确定性**：同分按 skillCode 定序——检索结果顺序进了 prompt 就不能每次不一样
 *    （golden 可复现纪律对运行时组装的同等要求）；
 * 3. **miss 统一形状（V4）**：命中 0 条与"条目不存在/无权限"是同一个返回
 *    （matched:[] + 同一 hint），不给存在性 oracle 留第二形状——权限过滤在上游做完，
 *    这里根本不知道"被拒的条目"存在。
 */

/** 条目的可搜索文本（title + description + clientCode + menuPath 拼面） */
export function entryText(entry = {}) {
    return [entry.title, entry.description, entry.clientCode, entry.menuPath]
        .filter((x) => typeof x === 'string' && x.trim())
        .join(' ')
        .toLowerCase()
}

/** 字符 2-gram 集合（<2 字符退化为单字集合） */
function bigrams(s) {
    const set = new Set()
    if (s.length < 2) { if (s) set.add(s); return set }
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
}

/**
 * @description 单条打分（0 分=不相关，不硬凑最低分）
 * @param {Object} entry {title, description, clientCode, menuPath, skillCode}
 * @param {String} keyword 原始关键词
 * @returns {Number} 分数
 */
export function scoreEntry(entry, keyword) {
    const kw = String(keyword || '').trim().toLowerCase()
    if (!kw) return 0
    const text = entryText(entry)
    if (!text) return 0
    let score = 0
    if (text.includes(kw)) score += 10
    const a = bigrams(kw)
    const b = bigrams(text)
    let inter = 0
    for (const g of a) if (b.has(g)) inter++
    // 相关性基础分：共享任一 2-gram 即"同域相关"（"导出报告"与"批量导出周报"共享"导出"）——
    // 纯覆盖率会被长短不对称腰斩（1/3 覆盖=1 分，够不着 minScore），核心词共现必须有底分；
    // 覆盖加成保留（越多 gram 对上越相关），零共现=0 分不硬凑
    if (inter > 0) score += 2 + Math.min(inter, 5)
    if (a.size) score += 2 * (inter / a.size)
    return Math.round(score * 100) / 100
}

/**
 * @description 检索：过滤>打分>确定性排序>截断>引用形状
 * @param {Object} p
 * @param {Array}  [p.entries] 已按权限过滤的可见条目（decideFeatureAccess 通过的）
 * @param {String} [p.keyword] 用户意图关键词
 * @param {Number} [p.topK=5] 截断
 * @param {Number} [p.minScore=2] 相关性下限（低于=噪声不推——"没有匹配"比"推了不相干"诚实）
 * @returns {{matched:Array, total:Number}} matched 项=模型可引用形状（skillCode/title/
 *          description/effect/entryUrl——只出目录内字段，无自由生成面）
 */
export function searchFeatures({ entries = [], keyword = '', topK = 5, minScore = 2 } = {}) {
    const scored = []
    for (const e of (Array.isArray(entries) ? entries : [])) {
        if (!e || typeof e !== 'object') continue
        const score = scoreEntry(e, keyword)
        if (score >= minScore) scored.push({ e, score })
    }
    scored.sort((x, y) => (y.score - x.score) || String(x.e.skillCode || '').localeCompare(String(y.e.skillCode || '')))
    const k = Number(topK) > 0 ? Number(topK) : 5
    const matched = scored.slice(0, k).map(({ e, score }) => ({
        skillCode: e.skillCode || '',
        title: e.title || '',
        description: e.description || '',
        effectClass: e.effectClass || '',
        entryUrl: (e.entry && e.entry.url) || '',
        score,
    }))
    return { matched, total: scored.length }
}

export default { entryText, scoreEntry, searchFeatures }
