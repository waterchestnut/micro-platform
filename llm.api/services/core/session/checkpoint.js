/**
 * @fileOverview 会话执行检查点
 * @module services/core/session/checkpoint
 * @description 工具循环可能迭代多次，`message` 只归档最终问答，中断后无从还原到某一次模型请求的现场。
 * 这里在每次 `create()` 前后各落一条检查点，把"发出去的字节"固化下来，使续跑与提示词前缀核对成为可能。
 *
 * 三条硬约束：
 * 1. **绝不打断聊天关键路径**：写失败只记日志，异常一律吞掉；调用方拿到的是 promise 句柄而非 await。
 * 2. **续跑复用快照而非重新计算**：召回文本与 owner 文档版本在首帧冻结，
 *    否则续跑时记忆已更新会让 system/user 前缀字节变化，缓存与重放都对不上。
 * 3. **检查点会膨胀**：每条都带完整 messages。用 `seq` 折叠旧段 + TTL 回收，`message` 归档永不删。
 */

import {md5} from '../../../tools/security.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)
const cfg = () => (typeof llm !== 'undefined' ? (llm.config?.checkpoint || {}) : {})

/** 会话内序号计数器，避免每条检查点都回库查 maxSeq */
const seqCounters = new Map()

/** 未落地的写入，收尾时统一 flush */
const pending = new Set()

export const CHECKPOINT_PHASES = ['preCreate', 'postCreate', 'postTools', 'final', 'abort']

/**
 * @description 规范化消息序列并取摘要。
 * 只取影响请求字节的字段（role/content/tool_calls/tool_call_id/name），
 * 否则前端塞进 messages 的展示字段会让哈希漂移。
 * @author xianyang
 * @param {Object[]} messages 消息序列
 * @returns {String} 摘要
 */
export function hashMessages(messages) {
    const canon = (messages || []).map(m => ({
        role: m?.role || '',
        content: typeof m?.content === 'string' ? m.content : (m?.content === null ? null : m?.content ?? null),
        tool_calls: m?.tool_calls || undefined,
        tool_call_id: m?.tool_call_id || undefined,
        name: m?.name || undefined,
    }))
    return md5(JSON.stringify(canon))
}

/**
 * @description 取下一个会话内序号（进程内单调）
 * @author xianyang
 * @param {String} conversationCode 会话标识
 * @returns {Number} 序号
 */
export function nextSeq(conversationCode) {
    const key = conversationCode || '-'
    const n = (seqCounters.get(key) || 0) + 1
    seqCounters.set(key, n)
    return n
}

/**
 * @description 是否还能续跑：只有带完整 messages 的现场才有意义
 * @author xianyang
 * @param {Object[]} checkpoints seq 倒序的检查点列表
 * @returns {Object|null} 可续跑的最后一条
 */
export function pickResumable(checkpoints) {
    for (const cp of checkpoints || []) {
        if (Array.isArray(cp?.messages) && cp.messages.length && cp.phase !== 'final') {
            return cp
        }
    }
    return null
}

/**
 * @description 计算折叠水位：超过阈值时，把水位以下的旧段标记软删
 * @author xianyang
 * @param {Number} maxSeq 当前最大序号
 * @param {Object} [opts] 选项
 * @returns {Number|null} 需要折叠到的最大 seq，无需折叠返回 null
 */
export function foldHorizon(maxSeq, opts = {}) {
    const threshold = Number(opts.foldThreshold ?? cfg().foldThreshold ?? 40)
    const keep = Number(opts.keepLast ?? cfg().keepLast ?? 12)
    if (!(maxSeq > threshold)) {
        return null
    }
    const horizon = maxSeq - keep
    return horizon > 0 ? horizon : null
}

/**
 * @description 从检查点还原可直接发给模型的消息序列（续跑入口）
 * @author xianyang
 * @param {Object} checkpoint 检查点
 * @returns {Object|null} {messages, tools, toolChoice, model, iteration, hash, stable}
 */
export function buildResumeContext(checkpoint) {
    if (!Array.isArray(checkpoint?.messages) || !checkpoint.messages.length) {
        return null
    }
    /** 续跑必须复用首帧冻结的注入文本，不能再算一遍召回 */
    const messages = checkpoint.messages.map(m => ({...m}))
    const meta = checkpoint.requestMeta || {}
    return {
        messages,
        tools: meta.tools || null,
        toolChoice: meta.toolChoice ?? null,
        model: meta.model || null,
        iteration: checkpoint.iteration || 0,
        hash: checkpoint.messagesHash || hashMessages(messages),
        stable: (checkpoint.messagesHash || '') === hashMessages(messages),
        recallFrozen: checkpoint.recallSnapshot || '',
        /** PR-16 ②：续跑找回工作环境靠它（快照仓库按 <sandboxId>-sandbox 命名）；
         *  空串只说明"这轮没有沙箱"，不说明失败 —— 聊天路径与沙箱路径是正交的 */
        sandboxId: checkpoint.sandboxId || '',
    }
}

/**
 * @description 落一条检查点（内部用，异常向上抛给 scheduleCheckpoint）
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Promise<Object|null>} 写入结果
 */
export async function writeCheckpoint(params = {}) {
    const {conversationCode} = params
    if (!conversationCode) {
        return null
    }
    const dac = (await import('../../../daos/core/dac/sessionCheckpointDac.js')).default
    const messages = Array.isArray(params.messages) ? params.messages : []
    const doc = {
        conversationCode,
        messageCode: params.messageCode || null,
        userCode: params.userCode || null,
        channel: params.channel || null,
        seq: params.seq || nextSeq(conversationCode),
        iteration: params.iteration || 0,
        phase: params.phase,
        messagesHash: hashMessages(messages),
        messages,
        toolState: params.toolState || {pendingCalls: [], completedCalls: []},
        requestMeta: params.requestMeta || null,
        recallSnapshot: params.recallSnapshot ?? null,
        recallAtomCodes: params.recallAtomCodes || [],
        profileDocVersion: params.profileDocVersion ?? null,
        usage: params.usage || null,
        answer: params.answer || '',
        sandboxId: params.sandboxId || '',
        operator: params.operator || null,
        status: 0,
    }
    const ret = await dac.add(doc)
    const horizon = foldHorizon(doc.seq)
    if (horizon) {
        await fold(dac, conversationCode, horizon)
    }
    return ret
}

/**
 * @description 折叠旧段：软删水位以下的检查点，message 归档不动
 * @author xianyang
 * @param {Object} dac 数据访问
 * @param {String} conversationCode 会话标识
 * @param {Number} horizon 水位
 * @returns {Promise<Number>} 影响条数
 */
async function fold(dac, conversationCode, horizon) {
    try {
        const ret = await dac.update({status: -1}, {conversationCode, seq: {$lte: horizon}})
        return ret?.modifiedCount ?? 0
    } catch (e) {
        logger().warn(`检查点折叠失败(${conversationCode}/${horizon}): ${e.message}`)
        return 0
    }
}

/**
 * @description 异步落检查点：不 await、不抛错、进 pending 集合等收尾 flush
 * @author xianyang
 * @param {Object} params 入参，同 writeCheckpoint
 * @returns {Promise|null} 未启用时返回 null
 */
export function scheduleCheckpoint(params = {}) {
    if (!cfg().enabled) {
        return null
    }
    if (!CHECKPOINT_PHASES.includes(params.phase)) {
        logger().warn(`未知检查点阶段: ${params.phase}`)
        return null
    }
    const p = writeCheckpoint(params).catch(e => {
        logger().warn(`检查点写入失败(${params.conversationCode}/${params.phase}): ${e.message}`)
    }).finally(() => {
        pending.delete(p)
    })
    pending.add(p)
    return p
}

/**
 * @description 等未落地的检查点收尾（带超时，绝不无限等）
 * @author xianyang
 * @param {Number} [timeoutMs] 超时
 * @returns {Promise<Number>} 剩余未完成的条数
 */
export async function flushCheckpoints(timeoutMs) {
    const limit = Number(timeoutMs ?? cfg().flushTimeoutMs ?? 1500)
    if (!pending.size) {
        return 0
    }
    await Promise.race([
        Promise.allSettled([...pending]),
        new Promise(resolve => setTimeout(resolve, limit)),
    ])
    return pending.size
}

/**
 * @description 读会话检查点并给出可续跑现场
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.conversationCode 会话标识
 * @param {Number} [params.limit] 取最近多少条
 * @returns {Promise<Object>} {checkpoints, resumable, context}
 */
export async function loadResumable({conversationCode, limit = 50} = {}) {
    if (!conversationCode) {
        return {checkpoints: [], resumable: null, context: null}
    }
    const dac = (await import('../../../daos/core/dac/sessionCheckpointDac.js')).default
    /** 已折叠的旧段不参与续跑 */
    const checkpoints = await dac.getTop(limit, {conversationCode, includeDeleted: false}, {seq: -1})
    const resumable = pickResumable(checkpoints)
    return {checkpoints, resumable, context: resumable ? buildResumeContext(resumable) : null}
}

export default {scheduleCheckpoint, writeCheckpoint, flushCheckpoints, loadResumable, hashMessages, pickResumable, buildResumeContext, foldHorizon, nextSeq, CHECKPOINT_PHASES}
