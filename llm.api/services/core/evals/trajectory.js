/**
 * @fileOverview 轨迹指标：直接吃 `extInfo.segments`（§15 line 1014，零二次埋点）
 * @module services/core/evals/trajectory
 * @description
 * "PR-B 的产物即轨迹"（§2E-3 当时写这句话时预告的就是这里）。三个指标全是纯判据：
 * - `stepEfficiency`：产出过正文的步骤占比——"转了三圈只说了一句话"要能量出来；
 * - `planAdherence`：宣布完成时计划是否真的收口（PR-M 的 plan 与 self-check 段在这汇合）；
 * - `taskCompletion`：回答存在性 + **forcedFinal 显式标注**（"没答案被迫收尾"和"正常做完"
 *   混成一个 1.0 是评测最自欺的形态）。
 *
 * 一条来自 segments 设计的既有约束（§segments 设计约束 2）：`metrics.chars` 永远是**未截断真值**，
 * 所以判"这段有没有内容"看 chars 不看正文——截断只影响存储，不影响事实。
 * 另一条（设计约束 3）：`dropped.count>0` 时轨迹不完整，所有指标必须带 `caveat` 如实声明——
 * **在缺失的轨迹上算出干净数字，比不算更坏**。
 */

import {SEGMENT_KINDS} from '../segments.js'

const PRODUCING = [SEGMENT_KINDS.TOOL_ROUND, SEGMENT_KINDS.FINALIZE, SEGMENT_KINDS.SELF_CHECK, SEGMENT_KINDS.CANCELLED]

const norm = (segments) => (Array.isArray(segments) ? segments.filter((s) => s && typeof s === 'object') : [])

/**
 * @description 步效率：{productive, ratio}；dropped>0 时带 caveat
 * @param {Object[]} segments extInfo.segments
 * @param {Object} [ledgerSummary] {dropped:{count}}（segments 账本的摘要，可缺省）
 */
export function stepEfficiency(segments, ledgerSummary = {}) {
    const list = norm(segments)
    const droppedCount = Number(ledgerSummary?.dropped?.count) || 0
    const productive = list.filter((s) => PRODUCING.includes(s.kind) && (Number(s?.metrics?.chars) || 0) > 0).length
    const out = {steps: list.length, productive, ratio: list.length ? productive / list.length : null}
    if (droppedCount > 0) out.caveat = `轨迹丢弃过 ${droppedCount} 段（早期），ratio 是幸存段的口径不是全轨迹`
    return out
}

/**
 * @description 计划依从：宣布完成（有 answer 段）时 plan 是否收口。
 * 判据只吃"计划已存档案"的事实（extInfo.plan={items:[{status}]}）；无 plan 时**返回 null 不猜**。
 * @param {Object[]} segments 段
 * @param {Object} [plan] 落档计划
 */
export function planAdherence(segments, plan) {
    const list = norm(segments)
    const declaredDone = list.some((s) => s.kind === SEGMENT_KINDS.ANSWER)
    const selfChecked = list.some((s) => s.kind === SEGMENT_KINDS.SELF_CHECK)
    if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
        return {adherent: null, declaredDone, selfChecked, reason: plan ? '无计划条目' : '本轮没有计划档案'}
    }
    const open = plan.items.filter((i) => !['done', 'failed', 'abandoned'].includes(i?.status)).length
    const out = {adherent: open === 0 || (open > 0 && selfChecked), declaredDone, selfChecked, openItems: open}
    if (open > 0 && !selfChecked) out.reason = '仍有未结项就给了最终回答（self-check 未发生或未采纳）'
    return out
}

/**
 * @description 任务完成：回答存在且非空；finalize 收尾单独标注
 * @param {Object[]} segments 段
 * @param {Object} [msg] {answerChars}（message 真值侧的补充，可缺省只看段）
 */
export function taskCompletion(segments, msg = {}) {
    const list = norm(segments)
    const answer = list.find((s) => s.kind === SEGMENT_KINDS.ANSWER)
    const finalize = list.find((s) => s.kind === SEGMENT_KINDS.FINALIZE)
    const answerChars = Number(msg?.answerChars ?? answer?.metrics?.chars) || 0
    const complete = answerChars > 0
    const out = {complete, answerChars}
    if (finalize) out.forcedFinal = true
    if (complete && finalize) out.caveat = '答案经无工具强制收尾产生（finalize），计数之外建议人工抽检'
    if (!complete) out.reason = finalize ? 'finalize 后仍无正文' : '无 answer 段或正文为空'
    return out
}

export default {stepEfficiency, planAdherence, taskCompletion}
