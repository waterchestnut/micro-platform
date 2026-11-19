/**
 * @fileOverview serialized-turn 排队轮的"到点取一条"处理（PR-任务编排 M1-b 设计 A，纯逻辑+deps 注入）
 * @module services/agent/serializedTurnCandidate
 * @description
 * pump 每轮拿到若干 `handleStatus:0 && agentRole:'serialized-turn'` 的行，逐条交给本模块决定"现在能不能派发、怎么派发"。
 * 形状刻意照搬 `recoverCandidate.js`：**只 import 纯判定函数，副作用全靠 deps 注入**——这样派发分支能被测试
 * 真跑（recoverCandidate 文件头那条血泪教训：写在会连库的文件里的分支，测试只能读文本"验证"，等于没验证）。
 *
 * 为什么不能像 recover 那样直接 execAgentTask 了事（三条读码事实，见 handoff §3.0）：
 * 1. **会话必须空闲**：`findOpenRun` 判该会话是否还有未终态 run，有则**这条继续等**（不丢、不发拒绝）——
 *    这正是 serialized-turn 的意义：同会话一次只跑一轮，否则新轮读不到上一轮完整前文。
 * 2. **认领被占必须外层跳过**：`execAgentTask` 即便取不到认领也照样执行（index.js 的 fail-open），
 *    所以"防止同一条被并发派发"不能指望它，必须像 recover 一样在派发**前**取认领、拿不到就 skip。
 * 3. **派发=直连执行、认领交接**：本器走 `direct`（`deps.exec(task,{claim})`，把锁交给执行侧 finally 释放），
 *    不投 Kafka（consumer 无会话串行，投了等于绕开第 1 条）。
 *
 * ⚠️ 已知窄窗（默认关、单 pump 进程、间隔短，留待与 execChat 提前登记一起收敛）：
 * 从"pump 判会话空闲"到"execChat 落 processing 行"之间若有**新实时请求**到达同会话，runOverlap 此刻也判空闲，
 * 理论上可能并发。缓解：派发后本条的认领 + 随后落下的 processing 行会立刻让后续实时请求被 runOverlap 拒。
 * 这是 M1-b v1 的诚实边界，不假装已消除。
 */
import { decideTurnStart } from '../core/session/turnScheduler.js'
import { claimDecision } from './execClaim.js'

/** 派发一条排队轮所需的副作用（列在此即接口清单，缺项报错也照这份报） */
export const REQUIRED_DEPS = ['findOpenRun', 'acquireClaim', 'releaseClaim', 'exec', 'log']

function checkDeps(deps) {
    if (!deps || typeof deps !== 'object') {
        throw new Error('turn-candidate-missing-deps')
    }
    for (const k of REQUIRED_DEPS) {
        const ok = (k === 'log') ? (deps[k] && typeof deps[k].info === 'function') : typeof deps[k] === 'function'
        if (!ok) throw new Error(`turn-candidate-missing-dep:${k}`)
    }
    return deps
}

const toMs = (v) => (v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : (v ? Date.parse(v) : NaN)))

/**
 * @description 一轮里每个会话只取"最旧的那一条"排队轮派发（保序；同会话多条不在同一 tick 一起放）
 * @param {Array<Object>} rows 已按 insertTime 升序取回的等待行
 * @returns {Array<Object>} 每 conversationCode 至多一条（首个=最旧）
 */
export function pickOldestPerConversation(rows = []) {
    const seen = new Set()
    const out = []
    for (const r of rows) {
        const conv = r?.conversationCode || r?.params?.conversationCode
        if (!conv) continue
        if (seen.has(conv)) continue
        seen.add(conv)
        out.push(r)
    }
    return out
}

/**
 * @description 处理一条 serialized-turn 排队候选：会话空闲判定 → 取认领 → 直连派发
 * @param {Object} p
 * @param {Object} p.task 排队轮行（含 conversationCode / params.messageCode）
 * @param {Number} [p.staleMs] 僵尸 open run 阈值（超此未终态视作会话已空、可放行）
 * @param {Number} [p.leaseMs] 认领租约长度
 * @param {Number} [p.now] 当前毫秒（注入以便测）
 * @param {Object} p.deps 注入副作用（见 REQUIRED_DEPS）
 * @returns {Promise<Object>} `{outcome, reason?, state?}`，outcome ∈ `skip`/`waiting-conversation`/`blocked`/`dispatched`
 * @throws {Error} 真异常照常上抛，但抛前一定释放已持有、未交出的认领
 */
export async function pumpOneTurnCandidate({ task, staleMs = 0, leaseMs, now = Date.now(), deps } = {}) {
    checkDeps(deps)
    const agentCode = task?.agentCode
    if (!agentCode) throw new Error('turn-candidate-no-agent-code')
    const conversationCode = task.conversationCode || task.params?.conversationCode
    if (!conversationCode) {
        return { outcome: 'skip', reason: 'no-conversation' }
    }

    // 1) 会话必须空闲（排除本轮自身那条尚未存在的 messageCode，防御性）
    let open = null
    try {
        open = await deps.findOpenRun({ conversationCode, excludeMessageCode: task.params?.messageCode || '' })
    } catch (e) {
        // 读账本失败：保守——不派发（等下一轮），绝不因"读不懂"就贸然跑造成并发
        deps.log.warn(`serialized-turn 读会话状态失败（本轮跳过）: ${conversationCode} ${String(e?.message || e).slice(0, 160)}`)
        return { outcome: 'skip', reason: 'open-run-read-failed' }
    }
    const openAgeMs = open ? (now - toMs(open.insertTime)) : 0
    const d = decideTurnStart({ hasOpenRunOnConversation: !!open, openRunAgeMs: Number.isFinite(openAgeMs) ? openAgeMs : 0, staleMs })
    if (!d.start) {
        // 上一轮还在跑：这条继续等（不丢、不发拒绝码——排队与丢单是两件事）
        return { outcome: 'waiting-conversation', reason: d.reason, contextMissing: d.contextMissing }
    }

    // 2) 取认领：拿不到说明已有人在跑这条，外层就跳过（不能指望 execAgentTask 去重）
    let claim = null
    try {
        claim = await deps.acquireClaim({ agentCode, leaseMs })
        const decision = claimDecision({ role: 'recover', state: claim.state })
        if (!decision.proceed) {
            deps.log.info(`serialized-turn 派发跳过: ${agentCode} ${decision.reason} state=${claim.state}（有人在跑或锁层不可用，都不该由 pump 接手）`)
            return { outcome: 'blocked', reason: decision.reason, state: claim.state }
        }
        // 3) 直连派发，认领交接给执行侧（execAgentTask 的 finally 释放）
        deps.exec(task, { claim })
            .then((ret) => deps.log.info(`serialized-turn 执行完成: ${agentCode} conv=${conversationCode} status=${ret?.handleStatus}`))
            .catch((e) => deps.log.error(`serialized-turn 执行异常: ${agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`))
        claim = null
        return { outcome: 'dispatched', contextMissing: d.contextMissing }
    } catch (e) {
        if (claim?.lock) {
            await deps.releaseClaim({ lock: claim.lock, logger: deps.log }).catch(() => {})
        }
        throw e
    }
}

export default { pumpOneTurnCandidate, pickOldestPerConversation, REQUIRED_DEPS }
