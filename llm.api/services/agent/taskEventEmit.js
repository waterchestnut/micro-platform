/**
 * @fileOverview 任务事件发射的接线助手（M1-c 刀 1；热路径零 await 承诺的实现体）
 * @module services/agent/taskEventEmit
 * @description
 * 所有发射点走这一个口：flag 关 ⇒ **连模块都不 import**（懒加载家规）；开 ⇒ 镜像逐条写。
 * **fire-and-forget 是刻意的**（runEventLogStore.onEvent 同款承诺）：child 终局/finalize
 * 这些热路径上，事件写 redis 的往返不许把任务执行拖慢半拍——镜像失败自有 warn 与计数，
 * detail 面（账本事实）永远是兜底。调用方 await 本函数返回的是"已受理发射"，不是"已落账"。
 */

/** llm.logger 可能缺席（单测不跑 init）——取法与 artifact/intakeWiring 同形，console 兜底 */
const logger = (typeof llm !== 'undefined' && llm.logger) || console

/** 配置读取守卫形：离线测试无 llm 全局 ⇒ 视作未配置=关（fail-open 的镜像方向：默认关） */
const taskEventsCfg = () => ((typeof llm !== 'undefined' && llm.config?.agentTask?.taskEvents) || {})

/**
 * 进程级活动计数（runStats.taskEvents 的发射面数据源）。语义与 runRegistry 的
 * admitted/rejected 同族：**本进程自受理发射以来**的账——多进程各说各的（执行链在
 * executor/cron，读面在 http），值班对照"哪个进程在发"时按容器看，聚合归监控。
 * 为什么必须有：flag 开了但账空——分不清是发射点没走到、还是镜像写失败被 warn 吞了；
 * 计数把这三种形态分开（calls=0 是没走到；failed>0 是写在坏）。
 */
const emitStats = {calls: 0, emitted: 0, failed: 0, closed: 0, disabled: 0}
export function taskEventEmitStats() {
    return {...emitStats}
}

/** 词表映射：taskEvents 的 snake_case 型名 ↔ camelCase 构造函数（封闭集，未知型不造） */
const CTOR_BY_TYPE = {
    task_queued: 'taskQueued',
    task_started: 'taskStarted',
    subtask_spawned: 'subtasksSpawned',
    subtask_done: 'subtaskDone',
    subtask_failed: 'subtaskFailed',
    synthesizing: 'synthesizing',
    synthesized: 'synthesized',
    budget_degraded: 'budgetDegraded',
    arbitration: 'arbitrationEvent',
}

/**
 * @description 发射一组任务事件（flag 关⇒no-op；全程不抛）
 * @param {Object} p
 * @param {String} p.rootCode 编排 root
 * @param {Array<{type: String, payload: Object}>} p.events
 * @param {String|null} [p.end] 段界（done/await-input/...）；给了就在事件后收段
 * @returns {Promise<Object>} {emitted, skipped?}（skipped 只用于关/缺参，不是错误通道）
 */
export async function emitTaskEvents({rootCode, events = [], end = null, deps = {}} = {}) {
    if (!rootCode) { emitStats.failed++; return {emitted: 0, skipped: 'no-root'} }
    const cfg = deps.cfg || taskEventsCfg()
    if (cfg.enabled !== true) { emitStats.disabled++; return {emitted: 0, skipped: 'disabled'} }
    emitStats.calls++
    try {
        const [{createTaskEventMirror}, TE] = await Promise.all([
            import('../core/session/taskEventLog.js'),
            import('../core/session/taskEvents.js'),
        ])
        const getClient = deps.getClient || (async () => (await import('../../daos/cache/redisEventClient.js')).getEventClient())
        const mirror = createTaskEventMirror({
            getClient, rootCode,
            cfg: {maxEvents: cfg.maxEvents, ttlSec: cfg.ttlSec, keyPrefix: cfg.keyPrefix},
        })
        let emitted = 0
        for (const {type, payload} of events) {
            const ctorName = CTOR_BY_TYPE[String(type)]
            if (!ctorName || typeof TE[ctorName] !== 'function') {
                logger.warn(`任务事件未知型，不造形状: ${String(type).slice(0, 40)}`)
                emitStats.failed++
                continue
            }
            await mirror.emit(TE[ctorName](payload || {}))
            emitted++
        }
        if (end) await mirror.finish({outcome: end})
        emitStats.emitted += emitted
        if (end) emitStats.closed++
        return {emitted, closed: !!end}
    } catch (e) {
        logger.warn(`任务事件发射异常（不影响任务）: root=${rootCode} ${String(e?.message || e).slice(0, 160)}`)
        emitStats.failed++
        return {emitted: 0, skipped: 'error'}
    }
}

export default {emitTaskEvents, taskEventEmitStats}
