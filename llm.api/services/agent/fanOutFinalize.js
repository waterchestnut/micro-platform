/**
 * @fileOverview root 完成时的编排收尾：状态映射 + 聚合 + 派发指令（PR-任务编排 C/M4 承重件，纯函数）
 * @module services/agent/fanOutFinalize
 * @description
 * fan-out root 的所有 children 到终局后，编排层要回答两件事：**root 该置什么状态** + **接线层接下来该做什么**
 * （综合落 root / 重跑某几个子 / 换方案 / 就这结果汇报）。本件把 `fanOutOrchestrate.decideFanOutNext`
 * 的决策再映射成"root 写回 + 派活动作"，是 finalize handler（在锁外）跑的**判据核心**。
 *
 * 为什么单列（且为什么强调"锁外"）：现网 `updateParentAgentTaskWithLock` 全程持 redlock 做汇聚，
 * 且已有"锁内定状态、finally 释放后才 sendMessage 派发"的既定模式（agentTask.js:89/97）。
 * 编排的副作用（调模型综合、追加子任务）**绝不能塞进那把持锁的递归汇聚体**——那是持锁调模型，会把建课等
 * 所有现网 fan-out 一起拖炸。所以 finalize 的正确落点是"root 首次到终态 → 锁外派发 finalize task → 该 task 跑本件"。
 * 本件因此**刻意不碰任何锁/库/模型**：只吃已汇聚好的 children，纯算"状态 + 指令"。
 *
 * 三条纪律：
 * 1. **转调不重算**：action/counts/credits/sections 全取自 `decideFanOutNext`（其内又取 fanIn/arbitrate），
 *    本件只做 `action → handleStatus/dispatch` 的映射，不出现第二套裁决/统计（D66 同数两处必分叉）。
 * 2. **未终局不收尾**：`settled:false`（还有 child 在 0/1）⇒ 不下终态、不发综合，标 pending，交回调度器等再汇聚。
 * 3. **不掩盖失败**：synthesize 只在 `arbitrate` 判全成时给；有失败一律 report(→3)/retry(→1)/replan(→1)，
 *    root 状态如实反映"完成含错"，绝不 2。`handleStatus` 引 `AgentHandleStatusEnum`（-1/0/1/2/3）。
 *
 * ⚠️ `handleStatus` 是"编排语义建议值"，接线层若与现网机械汇聚(2/3)有出入可自行覆盖；`credits` 在每子 credits
 *   尚未进 handleRet 前会如实是 `{totalCredits:0, priced:false}`（不假装算过——M6 落库那批才补真值）。
 */
import { decideFanOutNext } from './fanOutOrchestrate.js'

// AgentHandleStatusEnum 口径（-1 error / 0 waiting / 1 handling / 2 success / 3 completed-with-error）
const H = { HANDLING: 1, SUCCESS: 2, COMPLETED_ERROR: 3 }

/**
 * @description 依 children 汇聚结果，算 root 完成态 + 接线层派活动作
 * @param {Object} [p]
 * @param {Array} [p.children] 子任务结果（同 `decideFanOutNext`/`reduceFanIn` 入参）
 * @param {Number} [p.retryCount] root 已重试轮次
 * @param {Number} [p.replanCount] root 已换方案次数
 * @param {String} [p.originalQuery] 触发本次扇出的原始请求（synthesis 落 root 时随附）
 * @returns {{handleStatus:Number, terminal:Boolean, action:String, reason:String, settled:Boolean,
 *            counts:Object, credits:Object,
 *            dispatch:{needSynthesis:Boolean,needRetry:Boolean,needReplan:Boolean,pending:Boolean,retryAgents:String[]},
 *            synthesisInput:Object|null}}
 */
export function finalizeFanOutRoot({ children, retryCount = 0, replanCount = 0, originalQuery = '' } = {}) {    const next = decideFanOutNext({ children, retryCount, replanCount })
    const { action, reason, settled, counts, credits } = next

    // ① 未终局：root 保持"进行中"，不收尾、不综合、不派发（等 children 再汇聚后重算）
    if (!settled) {
        return {
            handleStatus: H.HANDLING, terminal: false, action: 'pending', reason: reason || 'not-settled',
            settled: false, counts, credits,
            dispatch: { needSynthesis: false, needRetry: false, needReplan: false, pending: true, retryAgents: [] },
            synthesisInput: null,
        }
    }

    switch (action) {
        case 'synthesize':
            // 综合落 root：只出"输入"（分节正文 + 原请求 + 事实计数），调不调模型、怎么落是接线层（IO）的事
            return {
                handleStatus: H.SUCCESS, terminal: true, action, reason, settled, counts, credits,
                dispatch: { needSynthesis: true, needRetry: false, needReplan: false, pending: false, retryAgents: [] },
                synthesisInput: {
                    originalQuery,
                    sections: next.input.sections,
                    sectionsText: next.input.sectionsText,   // 转调 decideFanOutNext 已 render 的分节正文，本件不重算
                    counts,
                    credits,
                },
            }
        case 'retry':
            // 还要重跑子任务 ⇒ root 未终（保持进行中）；retryAgents 交接线层用现有 appendAgents/subAgent 机制
            return {
                handleStatus: H.HANDLING, terminal: false, action, reason, settled, counts, credits,
                dispatch: { needSynthesis: false, needRetry: true, needReplan: false, pending: false, retryAgents: next.retryAgents },
                synthesisInput: null,
            }
        case 'replan':
            // 全败且可换方案 ⇒ 交回 planner 重规划；root 未终
            return {
                handleStatus: H.HANDLING, terminal: false, action, reason, settled, counts, credits,
                dispatch: { needSynthesis: false, needRetry: false, needReplan: true, pending: false, retryAgents: [] },
                synthesisInput: null,
            }
        default:
            // report（partial / exhausted / no-subtasks）⇒ 终态，如实"完成含错"(3)，带失败标注的正文；不伪装成功(2)
            return {
                handleStatus: H.COMPLETED_ERROR, terminal: true, action, reason, settled, counts, credits,
                dispatch: { needSynthesis: false, needRetry: false, needReplan: false, pending: false, retryAgents: [] },
                synthesisInput: {
                    originalQuery,
                    sections: next.input.sections,
                    sectionsText: next.input.sectionsText,   // 已含失败/空节的如实标注
                    counts,
                    credits,
                },
            }
    }
}

/**
 * @description 组"自行总结"的综合引导语——刻意不给固定输出模板（属主拍板），只交事实与问题
 * @param {String} originalQuery 触发扇出的原始请求
 * @param {String} sectionsText fanIn 的分节正文（含失败项如实标注）
 * @returns {String} synthesis query
 */
export function buildSynthesisQuery(originalQuery, sectionsText) {
    return '原始问题：' + (originalQuery || '（未给出）')
        + '\n\n以下是本次任务各子项的产出（未完成的已标注）：\n' + (sectionsText || '（无产出）')
        + '\n\n请针对原始问题，综合上述产出直接给出最终回答。'
}

export default { finalizeFanOutRoot, buildSynthesisQuery }
