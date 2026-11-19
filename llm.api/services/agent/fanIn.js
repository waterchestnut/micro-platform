/**
 * @fileOverview fan-in 归约：子结果分节陈列 + 仲裁输入 + credits 汇总（PR-任务编排 M3 承重件，纯函数）
 * @module services/agent/fanIn
 * @description
 * child 各自跑完后，`updateParentAgentTaskWithLock` 把子 handleRet 收进父（现状机械汇聚）。本件在其上加
 * 一层"有形状的归约"，直接落实属主拍板 §7-2：**阶段一结构化分节陈列，阶段二会话结束由主智能体综合**。
 * 纯函数、可离线穷举；不碰 IO、不做裁决（裁决在 `arbitrationPolicy`），只把事实摆成可裁决/可展示的形态。
 *
 * 一条一贯纪律：**失败/空正文如实进分节，不粉饰**——usable:false 的子结果照样陈列并标注，
 * 综合阶段与汇报都能看到"哪块没成"，而不是被静默省略（"缺席不装未记录/空不当成有"同族）。
 */

import { rollupCredits } from '../core/session/creditMeter.js'

/**
 * @description 把子 agentTask 结果数组归约成分节结构
 * @param {Object[]} children 元素形如 `{agentCode, title, handleStatus, handleRet:{content,usable,progress,reason,retryable,credits?}}`
 * @returns {{sections:Array, successCount:Number, usableCount:Number, failedCount:Number, total:Number, credits:Object}}
 */
export function reduceFanIn(children = []) {
    const list = (Array.isArray(children) ? children : []).filter(Boolean)
    const sections = list.map((c) => {
        const hr = c.handleRet || {}
        const usable = hr.usable === true && String(hr.content || '').trim().length > 0
        return {
            agentCode: c.agentCode,
            title: c.title || '(未命名子任务)',
            handleStatus: c.handleStatus,
            usable,
            content: usable ? hr.content : '',
            // 不可用时给一句诚实来源，不让它显示成"空白但看起来正常"
            note: usable ? null : (hr.note || hr.reason || (c.handleStatus === -1 ? 'failed' : 'empty')),
        }
    })
    return {
        sections,
        successCount: list.filter((c) => c.handleStatus === 2).length,
        usableCount: sections.filter((s) => s.usable).length,
        failedCount: list.filter((c) => c.handleStatus === -1).length,
        total: list.length,
        // rollupCredits 吃对象（{credits,priced} 或原始计数），不是裸数字——这里把 handleRet.credits 包成条目
        credits: rollupCredits(
            list
                .map((c) => c.handleRet)
                .filter((hr) => hr && typeof hr.credits === 'number')
                .map((hr) => ({ credits: hr.credits, priced: hr.creditsPriced !== false })),
        ),
    }
}

/**
 * @description 阶段一分节陈列正文（markdown）：可用成果成节，失败/空如实标注，不静默删
 * @param {Object} reduced `reduceFanIn` 的产物
 * @param {Object} [opts] {withHeader:Boolean}
 * @returns {String} markdown（无可用内容也返回带失败项的正文，不返回空串假装无事发生）
 */
export function renderSections(reduced, opts = {}) {
    const { withHeader = true } = opts
    const lines = []
    if (withHeader) lines.push('## 子任务过程（分节陈列）')
    for (const s of (reduced.sections || [])) {
        if (s.usable) {
            lines.push(`### ${s.title}`)
            lines.push(String(s.content).trim())
        } else {
            // 不可用也占一节并说明，避免"少了两块"被读成"本来只有两块"
            lines.push(`### ${s.title}（未完成：${s.note || '空'}）`)
        }
        lines.push('')
    }
    return lines.join('\n').trim()
}

/**
 * @description 把子结果转成 `arbitrationPolicy.arbitrate` 需要的输入形状（fan-in → 裁决的接缝）
 * @param {Object[]} children 同 reduceFanIn 入参
 * @returns {Object[]} subtasks 形如 `[{agentCode, handleStatus, retryable}]`
 */
export function toArbitrationInput(children = []) {
    const list = (Array.isArray(children) ? children : []).filter(Boolean)
    return list.map((c) => {
        const hr = c.handleRet || {}
        return {
            agentCode: c.agentCode,
            handleStatus: c.handleStatus,
            // childTurn 已在 handleRet.retryable 标了可重试（aborted 等）；缺省按 handleStatus 推
            retryable: hr.retryable === true || (c.handleStatus === -1 && hr.retryable !== false),
        }
    })
}

export default { reduceFanIn, renderSections, toArbitrationInput }
