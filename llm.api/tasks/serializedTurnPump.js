/**
 * @fileOverview 会话追问轮排队排水器（PR-任务编排 M1-b 设计 A）
 * @module tasks/serializedTurnPump
 * @description
 * 短周期（默认 5s，见 `cron.pumpPattern`）扫 `agentRole:'serialized-turn' && handleStatus:0` 的行，
 * 每会话取最旧一条，**该会话空闲时**直连派发执行（`turnRunner` 忠实重放用户轮）。
 *
 * 与 `agentTaskRecover` 的分工：recover 救"进程蒸发、永驻 0 的在途流水线"（慢、10 分钟一轮，且必须
 * 有滞留下界防惊群）；pump 排"会话串行的追问"（快、秒级，靠 `findOpenRun` 判会话空闲而不是靠滞留时长）。
 * 两者都用**同一套认领纪律**（`execClaim`）防并发派发同一条——因为 `execAgentTask` 取不到认领也照样跑（fail-open），
 * 去重只能靠"派发前在外层取认领、拿不到就跳过"，这条在 `serializedTurnCandidate.js` 里钉死并被真跑。
 *
 * 只在 `limits.conversationTaskQueue.enabled===true` 时由 `cron/retention.js` 注册；默认关，进程存活但不跑。
 * 单轮 redis 锁 `lock:serializedTurnPump`（TTL 短，一次抛错不至于挡死后续多轮）+ 进程内 executing 标记（在 retention 里）。
 */
import agentTaskDac from '../daos/core/dac/agentTaskDac.js'
import llmUsageDac from '../daos/core/dac/llmUsageDac.js'
import { acquireOnce } from '../daos/cache/l2Cache.js'
import { acquireClaim, releaseClaim, DEFAULT_LEASE_MS } from '../services/agent/execClaim.js'
import { execAgentTask } from '../services/agent/index.js'
import { pumpOneTurnCandidate, pickOldestPerConversation } from '../services/agent/serializedTurnCandidate.js'

const config = llm.config
const logger = llm.logger

/**
 * @description 排一轮会话追问队列
 * @param {Object} [params] 入参（运维手触发可覆盖）
 * @param {Number} [params.batch] 单轮最多取多少条等待行
 * @param {Boolean} [params.force] 跳过 redis 锁
 * @returns {Promise<Object>} `{dispatched, waiting, blocked, skip}` 本轮计数
 */
export async function runSerializedTurnPump(params = {}) {
    const q = config.limits?.conversationTaskQueue || {}
    const lockTtl = Math.max(1, Number(config.cron?.pumpLockTtlSeconds) || 4)
    if (!params.force) {
        const owned = await acquireOnce('lock:serializedTurnPump', lockTtl)
        if (!owned) {
            return { dispatched: 0, waiting: 0, blocked: 0, skip: 0, locked: true }
        }
    }
    const batch = Number(params.batch ?? config.cron?.pumpBatch) || 20
    const staleMs = Number(q.staleMs) || 45000
    const leaseMs = Number(config.agentTask?.execLeaseMs) || DEFAULT_LEASE_MS

    /** 最旧优先：insertTime 升序，保证同会话 FIFO；每会话只放最旧那条由 pick 负责 */
    const rows = await agentTaskDac.getTop(batch, {
        complexFilter: { agentRole: 'serialized-turn', handleStatus: 0 },
    }, { insertTime: 1 })

    const deps = {
        findOpenRun: (arg) => llmUsageDac.findOpenRun(arg),
        acquireClaim,
        releaseClaim,
        exec: execAgentTask,
        log: logger,
    }

    let dispatched = 0, waiting = 0, blocked = 0, skip = 0
    for (const task of pickOldestPerConversation(rows || [])) {
        try {
            const r = await pumpOneTurnCandidate({ task, staleMs, leaseMs, now: Date.now(), deps })
            if (r.outcome === 'dispatched') dispatched++
            else if (r.outcome === 'waiting-conversation') waiting++
            else if (r.outcome === 'blocked') blocked++
            else skip++
        } catch (e) {
            skip++
            logger.error(`serialized-turn pump 单条失败: ${task.agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`)
        }
    }
    if (dispatched || waiting || blocked || rows?.length) {
        /** 有活才打，空轮不刷屏（pump 每 5 秒一次，日志量是 recover 的 120 倍） */
        logger.info(`serialized-turn pump: 扫到=${rows?.length || 0}, 派发=${dispatched}, 等会话=${waiting}, 认领占用=${blocked}, 跳过=${skip}`)
    }
    return { dispatched, waiting, blocked, skip }
}

export default { runSerializedTurnPump }
