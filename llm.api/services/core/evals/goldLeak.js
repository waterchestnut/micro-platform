/**
 * @fileOverview gold answer 防泄漏判据（D32/§15 line 1018：gold 不得出现在任何可检索面）
 * @module services/core/evals/goldLeak
 * @description
 * 已验证主流基准存在"参考答案被放进任务配置让 agent 读到"的评测机制漏洞——我们会往上下文塞
 * RAG 片段与 artifact，所以这条是硬约束（验收 20：**扫描必须零命中**）。本模块是判据，取数在调用方：
 * surfaces 传 `[{surface, ref, text}]`（RAG 库导出、memoryAtom 文本、artifact 正文、技能文档……）。
 *
 * 三条判据裁定：
 * 1. **归一化再比**：大小写、空白折叠、零宽/双向控制符剥离（不可见表与 skillScan **同一份**，
 *    ajv 式漂移就是"两份表漏过的是另一份"）——gold 里塞 ZWSP 绕过扫描是廉价攻击，先堵上；
 * 2. **短 gold 不模糊匹配**：低于 `minExactLen` 的 gold（"是"/"42"）在任何语料里都会误命中，
 *    判 `skipped-short` 并**计入报告**——静默跳过等于把"没扫"伪装成"扫过没事"；
 * 3. **报告不含 gold 原文与命中上下文原文**：泄漏报告本身若带原文，它就成了新的泄漏面（skillScan
 *    头注第 2 条同款推理）。证据只给 {start, len, hash}。
 */

import {createHash} from 'node:crypto'
import {INVISIBLE_CODEPOINTS} from '../skill/skillScan.js'

const INVISIBLE_RE = new RegExp(`[${INVISIBLE_CODEPOINTS.map((x) => String.fromCodePoint(x.cp)).join('')}]`, 'g')

/**
 * @description 扫描用归一化（剥不可见字符 → 小写 → 空白折叠）。导出供测试钉性质。
 * @param {String} s 原文
 * @returns {String} 归一形
 */
export function normalizeForScan(s) {
    return String(s ?? '').replace(INVISIBLE_RE, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const hashOf = (s, len = 12) => createHash('sha256').update(s).digest('hex').slice(0, len)

/**
 * @description 扫一批 gold 是否出现在一批可检索面上
 * @param {Object} params 入参
 * @param {Object[]} params.golds [{caseId, answer}]
 * @param {Object[]} params.surfaces [{surface, ref, text}]
 * @param {Number} [params.minExactLen=24] 短 gold 阈值（归一化后长度）
 * @returns {{hits:Array, skippedShort:Array, clean:Boolean, counts:Object}} 报告（无 gold 原文）
 */
export function scanGoldLeak({golds = [], surfaces = [], minExactLen = 24} = {}) {
    const hits = []
    const skippedShort = []
    const prepared = (Array.isArray(surfaces) ? surfaces : [])
        .map((s) => ({surface: String(s?.surface || ''), ref: String(s?.ref || ''), norm: normalizeForScan(s?.text)}))
        .filter((s) => s.norm)
    for (const g of (Array.isArray(golds) ? golds : [])) {
        const caseId = String(g?.caseId || '')
        const gold = normalizeForScan(g?.answer)
        if (!gold) continue
        if (gold.length < minExactLen) {
            skippedShort.push({caseId, len: gold.length, reason: 'gold 过短，模糊匹配必误报——计入未覆盖而非假装扫过'})
            continue
        }
        for (const s of prepared) {
            let at = s.norm.indexOf(gold)
            while (at !== -1) {
                hits.push({caseId, surface: s.surface, ref: s.ref, at, len: gold.length, goldHash: hashOf(gold)})
                at = s.norm.indexOf(gold, at + 1)
            }
        }
    }
    return {
        hits, skippedShort,
        clean: hits.length === 0,
        counts: {golds: golds.length, surfaces: prepared.length, hits: hits.length, skippedShort: skippedShort.length},
    }
}

/**
 * @description 报告自检：泄漏扫描的输出**自身不得携带任何 gold 归一前的原文片段**（序列化后按 goldHash 反查）。
 * 这是给自己加的回归门：将来谁往 hit 里加 `context` 字段，这条先红。
 * @param {Object} report `scanGoldLeak` 的产物
 * @param {Object[]} golds 同一批 golds
 * @returns {Boolean} 是否自净
 */
export function reportIsSelfClean(report, golds = []) {
    const serialized = JSON.stringify(report)
    for (const g of golds) {
        const raw = String(g?.answer ?? '')
        if (raw.length >= 8 && serialized.includes(raw)) return false
    }
    return true
}

export default {normalizeForScan, scanGoldLeak, reportIsSelfClean}
