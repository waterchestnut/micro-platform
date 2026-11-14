/**
 * @fileOverview 下发给模型的 update_plan 工具（PR-M：让模型把计划外置成结构化状态）
 * @module services/core/session/planTool
 * @description
 * §10 / D25 的第一步是"模型维护一份 `plan.json`"——没有这个工具，计划只存在于散文里，
 * 后面的 recitation 与完成性反问都没有可核对的对象。本模块只负责**工具的形与执行**：
 *   - `buildPlanTools()`：给模型的 schema；
 *   - `isPlanTool(name)`：主循环分派用；
 *   - `planToolEnabled(cfg)`：默认关（与 `codeToolEnabled`、E0.6/E0.2 同一取向——治理类能力先可见、后按需开）；
 *   - `executePlanTool()`：把模型传来的计划**归一 + 回一份 recitation**，让它当场看到"系统记成了什么样"。
 *
 * 刻意**不碰 execChat**：接线（在 `if (isCodeTool)` 旁加一个 `if (isPlanTool)` 分支、把计划落到 `extInfo.plan`、
 * 装配尾部注入 recitation、finalizer 反问）留到后续独立刀，每刀各自可测可回滚。
 * 这里全部逻辑都不依赖 DB / 沙箱 / 全局，纯输入输出，能离线穷举测。
 *
 * 执行语义是**整份替换**（模型每次交完整的 items 数组，等价于覆写它自己的 plan.json）：
 * 比增量 patch 少一类"模型算错 diff"的失败，且无状态——归一只看这一次调用，不依赖上一轮存了什么。
 * 出错一律以工具结果 `success:false` 回给模型，绝不抛断聊天循环（同 run_code）。
 */

import {normalizePlan, planItemCounts, renderRecitation, hasOpenItems} from './planState.js'

export const PLAN_TOOL_NAME = 'update_plan'

/**
 * @description 构造 update_plan 工具定义
 * @returns {Object[]} tools 数组片段
 */
export function buildPlanTools() {
    return [{
        type: 'function',
        function: {
            name: PLAN_TOOL_NAME,
            description: [
                '维护本次任务的结构化计划（等价于覆写你自己的 plan.json）。把要做的事拆成有序条目，',
                '随进展更新每条的状态：pending(待办)/in_progress(进行中)/done(完成)/failed(失败)/abandoned(已放弃)。',
                '每次调用请给出**完整**条目清单（不是增量），并保持同一条目的 id 稳定。',
                '结束前应把已完成项标 done、不再需要的标 abandoned/failed，不要留着 pending 就宣布任务完成。',
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        description: '完整计划条目列表（整份替换）',
                        items: {
                            type: 'object',
                            properties: {
                                id: {type: 'string', description: '稳定标识，跨次调用保持不变，用于认同一条'},
                                title: {type: 'string', description: '这条要做什么（简短、可判定完成与否）'},
                                status: {
                                    type: 'string',
                                    enum: ['pending', 'in_progress', 'done', 'failed', 'abandoned'],
                                    description: '当前状态，缺省按 pending 处理',
                                },
                            },
                            required: ['title'],
                        },
                    },
                    note: {type: 'string', description: '可选：一句话说明这次计划为什么这样调整'},
                },
                required: ['items'],
            },
        },
    }]
}

/**
 * @description 是否 update_plan 工具
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isPlanTool(toolName) {
    return toolName === PLAN_TOOL_NAME
}

/**
 * @description 该不该给这次请求下发 update_plan（默认关）
 * @param {Object} [planConfig] `llm.config.planConfig`
 * @returns {Boolean} 是否下发
 */
export function planToolEnabled(planConfig = {}) {
    return planConfig?.enabled === true
}

/**
 * @description 执行一次 update_plan：归一计划、回一份 recitation
 * @param {Object} params 入参
 * @param {Object} params.toolCall 工具调用（OpenAI 形态）
 * @param {Object} [params.planConfig] 用于 recitation 预算
 * @returns {Object} OpenAI tool 消息体（content 内是 success + 归一后的计划视图）
 *
 * 返回里刻意把**归一结果与 warnings 原样吐回模型**：如果它写的 status 非法、id 丢了、
 * 有条目没标题被我丢弃，它得当场看见，而不是以为"系统记住了 8 条"而实际只剩 5 条——
 * 静默修正是这类"计划"功能最阴的失效方式。
 * 同步返回（无 IO），但仍包成 tool 消息体，交给主循环 push。
 */
export function executePlanTool({toolCall, planConfig = {}} = {}) {
    const callId = toolCall?.id
    const wrap = (obj) => ({tool_call_id: callId, role: 'tool', content: JSON.stringify(obj)})
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch {
        return wrap({success: false, error: '参数不是合法 JSON'})
    }
    if (!planToolEnabled(planConfig)) {
        return wrap({success: false, error: '计划工具未开放（plan_enabled）'})
    }
    const norm = normalizePlan(args)
    if (norm.items.length === 0) {
        return wrap({
            success: false,
            error: '没有可用的计划条目（items 需为带 title 的数组）',
            warnings: norm.warnings,
        })
    }
    const counts = planItemCounts(norm)
    const recitation = renderRecitation(norm, {maxChars: Number(planConfig.recitationMaxChars) || 1200})
    return wrap({
        success: true,
        data: {
            items: norm.items,
            counts: {total: counts.total, open: counts.openCount, done: counts.done, failed: counts.failed, abandoned: counts.abandoned},
            openRemaining: hasOpenItems(norm),
            recitation: recitation.text,
            /** 我替模型改了什么，全部原样回吐，别让它以为系统记的和它给的一样 */
            normalized: norm.warnings,
        },
    })
}

export default {PLAN_TOOL_NAME, buildPlanTools, isPlanTool, planToolEnabled, executePlanTool}
