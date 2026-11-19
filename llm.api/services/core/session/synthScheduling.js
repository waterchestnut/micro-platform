/**
 * @fileOverview 综合宽限窗判据（§7-2，纯函数）
 * @module services/core/session/synthScheduling
 * @description
 * 现状"树完成即综合"改成**可配置宽限窗**（属主 2026-11-19 拍板 (c) 起步形）：
 * 树完成不再直接综合，排一条 `synth-timer` 等待行（params.dueAt），pump 到点执行
 * fanOutFinalizeTask 重算；重算时问这张表——**用户在原会话还有动作（窗口内发过新消息）
 * 就把倒计时重设**（"真·会话结束"=静默满窗），推迟有上限（`maxPostpone`，防用户一直聊、
 * 成品永远不来；到顶按事实综合，reason 如实）。
 *
 * 三条形状纪律：
 * 1. `graceMs<=0 ⇒ synthesize(grace-off)`——默认零新行为，逐字现状（本刀地基）；
 * 2. 等待行**不挂 root 子树**（无 parentCode/agentCodePath）——detail 的 subtasks 不混进
 *    "假子任务"；取消级联够不到它也没关系：finalize 重算有 cancelled 截胡兜底；
 * 3. 活性只认 **root 原会话里非空 query 的行**（发起轮的 query 早于树完成，天然排除；
 *    综合落 `root:<rootCode>` 隔离会话不串进来）。
 */

export const SYNTH_TIMER_ROLE = 'synth-timer'

/**
 * 到期时刻与综合时机判据（finalize 的 synthesize 前置，grace 开启时）。
 * @param {Object} p
 * @param {Number} p.graceMs 静默窗口（<=0 ⇒ 逐字现状直接综合）
 * @param {Number} p.now 当前毫秒（注入可测）
 * @param {Number} p.treeDoneAt 树完成时刻（毫秒；首跳=finalize 首算时刻，随等待行传下去）
 * @param {Number|null} p.lastUserMsgAt root 原会话树完成后的最新用户消息时刻（无 ⇒ null）
 * @param {Number} p.round 已推迟轮次（首算 0）
 * @param {Number} p.maxPostpone 推迟上限
 * @returns {{act: 'synthesize'|'schedule', reason: String, dueAt?: Number}}
 */
export function decideSynthTiming({graceMs = 0, now = Date.now(), treeDoneAt = 0, lastUserMsgAt = null, round = 0, maxPostpone = 3} = {}) {
    if (!(Number(graceMs) > 0)) return {act: 'synthesize', reason: 'grace-off'}
    const sinceDone = now - Number(treeDoneAt)
    if (sinceDone < Number(graceMs)) return {act: 'schedule', reason: 'window-open', dueAt: Number(treeDoneAt) + Number(graceMs)}
    // 窗口内有用户新动作：**从该动作起重新计时**（"真·会话结束"=静默满窗）。
    // 收敛口（e2e 实锤的语义洞）：若"新动作+窗"已经过去（动作早已静默够久），
    // 排一个过去的 dueAt 等于空转——那一刻起就该按"静默满窗"综合，不是再挂一张死表。
    if (lastUserMsgAt && Number(lastUserMsgAt) > Number(treeDoneAt)) {
        const nextDue = Number(lastUserMsgAt) + Number(graceMs)
        if (nextDue <= now) return {act: 'synthesize', reason: 'quiet-since-last'}
        if (Number(round) >= Number(maxPostpone)) return {act: 'synthesize', reason: 'postpone-exhausted'}
        return {act: 'schedule', reason: 'user-active', dueAt: nextDue}
    }
    return {act: 'synthesize', reason: 'window-quiet'}
}

/**
 * 等待行形状（单源；pump/finalizeTask 都从这里拿，字段两处各写必分叉——D66 同型病）。
 * 刻意**不带 parentCode**：不属于 root 子树（detail 不混显），归属靠 params.rootCode。
 * @param {Object} p
 * @param {String} p.rootCode 编排 root
 * @param {Number} p.dueAt 到期毫秒
 * @param {Number} p.treeDoneAt 树完成时刻（随行走，重算判窗口的锚）
 * @param {Number} p.round 这是第几轮等待（1 起）
 * @param {Object} p.finParams finalize 重算要的参数面（originalQuery/channel/protocol）
 * @param {Object} p.operator 发起人快照（归属与执行身份）
 * @param {String} p.conversationCode root 原会话（活性查询面随行走，恢复场景不靠猜）
 * @returns {Object} agentTask 形状（handleMode manual：不投 Kafka，等 pump）
 */
export function buildSynthTimerTaskSpec({rootCode = '', dueAt = 0, treeDoneAt = 0, round = 1, finParams = {}, operator = null, conversationCode = ''} = {}) {
    if (!rootCode) throw new Error('buildSynthTimerTaskSpec 需要 rootCode')
    return {
        agentRole: SYNTH_TIMER_ROLE,
        handleMode: 'manual',
        handleStatus: 0,
        errorMode: 'continue',
        title: `综合等待#${round} root=${String(rootCode).slice(0, 8)}`,
        conversationCode,
        operator,
        handler: 'fanOutFinalizeTask',
        params: {
            rootCode,
            synthTimer: true,
            synthRound: round,
            treeDoneAt,
            dueAt,
            originalQuery: finParams.originalQuery || '',
            channel: finParams.channel,
            protocol: finParams.protocol,
        },
    }
}

/**
 * pump 取数判据：这条等待行到没到期（纯比较，读数归调用方）。
 * @param {Object} p
 * @param {Number} p.dueAt params.dueAt
 * @param {Number} p.now 当前毫秒
 * @returns {Boolean} 到点可派
 */
export function isSynthTimerDue({dueAt = 0, now = Date.now()} = {}) {
    return Number(dueAt) > 0 && Number(dueAt) <= now
}

export default {SYNTH_TIMER_ROLE, decideSynthTiming, buildSynthTimerTaskSpec, isSynthTimerDue}
