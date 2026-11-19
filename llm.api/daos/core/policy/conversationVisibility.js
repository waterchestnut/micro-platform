/**
 * @fileOverview 会话可见性判据（编排/agent 任务的工作会话不进用户列表）
 * @module daos/core/policy/conversationVisibility
 * @description
 * 背景（2026-11-19 开闸测验实锤）：编排每轮扇出会创建 `root:<rootCode>`（综合落档）与
 * `agent:<childCode>`（每子任务档案）的隔离会话；它们按成员制 userCodes=[用户] 建档——
 * 于是**用户会话列表被 1+N 条工作会话淹没**（旧 agentTask 系统一直如此，只是量小；编排放大后
 * 变成产品问题）。
 *
 * 方案取舍（为什么不选看起来更省事的那两个）：
 * - **不在列表查询里 $regex 前缀**：前缀是实现细节，读取侧拿它当查询条件 = 在读取侧重建
 *   写入时的巧合（§5-4 关联列同款教训——那时反解 conv 前缀被关联列取代）。
 * - **不靠前端各自过滤**：四端各写一遍，漏一个端就污染一个（散点契约）。
 * - ✅ **写侧把细节固化成语义**：建档点（llmChat 唯一入口）用本件判一次，落 `internal:true`；
 *   列表查询只认 `{internal:{$ne:true}}`；存量由一次性脚本回填同一语义。
 *   前缀知识**只活在写入侧**（创建者知道自己在建什么），读取侧永远只看字段。
 * - 权限面**不受影响**：成员校验（message.js 的 allowedCodes）走的是另一条查询
 *   （conversationDac.getConversationCodes，无 internal 过滤）——byCode 读综合正文照常命中，
 *   这条分离是本方案安全性的地基（有守卫用例钉住，不许后来者"顺手合并两条查询"）。
 */

/** 工作会话前缀表（root:=编排综合隔离会话，agent:=任务档案会话）——新增隔离形态只改这一行 */
export const INTERNAL_CONVERSATION_PREFIXES = ['root:', 'agent:']

/**
 * @description 这个 conversationCode 是不是内部工作会话（建档点与回填脚本共用）
 * @param {any} conversationCode
 * @returns {Boolean} 非字符串/空串 ⇒ false（"不知道"不是"内部"——保守不误标用户主会话）
 */
export function isInternalConversationCode(conversationCode) {
    if (typeof conversationCode !== 'string' || !conversationCode) return false
    return INTERNAL_CONVERSATION_PREFIXES.some((p) => conversationCode.startsWith(p))
}

/** 列表查询的排除条件（唯一合法出口；路由 spread 之后硬置，调用方覆盖不了） */
export const LIST_EXCLUDE_INTERNAL = Object.freeze({internal: {$ne: true}})

export default {INTERNAL_CONVERSATION_PREFIXES, isInternalConversationCode, LIST_EXCLUDE_INTERNAL}
