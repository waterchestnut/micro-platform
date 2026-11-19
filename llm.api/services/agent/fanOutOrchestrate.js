/**
 * @fileOverview fan-in 后的编排决策+备料接缝（PR-任务编排 C/M3 承重件，纯函数）
 * @module services/agent/fanOutOrchestrate
 * @description
 * 把 `fanIn`（归约/分节）与 `arbitrationPolicy`（失败裁决）这两个"离线孤岛"**缝成一个可被编排层一处消费的结构**：
 * 子任务都到终局后，root 下一步做什么（synthesize/retry/replan/report）+ 那一步要的料（分节正文/待重跑清单）。
 * 这是 §9 说的"把孤岛接到父任务生命周期"之前，先把**组合判据**做扎实、可离线穷举的一块——接线层只调本件、
 * 再据 `action` 去 spawn / 调综合 / emit `taskEvents`，不自己重算任何事实。
 *
 * 三条边界（红线，全在用例里钉）：
 * 1. **不编造最终答案**：synthesize 只"备料"（分节 + 现成 markdown + 计数），把子结果综合成一段话是后续一次带该
 *    输入的 run/agentChat（IO），属接线方；本件绝不假装自己会综合。
 * 2. **不粉饰**：usable:false 的节照样陈列并标注（承 fanIn），空正文/失败绝不被"综合完成"掩盖——这与 `arbitrate`
 *    的"永不 synthesize 掩盖失败"是同一条纪律的两端。
 * 3. **计数同源**：`counts` 一律取 `reduceFanIn` 的产物、`settled` 取 `toArbitrationInput` 的终局判定，
 *    不在本件里另起一套统计（"同一个数存两处会分叉"，D66）。
 *
 * 与 `fanOutPlanner` 一样属**扇出侧**（`fanOut*` 命名），与单轮内 todo 的 `plan` 无关。
 */
import { reduceFanIn, renderSections, toArbitrationInput } from './fanIn.js'
import { arbitrate, DEFAULT_MAX_RETRY, DEFAULT_MAX_REPLAN } from './arbitrationPolicy.js'

/**
 * @description 子任务结果集 → root 的下一步编排动作 + 备料
 * @param {Object} [p]
 * @param {Array}  [p.children] 子任务结果，元素 `{agentCode, title, handleStatus, handleRet:{content,usable,progress,reason,retryable,credits?}}`
 * @param {Number} [p.retryCount] 本 root 已重试轮次
 * @param {Number} [p.replanCount] 本 root 已换方案次数
 * @param {Number} [p.maxRetry] 重试上限（转 arbitrate，默认 2）
 * @param {Number} [p.maxReplan] 换方案上限（转 arbitrate，默认 1）
 * @param {Boolean} [p.withHeader] renderSections 是否带标题（默认 true）
 * @returns {{action:'synthesize'|'retry'|'replan'|'report', reason:String, settled:Boolean,
 *            retryAgents:String[], counts:{success,usable,failed,total}, credits:Object,
 *            input:Object}} 下一步动作 + 该动作所需载荷
 */
export function decideFanOutNext({
    children,
    retryCount = 0,
    replanCount = 0,
    maxRetry = DEFAULT_MAX_RETRY,
    maxReplan = DEFAULT_MAX_REPLAN,
    withHeader = true,
} = {}) {
    // 1) 归约（分节 + 计数 + credits rollup）——计数的唯一来源
    const reduced = reduceFanIn(children)
    // 2) 裁决输入与终局判定同取自 fanIn 的映射，避免与 arbitrate 各读各的
    const arbInput = toArbitrationInput(children)
    const settled = !arbInput.some((s) => s.handleStatus === 0 || s.handleStatus === 1)

    // 3) 失败裁决（转 arbitrate，不重造阈值/优先级）
    const decision = arbitrate({ subtasks: arbInput, retryCount, replanCount, maxRetry, maxReplan })
    const counts = {
        success: reduced.successCount,
        usable: reduced.usableCount,
        failed: reduced.failedCount,
        total: reduced.total,
    }
    // 4) 备料：分节正文（失败/空也占节并标注）——synthesize/report 都用它，retry/replan 带已成节
    const sectionsText = renderSections(reduced, { withHeader })
    const baseInput = { sections: reduced.sections, counts, credits: reduced.credits }

    switch (decision.action) {
        case 'synthesize':
            // 只"备料"给综合执行体；usable=0 也照此返回，由 counts.usable 如实说明"没有可用正文"，不在此假装
            return {
                action: 'synthesize', reason: decision.reason, settled, retryAgents: [],
                counts, credits: reduced.credits,
                input: { ...baseInput, sectionsText },
            }
        case 'retry':
            // 重跑清单交编排层用现有 appendAgents；带上已成的节，别把成功的重算
            return {
                action: 'retry', reason: decision.reason, settled, retryAgents: decision.retryAgents,
                counts, credits: reduced.credits,
                input: { ...baseInput, sectionsText },
            }
        case 'replan':
            // 换方案是 planner 的事（缩小/改路径）——本件只如实说"该 replan + 失败项"，不自己改计划
            return {
                action: 'replan', reason: decision.reason, settled, retryAgents: [],
                counts, credits: reduced.credits,
                input: { ...baseInput, failedSections: reduced.sections.filter((s) => !s.usable) },
            }
        default:
            // report：含 partial / exhausted / no-subtasks / not-settled，全部带失败标注的正文，不伪装完整
            return {
                action: 'report', reason: decision.reason, settled, retryAgents: [],
                counts, credits: reduced.credits,
                input: { ...baseInput, sectionsText },
            }
    }
}

export default { decideFanOutNext }
