/**
 * @fileOverview synth-timer 等待行的"到点派一条"（§7-2，纯逻辑+deps 注入）
 * @module services/agent/synthTimerCandidate
 * @description
 * 形状照 `serializedTurnCandidate.js`（recoverCandidate 的同款教训：会派活的分支必须被测试真跑）。
 * 与 serialized 的差别只有一处判据：**到期**（params.dueAt<=now）代替"会话空闲"——
 * 等待行本来就是"什么时候准点做什么"的闹钟，不该再等会话（等会话的活它派下去的 finalize
 * 重算里做：活性判据在 fanOutFinalizeTask 的宽限分支，判的还是那张表）。
 * 认领纪律逐字继承：**先取认领再派发**（execAgentTask 对认领 fail-open，去重不能指望它），
 * 派发交接、异常路径恰好释放自己那把。
 */
import { claimDecision } from './execClaim.js'
import { isSynthTimerDue } from '../core/session/synthScheduling.js'

export const REQUIRED_DEPS = ['acquireClaim', 'releaseClaim', 'exec', 'log']

function checkDeps(deps) {
    if (!deps || typeof deps !== 'object') throw new Error('synth-timer-missing-deps')
    for (const k of REQUIRED_DEPS) {
        const ok = (k === 'log') ? (deps[k] && typeof deps[k].info === 'function') : typeof deps[k] === 'function'
        if (!ok) throw new Error(`synth-timer-missing-dep:${k}`)
    }
    return deps
}

/**
 * @description 派发一条到期的综合等待行
 * @param {Object} p
 * @param {Object} p.task 等待行（agentRole synth-timer，params.dueAt/rootCode）
 * @param {Number} [p.leaseMs] 认领租约
 * @param {Number} [p.now] 当前毫秒
 * @param {Object} p.deps {acquireClaim, releaseClaim, exec, log}
 * @returns {Promise<Object>} {outcome: 'skip'|'not-due'|'blocked'|'dispatched', reason?}
 * @throws 真异常上抛，抛前释放未交接的认领
 */
export async function pumpOneSynthTimer({task, leaseMs, now = Date.now(), deps} = {}) {
    checkDeps(deps)
    const agentCode = task?.agentCode
    if (!agentCode) throw new Error('synth-timer-no-agent-code')
    if (!task.params?.rootCode) {
        // 坏行（没挂 root 的闹钟）派下去只会让 finalize 猜——直接不派，账留给 recover 的如实处置
        deps.log.warn(`synth-timer 行缺 params.rootCode，跳过: ${agentCode}`)
        return {outcome: 'skip', reason: 'no-root-code'}
    }
    if (!isSynthTimerDue({dueAt: task.params?.dueAt, now})) {
        return {outcome: 'not-due', reason: 'window-open'}
    }
    let claim = null
    try {
        claim = await deps.acquireClaim({agentCode, leaseMs})
        const decision = claimDecision({role: 'recover', state: claim.state})
        if (!decision.proceed) {
            deps.log.info(`synth-timer 派发跳过: ${agentCode} ${decision.reason} state=${claim.state}`)
            return {outcome: 'blocked', reason: decision.reason, state: claim.state}
        }
        // 交接给执行侧（execAgentTask finally 释放）；这条行本身跑完就是终态（finalize 重算落 2/-1）
        deps.exec(task, {claim})
            .then((ret) => deps.log.info(`synth-timer 执行完成: ${agentCode} root=${task.params.rootCode} status=${ret?.handleStatus}`))
            .catch((e) => deps.log.error(`synth-timer 执行异常: ${agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`))
        claim = null
        return {outcome: 'dispatched'}
    } catch (e) {
        if (claim?.lock) {
            await deps.releaseClaim({lock: claim.lock, logger: deps.log}).catch(() => {})
        }
        throw e
    }
}

export default {pumpOneSynthTimer, REQUIRED_DEPS}
