/**
 * @fileOverview 综合宽限窗到期排水器（§7-2）
 * @module tasks/synthTimerPump
 * @description
 * 短周期（复用 cron.pumpPattern 的 5s 节奏）扫 `agentRole:'synth-timer' && handleStatus:0`，
 * 到点（params.dueAt<=now）的行逐条交 `pumpOneSynthTimer`（认领→直连派发 fanOutFinalizeTask
 * 重算）。判据与派发纪律在那一侧，这里只做取数与计数——同 `serializedTurnPump` 的分工。
 * 注册条件：`agentTask.fanOutOrchestration.synthGraceMs > 0`（0=现状即时综合，本泵不注册，
 * 一个字节都不多走）。锁 `lock:synthTimerPump` 防多副本同 tick 双扫。
 */
import agentTaskDac from '../daos/core/dac/agentTaskDac.js'
import { acquireOnce } from '../daos/cache/l2Cache.js'
import { acquireClaim, releaseClaim, DEFAULT_LEASE_MS } from '../services/agent/execClaim.js'
import { execAgentTask } from '../services/agent/index.js'
import { pumpOneSynthTimer } from '../services/agent/synthTimerCandidate.js'
import { SYNTH_TIMER_ROLE } from '../services/core/session/synthScheduling.js'

const config = llm.config
const logger = llm.logger

/**
 * @description 排一轮到期综合闹钟
 * @param {Object} [params] {batch, force}
 * @returns {Promise<Object>} {dispatched, notDue, blocked, skip}
 */
export async function runSynthTimerPump(params = {}) {
    const lockTtl = Math.max(1, Number(config.cron?.pumpLockTtlSeconds) || 4)
    if (!params.force) {
        const owned = await acquireOnce('lock:synthTimerPump', lockTtl)
        if (!owned) return { dispatched: 0, notDue: 0, blocked: 0, skip: 0, locked: true }
    }
    const batch = Number(params.batch ?? config.cron?.pumpBatch) || 20
    const leaseMs = Number(config.agentTask?.execLeaseMs) || DEFAULT_LEASE_MS

    const rows = await agentTaskDac.getTop(batch, {
        complexFilter: { agentRole: SYNTH_TIMER_ROLE, handleStatus: 0 },
    }, { 'params.dueAt': 1, insertTime: 1 })

    const deps = { acquireClaim, releaseClaim, exec: execAgentTask, log: logger }
    let dispatched = 0, notDue = 0, blocked = 0, skip = 0
    for (const task of rows || []) {
        try {
            const r = await pumpOneSynthTimer({ task, leaseMs, now: Date.now(), deps })
            if (r.outcome === 'dispatched') dispatched++
            else if (r.outcome === 'not-due') notDue++
            else if (r.outcome === 'blocked') blocked++
            else skip++
        } catch (e) {
            skip++
            logger.error(`synth-timer pump 单条失败: ${task?.agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`)
        }
    }
    if (dispatched || blocked || skip) {
        logger.info(`synth-timer pump: 扫到=${rows?.length || 0}, 派发=${dispatched}, 未到期=${notDue}, 占用=${blocked}, 跳过=${skip}`)
    }
    return { dispatched, notDue, blocked, skip }
}

export default { runSynthTimerPump }
