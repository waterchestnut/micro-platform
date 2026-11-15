/**
 * @fileOverview sleep-time 记忆整理的纯判据（PR-O 剩余面的判据先行刀；执行壳随 cron 窗口）
 * @module services/core/memory/sleepTime
 * @description
 * §13 line 989 的整理 agent 拆两层：这一件只回答"该不该动、动谁是可证明的"，
 * 模型调用与落库在执行壳（cron 窗口批）——PR-K2 同款节奏：**判据先行，接线等读数**。
 *
 * 三条边界决定（都有出处）：
 *   1. **判据不猜语义冲突**：只有包含（isContained）与高相似（dupSimilarity）这两类可证明关系
 *      进合并计划；"同主题相反陈述"交给整理 agent 的模型面——判据装懂语义就是 §2F 家族的老错。
 *   2. **软退役优先，硬删不存在**（promotion 规则 3 的整理侧延伸）：所有动作最多产出 retired/替代，
 *      被并条目永远留证据链（mergedInto）——记忆不可逆操作在无人审的路径上不开放。
 *   3. **整理 agent 的输入是 raw**（§5.4 铁律一在记忆域的搬运）：prompt 只装 episode/atom 原文，
 *      绝不把"上一轮整理的输出"再喂回去；解析保守到全 NOOP。
 * namespace 纪律：整理只在 userCode+channel+workspaceId 内做（记忆按说话人归属，跨人整理=污染）。
 */

import {similarity, isContained, normalizeText} from './promotion.js'

/** 整理动作的允许类型——白名单在判据层，执行壳只认这几种 */
export const CONSOLIDATION_ACTIONS = ['merge', 'retire-superseded', 'distill', 'noop']

/** 整理 agent 可产出的新 atom kind：只有提炼类，不产新的 episode（episode 是采集面的产物） */
export const DISTILLABLE_KINDS = ['decision', 'preference']

/**
 * @description 可证明关系的合并计划（同 namespace 的 atom 清单 → 动作列表）
 * @param {Object[]} atoms [{atomCode, kind, text, confidence, insertTime, pinned?}]
 * @param {Object} [opts] {now, dupSimilarity=0.92, minConfidenceKeep=0.6}
 * @returns {{actions: Object[], pairsExamined: Number}} 计划（不落地；落地在执行壳）
 *
 * pinned 条目（用户显式保存）永不进被并侧——promotion 硬规则 2 的整理侧搬运。
 * 合并保留方：confidence 高者；相等时先入库者（时间可解释，不引入随机）。
 */
export function planConsolidation(atoms = [], opts = {}) {
    const {now = Date.now(), dupSimilarity = 0.92} = opts
    const list = (Array.isArray(atoms) ? atoms : []).filter((a) => a && a.atomCode && typeof a.text === 'string' && a.text)
    const raw = []
    const awayOf = new Map()
    const mergedAway = new Set()
    let pairsExamined = 0
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i]; const b = list[j]
            if (a.kind !== b.kind) continue
            pairsExamined++
            const sim = similarity(a.text, b.text)
            const contained = isContained(a.text, b.text)
            if (sim < dupSimilarity && !contained) continue
            // 保留方分两种关系：
            //  - 包含 ⇒ 必留**超集**（isContained 是对称谓词，方向由归一化长度定——
            //    留子集并走超集=信息丢失，conf/时间都不许盖过这条）；
            //  - 纯相似（文本等价）⇒ conf 高者，相等取先入库（两者信息量相同，规则只剩确定性）。
            let keep
            if (contained && normalizeText(a.text).length !== normalizeText(b.text).length) {
                keep = normalizeText(a.text).length > normalizeText(b.text).length ? a : b
            } else if ((Number(a.confidence) || 0) !== (Number(b.confidence) || 0)) {
                keep = (Number(a.confidence) || 0) > (Number(b.confidence) || 0) ? a : b
            } else {
                keep = Number(a.insertTime) <= Number(b.insertTime) ? a : b
            }
            const away = keep === a ? b : a
            if (away.pinned === true) continue
            if (mergedAway.has(away.atomCode)) continue
            mergedAway.add(away.atomCode)
            awayOf.set(away.atomCode, keep.atomCode)
            raw.push({type: 'merge', keep: keep.atomCode, away: away.atomCode, evidence: {sim: Number(sim.toFixed(4)), contained}})
        }
    }
    /**
     * 链展平：三条重复会先产出 a→b 再产出 b→c——执行壳不该做传递闭包（两处理解不一致就是分家）。
     * 判据出口保证**每个 away 的 keep 是最终保留方**；展平后自我合并（keep==away）丢弃。
     */
    const follow = (code) => {
        let c = code
        const seen = new Set()
        while (awayOf.has(c) && !seen.has(c)) {
            seen.add(c)
            c = awayOf.get(c)
        }
        return c
    }
    const actions = []
    for (const act of raw) {
        const finalKeep = follow(act.keep)
        if (finalKeep === act.away) continue
        actions.push({...act, keep: finalKeep})
    }
    return {actions, pairsExamined}
}

/**
 * @description 选提炼候选（episode 攒够了才值得花一次大模型调用）
 * @param {Object[]} atoms 同 namespace 的 atom 清单
 * @param {Object} [opts] {now, minEpisodeAgeDays=7, minEpisodes=3, maxPerRun=20}
 * @returns {Object[]} 候选 episode（按 insertTime 升序，稳定可重放）
 */
export function selectDistillCandidates(atoms = [], opts = {}) {
    const {now = Date.now(), minEpisodeAgeDays = 7, minEpisodes = 3, maxPerRun = 20} = opts
    const eps = (Array.isArray(atoms) ? atoms : [])
        .filter((a) => a && a.kind === 'episode' && !a.distilledInto && a.atomCode)
        .filter((a) => {
            const ageDays = (now - Number(a.insertTime || now)) / 86400000
            return ageDays >= minEpisodeAgeDays
        })
        .sort((x, y) => Number(x.insertTime) - Number(y.insertTime))
    if (eps.length < minEpisodes) return []
    return eps.slice(0, maxPerRun)
}

/**
 * @description 整理 agent 的 prompt（铁律搬运：raw 输入、点名存活项、标识符逐字）
 * @param {Object[]} episodes selectDistillCandidates 的产物
 * @param {Object[]} existingAtoms 现存 decision/preference（查重用，只给文本不给 digest）
 * @returns {String} prompt
 */
export function buildConsolidationPrompt(episodes = [], existingAtoms = []) {
    const lines = [
        '你是记忆整理器。输入是同一用户在同一频道/工作区内的原始对话记忆(episode)，',
        '任务：从中提炼出**跨会话仍然成立**的 decision(用户做过的决定)与 preference(稳定偏好)。',
        '规则：',
        '1) 只依据下面给出的原文，不引入外部知识；',
        '2) 必须保留的语境要点：用户明确做过的决定及对象、明确表达的偏好、被反复确认的事实；',
        '3) 文中出现的 URL、文件路径、编号等标识符在新条目里逐字保留；',
        '4) 与"现存条目"重复或矛盾的不产出（重复给 noop，矛盾只允许产出带证据的 supersede 建议）；',
        '5) 输出 JSON 数组，每项 {action:"distill"|"noop", kind:"decision"|"preference", text, evidenceAtomCodes:[...]}，',
        '   没有可提炼的就输出 [{"action":"noop"}]。',
        '',
        '## 原始 episode',
        ...episodes.map((e) => `- [${e.atomCode}] ${e.text}`),
        '',
        '## 现存 decision/preference',
        ...(existingAtoms.length ? existingAtoms.map((a) => `- [${a.atomCode}] ${a.kind}: ${a.text}`) : ['(无)']),
    ]
    return lines.join('\n')
}

/**
 * @description 整理 agent 回复的保守解析（interpretSelfCheckReply 同族：解析不出就不动）
 * @param {String} text 模型输出
 * @param {Object} [ctx] {validAtomCodes:Set, existingDecisionTexts:Set}
 * @returns {Object[]} 过滤后的动作（非法 kind/无证据/未知 atomCode/与现存重复的全部降级为 noop 或丢弃）
 */
export function parseConsolidationReply(text = '', ctx = {}) {
    const {validAtomCodes = new Set(), existingDecisionTexts = new Set()} = ctx
    let arr = null
    const m = /\[[\s\S]*\]/.exec(String(text))
    if (m) {
        try { arr = JSON.parse(m[0]) } catch { arr = null }
    }
    if (!Array.isArray(arr)) {
        return [{action: 'noop', reason: 'unparsed'}]
    }
    const out = []
    for (const item of arr) {
        if (!item || item.action !== 'distill') continue
        if (!DISTILLABLE_KINDS.includes(item.kind)) continue
        const t = String(item.text || '').trim()
        if (!t || t.length > 500) continue
        const ev = Array.isArray(item.evidenceAtomCodes) ? item.evidenceAtomCodes.filter((c) => validAtomCodes.has(c)) : []
        if (!ev.length) continue
        if (existingDecisionTexts.has(t)) continue
        out.push({action: 'distill', kind: item.kind, text: t, evidenceAtomCodes: ev})
    }
    return out.length ? out : [{action: 'noop', reason: 'all-filtered'}]
}

/**
 * @description 执行白名单（执行壳只被允许做这些）：新条目落库、被并条目软退役、episode 打 distilledInto 标
 *  硬删不在白名单里——"记忆不可逆操作在无人审路径上不开放"是这一刀的存在理由。
 * @param {Object} plan {merges:[...], distills:[...]}
 * @returns {{allowed: String[], forbidden: String[]}}
 */
export function consolidationAdvisory() {
    return {
        allowed: ['insert-atom', 'soft-retire-atom(mergedInto|supersededBy)', 'mark-distilled'],
        forbidden: ['hard-delete', 'touch-pinned', 'cross-namespace-write', 'delete-episode'],
    }
}

export default {CONSOLIDATION_ACTIONS, DISTILLABLE_KINDS, planConsolidation, selectDistillCandidates, buildConsolidationPrompt, parseConsolidationReply, consolidationAdvisory}
