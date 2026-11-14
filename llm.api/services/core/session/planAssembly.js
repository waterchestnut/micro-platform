/**
 * @fileOverview PR-M 接线的可抽离装配件（纯函数，零依赖，不碰 execChat）
 * @module services/core/session/planAssembly
 * @description
 * §10.1 接线裁定 ①②③ 里，凡是能离开主循环单测的部分都在这里先做完，让 `llmChat.js` 最终只加"一行调用"。
 * 本档 §2.10 的教训就是"一次在 700 行主路径里铺太多行、测不动"——所以这里把最容易写错的两件事
 * 抽成纯函数并穷举测：
 * - **持久化形状**（① 落 `extInfo.plan`）；
 * - **recitation 只拼在发送副本尾部、绝不进累积历史**（② ——把 recitation `push` 进 `messages` 会让第 N 轮
 *   背着前 N−1 轮的所有副本、越滚越长，还会把我们注入的提示当成对话内容落档）。
 *
 * 这些函数**都不改变线上行为**：接线前没人调用；接线后也全部受 `plan_enabled` 关着 ⇒ 原样返回。
 * 与 `planState`/`planTool` 一样，这里不 import llm 全局、不碰 DB/沙箱。
 */

import {normalizePlan, hasOpenItems, renderRecitation} from './planState.js'

/** 落档用的计划版本标记：以后结构要演进（比如加 progress.md 引用）靠它判别，别拿字段缺失当版本 */
export const PLAN_DOC_VERSION = 1

/**
 * @description 把当前计划整备成落 `extInfo.plan` 的形状（① 持久化）
 * @param {Object|null} plan normalizePlan 之后的计划
 * @param {Object} [opts]
 * @param {String} [opts.updatedBy] 触发这次计划状态的 tool_call id（可选，供追溯"这一版是谁写的"）
 * @returns {Object|null} 无有效计划时返回 null（调用方据此决定写不写这个键，**别写空壳冒充有计划**）
 *
 * 与 `cacheIntent` 同一取向：缺省与"明确没有"要能区分。这里返回 null 表示"本轮没有可落档的计划"，
 * 调用方应**不写 `extInfo.plan` 键**，而不是写 `{items:[]}`——否则下一轮回读会以为"用户清空了计划"，
 * 而真实情况是"这一轮模型压根没调用 update_plan"。
 */
export function planForPersistence(plan, {updatedBy = ''} = {}) {
    const items = Array.isArray(plan?.items) ? plan.items : []
    if (items.length === 0) {
        return null
    }
    return {
        v: PLAN_DOC_VERSION,
        items,
        openRemaining: hasOpenItems({items}),
        ...(updatedBy ? {updatedBy} : {}),
    }
}

/**
 * @description 从上一轮档案的 extInfo 里取出计划，作为本轮 recitation 的初值（① 跨轮种子）
 * @param {Object|null} priorExtInfo 上一轮消息的 extInfo
 * @returns {Object|null} 归一后的计划，或 null
 *
 * 只读"上一轮结束时"的计划即可（D25 的每步重写是轮内行为，跨轮不需要事件流）。
 * 老档案没有这个键 ⇒ null，不报错也不猜成空计划。
 * 这里再跑一遍 `normalizePlan` 是刻意的：**档案是历史某版代码写的，不能假设它现在就合法**
 * （字段演进/脏数据都要在装配前收敛成可信形状）。
 */
export function seedPlanFromPrior(priorExtInfo) {
    const raw = priorExtInfo && typeof priorExtInfo === 'object' ? priorExtInfo.plan : null
    if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) {
        return null
    }
    const norm = normalizePlan(raw)
    return norm.items.length ? norm : null
}

/**
 * @description 构造"计划重述"的瞬态消息内容（② recitation 文本）
 * @param {Object|null} plan 当前计划
 * @param {Object} [opts]
 * @param {Number} [opts.maxChars] recitation 字符预算
 * @param {String} [opts.prefix] 固定前缀，让模型分清"这是系统重述的计划、不是用户新说的话"
 * @returns {String|null} 无计划时 null（不注入）
 */
export function buildRecitationContent(plan, {maxChars = 1200, prefix = '[计划状态·系统重述，非用户输入]'} = {}) {
    const items = Array.isArray(plan?.items) ? plan.items : []
    if (items.length === 0) {
        return null
    }
    const {text} = renderRecitation({items}, {maxChars})
    return `${prefix}\n${text}`
}

/**
 * @description 生成"这一轮发给模型"的消息数组 = 历史 + 尾部一条瞬态 recitation（② 核心）
 * @param {Object[]} messages 累积的真实历史（**不被修改**）
 * @param {Object|null} plan 当前计划
 * @param {Object} [opts]
 * @param {Boolean} [opts.enabled] `plan_enabled`；关 ⇒ 原样返回 messages
 * @param {String} [opts.role='system'] 注入消息的角色（见下方说明）
 * @param {Number} [opts.maxChars] recitation 预算
 * @returns {Object[]} 需要注入时返回**新数组**，否则返回原 messages 引用
 *
 * 两条硬约束（这是本函数存在的全部理由）：
 * 1. **绝不修改传入的 messages**：只读、需要注入时返回 `[...messages, note]`。
 *    一旦 push 进 messages，recitation 就进了真实历史与档案，且逐轮累积——正是要避免的失效；
 * 2. **关掉 / 没计划 ⇒ 原样返回**，让"默认关"在装配这一步也是可证的（返回同一个引用）。
 *
 * ⚠️ role 默认 'system' 但**这条能力上线前必须先在 relay 上验一次**：很多上游只认第一条 system，
 *    中途的 system 可能被忽略或报错；若实测不支持，应改 role='user' 且带 `prefix` 让模型分清来源。
 *    这里把 role 做成入参，就是为了"验完只换参数、不动主循环"。**没有现网读数前，不得声称 recitation 真的改变了模型行为。**
 */
export function withRecitation(messages = [], plan = null, {enabled = false, role = 'system', maxChars = 1200} = {}) {
    if (!enabled) {
        return messages
    }
    const content = buildRecitationContent(plan, {maxChars})
    if (content === null) {
        return messages
    }
    return [...messages, {role, content}]
}

export default {
    PLAN_DOC_VERSION, planForPersistence, seedPlanFromPrior, buildRecitationContent, withRecitation,
}
