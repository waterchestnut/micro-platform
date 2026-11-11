/**
 * @fileOverview 中断智能体任务恢复
 * @module tasks/agentTaskRecover
 * @description 任务执行器进程（PM2 cluster worker / grpc 容器）重启会蒸发内存里的执行流水线：
 * 任务 handleStatus 永驻 0（执行中本就不落库，0 兼表示"在跑"），kafka 消息又已消费，
 * 任务永不收敛（表现为建课 pptStatus 恒 pending）。
 * 恢复方式由配置 `cron.recoverMode` 决定（判据与两种模式的取舍见 `services/agent/recoverPolicy.js`）：
 * `direct` 直接重执行（源仓默认，依据是 2026-11-09 本集群"consumer 停摆、重投只堆积"的实测），
 * `requeue` 重新投递 kafka 交给消费者（消费者健康时更保守）。
 * **两种模式都不能区分"流水线蒸发"与"消费者只是排得慢"**，因此都可能在后者发生时造成同任务跑两遍；
 * 每任务的执行认领（`services/agent/execClaim.js`）已从 2026-11-11 起**两侧同时接线**：
 * 执行侧持有租约，恢复侧**取不到认领就整条跳过**，于是"排得慢"不再会被当成"可救"。
 *
 * 接线时同一次实测还查出扫描本身的病，而且它比认领更要命——因为它让上面那些保护根本没机会执行：
 * 候选 5211 条、批次上限 10、按 `updateTime` **升序**取前 N，队首是一批永不收敛的派发型行
 * （它们只被 `continue` 掉、从不被更新 ⇒ 永远占着队首），
 * 于是**新滞后的任务永远排不进本轮**（证据：近 7 天 103 条滞留行 `recoverCount` 全为 0，
 * 轮次日志 `触发=0, 跳过=0` ⇒ 恢复功能自上线起一条都没救到过）。两条一起修：
 * ① 派发型改在**取数时**排除（判据收进 `recoverPolicy.buildRecoverFilter`，不再留在循环里）；
 * ② 给滞留时长加**上界**（`cron.recoverWindowMs`，默认 6 小时）——只做①的话，队首会立刻换成
 * 2026-03 那批 `grpc/grpcCall` 陈旧行并被真重跑一遍，那是用修复制造事故。
 * 单轮限量(默认10)fire-and-forget 防惊群，阈值(默认30min)远大于本仓单元护栏上限，
 * 重试上限(默认2次)防循环；持久化按业务码幂等。
 */

import agentTaskDac from '../daos/core/dac/agentTaskDac.js'
import {execAgentTask} from '../services/agent/index.js'
import {acquireOnce} from '../daos/cache/l2Cache.js'
import {sendMessage} from '../daos/kafka/client.js'
import {resolveRecoverMode, recoverAction, resolveRecoverWindow, buildRecoverFilter, DISPATCH_AGENT_TYPES, DEFAULT_RECOVER_STUCK_MS} from '../services/agent/recoverPolicy.js'
import {acquireClaim, releaseClaim, leaseSafety, DEFAULT_LEASE_MS} from '../services/agent/execClaim.js'
import {recoverOneCandidate} from '../services/agent/recoverCandidate.js'

const config = llm.config
const logger = llm.logger

/** 单轮最多恢复任务数（并发上限，防 LLM 惊群） */
const BATCH = Number(config.cron?.recoverBatch || 10)

/**
 * 恢复执行方式（`direct` / `requeue`），判据在 `recoverPolicy.js`。
 * 这里**每次进程启动解析一次**并如实记日志：配置写了却没生效（值拼错）如果静默走默认，
 * 下次排障就会以为自己在跑 requeue 而实际跑的是 direct——本仓有过一次"配置写了不生效"撑了
 * 两周才被档案发现的事故（见 `shutdownPolicy` 文件头那条 `FASTIFY_CLOSE_GRACE_DELAY` 教训）。
 */
const recoverModeCfg = resolveRecoverMode({raw: config.cron?.recoverMode})
if (recoverModeCfg.reason.startsWith('invalid:')) {
    logger.warn(`agentTask 恢复模式配置无效，按 ${recoverModeCfg.mode} 执行: ${recoverModeCfg.reason} `
        + '（可选值 direct|requeue；"写了没生效"必须吵出来，静默默认值是最难查的一类不一致）')
}
/**
 * 启动时把生效的模式打一行：运维要能在不触发恢复轮的情况下确认"这台到底会重执行还是重投"。
 * 没有这行，模式错了只能等到某次任务卡住后才从行为反推——那正是最难归因的时机。
 */
/**
 * 滞留判定阈值（模块级算一次）：`buildRecoverFilter`、`leaseSafety`、启动日志三处都要用，
 * 各写一遍 `|| 1800000` 就是三份可能互相漂移的默认值。
 */
const STUCK_MS = Number(config.cron?.recoverStuckMs) || DEFAULT_RECOVER_STUCK_MS

/**
 * 恢复窗口（"滞留多久以内还值得救"）。判据与 6 小时这个默认值的出处见 `recoverPolicy.js`。
 * 解析放在启动期、和 `recoverMode` 同一待遇：配了没生效必须吵出来，
 * 因为窗口配错的表现是"扫描永远为空"，与"今天很干净"在日志上长得一模一样。
 */
const windowCfg = resolveRecoverWindow({raw: config.cron?.recoverWindowMs, stuckMs: STUCK_MS})
if (windowCfg.reason.startsWith('invalid:') || windowCfg.reason.startsWith('not-longer-than-stuck:')) {
    logger.warn(`agentTask 恢复窗口配置无效，按 ${windowCfg.windowMs}ms 执行: ${windowCfg.reason} `
        + '（窗口必须大于 cron_recoverStuckMs，否则扫描条件是个空区间）')
}

logger.info(`agentTask 恢复模式: ${recoverModeCfg.mode}（${recoverModeCfg.reason}，`
    + `动作=${recoverAction({mode: recoverModeCfg.mode})}，单轮上限=${BATCH}，滞留阈值=${STUCK_MS}ms，`
    + `恢复窗口=${windowCfg.windowMs}ms/${windowCfg.reason}，`
    + `取数时排除派发型=${DISPATCH_AGENT_TYPES.join('/')}）`)

/**
 * 启动时就把"租约 vs 滞留阈值"这对比值判一次（同一条规则在测试里也钉着，见 execClaim.test.js）。
 * 为什么不只靠测试：这两个数分在两个配置块里（`agentTask.execLeaseMs` / `cron.recoverStuckMs`），
 * **运维在部署环境改一个、测试完全看不见**——而改错的后果是恢复轮把正在执行的任务判成可救，
 * 于是重复执行有副作用的任务。开机一行告警是这条不变量在真实环境里唯一的守门人。
 */
const leaseCheck = leaseSafety({
    leaseMs: Number(config.agentTask?.execLeaseMs) || DEFAULT_LEASE_MS,
    stuckMs: STUCK_MS,
})
if (!leaseCheck.ok) {
    logger.warn(`agentTask 恢复配置不安全: ${leaseCheck.reason} `
        + '⇒ 正常执行中的任务可能被恢复轮判为"可救"，从而重复执行有副作用的任务。'
        + '请让 cron_recoverStuckMs >= agentTask_execLeaseMs * 2，或把租约调短')
}

/**
 * 处理一条候选时注入的副作用。集中成一处的意义见 `services/agent/recoverCandidate.js` 文件头：
 * 那段逻辑必须能在测试里被**真跑**，所以它自己不 import 会连数据库/消息队列的模块。
 */
const recoverDeps = {
    acquireClaim,
    releaseClaim,
    updateTask: (patch, filter) => agentTaskDac.update(patch, filter),
    getParent: (code) => agentTaskDac.getByCode(code),
    /** 重投的形状与派发时一致（同 topic、同 key/value）：恢复不该自创第二种投递格式 */
    send: (task) => sendMessage([{
        topic: config.kafka.topics.agentTask.topic,
        key: task.agentCode,
        value: JSON.stringify(task),
    }]),
    exec: execAgentTask,
    log: logger,
}

/**
 * @description 轮次收尾日志（两个出口共用一份格式，不许空轮少打字段）
 * @param {Object} p 计数
 * @returns {String} 日志行
 *
 * 空轮也要打整行：这次排查的关键读数就是"扫到 0"与"窗口外还堆着 5078"必须在同一行，
 * 否则运维无法区分"确实没有待救的"与"待救的都在够不着的地方"。
 *
 * @see docs/session-run-plan.md §25 v1.84
 */
function roundLine(p) {
    return `agentTask 恢复轮结束: 扫到=${p.scanned}, 触发=${p.recovered}, 跳过=${p.skipped}, `
        + `未处理=${p.idle}, 窗口外滞留=${p.stale}, 模式=${recoverModeCfg.mode}`
}

/**
 * @description 恢复滞留中断的可执行任务（执行方式由 `cron.recoverMode` 决定：direct 重执行 / requeue 重投）
 * @author xianyang
 * @param {Object} [params] 入参
 * @param {Number} [params.stuckMs] 滞留判定毫秒阈值，默认 30 分钟
 * @param {Number} [params.windowMs] 恢复窗口上界（滞留多久以内还值得救），默认 `cron.recoverWindowMs`／6 小时
 * @param {Number} [params.maxRecover] 单任务最大恢复次数，默认 2
 * @param {Boolean} [params.force] 跳过 redis 锁（运维手动触发用），默认走锁互斥
 * @returns {Promise<Number>} 本轮恢复条数
 */
export async function runAgentTaskRecover(params = {}) {
    if (!params.force) {
        const owned = await acquireOnce('lock:agentTaskRecover', 300)
        if (!owned) {
            return 0
        }
    }
    const stuckMs = Number(params.stuckMs ?? STUCK_MS)
    /**
     * 窗口可以被入参覆盖（运维临时想扫更宽/更窄），但覆盖值同样过 `resolveRecoverWindow`：
     * 一个 `<= stuckMs` 的窗口不是"扫得少一点"，而是**空区间**，
     * 而 `buildRecoverFilter` 遇到空区间直接抛错——空区间必须吵，不许被打成"今天很干净"。
     */
    const windowResolved = resolveRecoverWindow({raw: params.windowMs ?? config.cron?.recoverWindowMs, stuckMs})
    if (params.windowMs !== undefined && !windowResolved.applied) {
        logger.warn(`agentTask 本轮恢复窗口入参无效，按 ${windowResolved.windowMs}ms 执行: ${windowResolved.reason}`)
    }
    const maxRecover = Number(params.maxRecover ?? config.cron?.recoverMaxTimes ?? 2)
    const leaseMs = Number(config.agentTask?.execLeaseMs) || DEFAULT_LEASE_MS
    const filter = buildRecoverFilter({stuckMs, windowMs: windowResolved.windowMs})
    const rows = await agentTaskDac.getTop(BATCH, {
        complexFilter: filter,
    }, {updateTime: 1})
    /**
     * 窗口外（比窗口更陈旧）还滞留多少条——**每一轮都算并打进日志**，包括扫到 0 条的那些轮。
     * 理由就是这次的教训：本轮"扫到 0 条"当时看起来完全正常，只有把"窗口外还有 5108 条"
     * 摆在同一行里，才能区分"确实没有待救的"和"待救的都在够不着的地方"。
     * 这是一次带 `$lt` 的索引计数（updateTime 有索引），代价可以忽略。
     */
    const stale = await agentTaskDac.getCount({
        complexFilter: {
            handleStatus: 0,
            agentType: {$nin: [...DISPATCH_AGENT_TYPES]},
            updateTime: {$lt: filter.updateTime.$gte},
        },
    })
    if (!rows?.length) {
        logger.info(roundLine({scanned: 0, recovered: 0, skipped: 0, idle: 0, stale}))
        return 0
    }
    let recovered = 0
    let skipped = 0
    let idle = 0
    for (const task of rows) {
        try {
            /**
             * 一条候选怎么处理（取认领→决策→记数→direct/requeue）在
             * `services/agent/recoverCandidate.js`，这里只负责取数、计数与如实收尾。
             * 抽出去的原因写在那个文件头里：**这段逻辑此前从未被执行过**，
             * 一次 dev 实验就抓到 `const claim` 遮蔽外层 `let claim` 的 TypeError。
             */
            const r = await recoverOneCandidate({
                task,
                maxRecover,
                mode: recoverModeCfg.mode,
                leaseMs,
                deps: recoverDeps,
            })
            if (r.outcome === 'triggered' || r.outcome === 'requeued') {
                recovered++
            } else if (r.outcome === 'blocked') {
                skipped++
            } else {
                idle++
            }
        } catch (e) {
            /**
             * 错误详情**必须拼进消息本身**：本仓日志器是 pino，`logger.error(msg, err)` 的第二个参数
             * 在没有 `%s` 占位符时会被静默丢掉——dev 实测那条 `agentTask 恢复失败` 只剩一行、
             * 堆栈全无，定位只能靠读代码猜。全仓这种写法共 4 处（其中 2 处是我自己写的），此处先修自己这两条。
             */
            logger.error(`agentTask 恢复失败: ${task.agentCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`)
        }
    }
    logger.info(roundLine({scanned: rows.length, recovered, skipped, idle, stale}))
    return recovered
}
