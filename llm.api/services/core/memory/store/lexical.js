/**
 * @fileOverview 词法召回的取词与打分（纯函数）
 * @module services/core/memory/store/lexical
 * @description 为什么中文不能拿整句去匹配：中文没有空格，用户的问题与记忆原文很少共享完整
 * 字面片段（问"今年买电子资源能花多少钱"，记忆里写"2025年数字资源采购预算为120万元"），
 * 整句子串匹配实测命中率与"什么都不召回"没有差别（评测见 docs/memory-plan.md §5.7）。
 * 这里退到**字符 n-gram**：把查询切成 2/3 元组，命中按加权覆盖度计分。
 * 这是无分词依赖下唯一站得住的词法召回形态，也是 PR-12 语义后端上线前的兜底。
 */

/** n-gram 上限，防止超长问题把正则撑爆 */
export const MAX_GRAMS = 60

/** 子句级检索词上限（长句能整段命中时优先信它） */
export const MAX_CLAUSES = 6

/** 只允许字母与数字参与取词，天然规避正则元字符 */
const PLAIN = /[\p{L}\p{N}]/u

/** 正则元字符，拼 alternation 前逐个转义 */
const META = /[.*+?^${}()|[\]\\]/g

/**
 * @description 按标点切子句
 * @author xianyang
 * @param {String} text 文本
 * @returns {String[]} 长度 >=2 的子句
 */
export function clausesOf(text) {
    return String(text || '')
        .split(/[\s,，。.;；:：!！?？、()（）\[\]【】"'`~/\\|\-—…]+/u)
        .map(_ => _.trim())
        .filter(_ => _.length >= 2)
}

/**
 * @description 生成字符 n-gram（2 元与 3 元），在连续字母数字串内部滑动
 * @author xianyang
 * @param {String} text 文本
 * @returns {String[]} 去重后的元组，超出上限截断
 */
export function gramsOf(text) {
    const grams = new Set()
    for (const run of String(text || '').split(/[^\p{L}\p{N}]+/u)) {
        const chars = [...run].filter(_ => PLAIN.test(_))
        for (let n = 2; n <= 3; n++) {
            for (let i = 0; i + n <= chars.length; i++) {
                grams.add(chars.slice(i, i + n).join(''))
            }
        }
    }
    return [...grams].slice(0, MAX_GRAMS)
}

/**
 * @description 元组权重：越长的元组越有区分度
 * @author xianyang
 * @param {String} gram 元组
 * @returns {Number} 权重
 */
export function gramWeight(gram) {
    return gram.length >= 3 ? 2 : 1
}

/**
 * @description 元组总权重
 * @author xianyang
 * @param {String[]} grams 元组
 * @returns {Number} 总权重（至少 1，避免除零）
 */
export function totalGramWeight(grams) {
    return (grams || []).reduce((s, g) => s + gramWeight(g), 0) || 1
}

/**
 * @description 把元组拼成一个安全的 alternation 正则源码
 * @author xianyang
 * @param {String[]} grams 元组
 * @returns {String} 正则源码，无元组时返回空串
 */
export function alternationSource(grams) {
    if (!grams?.length) {
        return ''
    }
    return grams.map(g => g.replace(META, '\\$&')).join('|')
}

/**
 * @description 对候选记忆打词法分
 * @author xianyang
 * @param {Object} atom 候选（含 content/topic）
 * @param {Object} signal 打分信号
 * @param {String[]} [signal.clauses] 查询子句
 * @param {String[]} [signal.grams] 查询元组
 * @param {Number} [signal.totalWeight] 元组总权重，缺省自行计算
 * @returns {Number} 得分，0 表示毫不相关
 */
export function lexicalScore(atom, {clauses = [], grams = [], totalWeight} = {}) {
    const content = String(atom?.content || '')
    if (!content || !grams?.length) {
        return 0
    }
    const weight = totalWeight || totalGramWeight(grams)
    let hit = 0
    for (const g of grams) {
        if (content.includes(g)) {
            hit += gramWeight(g)
        }
    }
    if (!hit) {
        return 0
    }
    /** 覆盖度取平方根：只命中一小半元组也值得一提，但远不如几乎全中 */
    let score = Math.sqrt(hit / weight)
    /** 整子句命中是强信号：问与记说的确实是同一件事 */
    for (const c of clauses) {
        if (c.length >= 4 && content.includes(c)) {
            score += 0.5
        }
    }
    /** 主题命中再加一点，倾向召回同主题记忆 */
    const topic = String(atom?.topic || '')
    if (topic && grams.some(g => topic.includes(g))) {
        score += 0.2
    }
    return score
}

export default {clausesOf, gramsOf, gramWeight, totalGramWeight, alternationSource, lexicalScore}
