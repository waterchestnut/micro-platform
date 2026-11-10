/**
 * @fileOverview 数据留存/压实定时进程（独立进程模式）
 * @module cron/retention
 * @description 为什么独立进程：API 进程里挂 cron（fastify 插件）会让每个副本都注册同一任务，
 * 靠 redis 锁去重只是不出错，不是架构——发布重启会打断长任务、任务耗时反压 API 的
 * 事件循环与优雅停机窗口。独立进程一个环境起一份，跑长任务与 HTTP 服务互不相干。
 *
 * 两道保险都保留、各司其职：
 *   1) 进程内 executing 标记——同一进程两次触发不叠跑（上次没跑完到点再触发）；
 *   2) runRetention 内部 redis 锁——多副本/误开两份进程时互斥（10 分钟窗口）。
 * 启停开关在 config.cron.retentionEnabled（env cron_retentionEnabled=true）；
 * 未开启时进程保持存活但不注册任务，方便部署形态统一（同一镜像不同 env）。
 *
 * 启动：node cron/retention.js
 */

import '../init.js'

const logger = llm.logger
const cronConfig = llm.config.cron || {}

import {CronJob} from 'cron'
import {runRetention} from '../tasks/retention.js'
import {runBackfill} from '../tasks/abandonedBackfill.js'
import {createDrainController, resolveDrainBudget} from '../daos/core/policy/drainPolicy.js'

/** 定时进程不能被一次任务异常带走：记日志继续等下一个周期（参照 callin 的兜底写法） */
const _fnError = function (err) {
    logger.error(err)
}
process.on('uncaughtException', _fnError)
process.on('unhandledRejection', _fnError)

const jobs = {}

/**
 * 停机排空（判据与 kafka 消费者共用一份）。原来这里是 `process.on('SIGTERM', () => process.exit(0))`：
 * 收到信号就**当场放弃在途任务**。对本进程来说代价不是"少删点数据"，
 * 而是 runRetention 内部那把 redis 锁（10 分钟窗口）会一直挂着 ——
 * 下一次触发被锁挡掉，看起来像"定时任务静默失效"。
 */
const drain = createDrainController()
/** @type {Array<Object>} 已注册的 CronJob，停机时逐个 stop */
const registeredJobs = []

/**
 * @description 给一轮任务加停机闸门：置位后不再开新轮，在途轮次计入排空等待
 * @param {String} name 任务名（日志与 pending 标识）
 * @param {Function} body 任务体
 * @returns {Promise<void>} 结果
 */
async function runGuarded(name, body) {
    if (!drain.start(name)) {
        logger.info(`${name}-进程停机中，不开新轮`)
        return
    }
    try {
        await body()
    } finally {
        drain.finish(name)
    }
}

if (cronConfig.retentionEnabled) {
    const pattern = cronConfig.retentionPattern || '45 3 * * *'
    const job = new CronJob(pattern, () => runGuarded('retention', async () => {
        jobs.retention = jobs.retention || {executing: false}
        if (jobs.retention.executing) {
            logger.info('retention-任务仍在执行，跳过本次触发')
            return
        }
        jobs.retention.executing = true
        try {
            const ret = await runRetention({})
            logger.info(`retention 完成: ${JSON.stringify(ret)}`)
        } catch (e) {
            logger.error(`retention 任务异常: ${e.stack || e.message}`)
        } finally {
            jobs.retention.executing = false
        }
    }), null, true, cronConfig.timezone || 'Asia/Shanghai')
    registeredJobs.push(job)
    logger.info(`cron/retention 已注册 pattern=${pattern} tz=${cronConfig.timezone || 'Asia/Shanghai'} nextDate=${String(job.nextDate?.() ?? '-')}`)
} else {
    logger.info('cron/retention 未启用（需 cron_retentionEnabled=true），进程存活但不注册任务')
}

/**
 * 遗弃 run 回填。两道开关、默认都关（配置注释在 conf/system.config.js 的 cron 段）：
 * `backfillEnabled` 决定要不要注册，`backfillWrite` 决定是只出计划还是真写档案。
 * 这个任务改的是**用户会看见的档案行**，所以"开了定时"与"开始写库"必须能分别回退。
 */
if (cronConfig.backfillEnabled) {
    const backfillPattern = cronConfig.backfillPattern || '15 4 * * *'
    const backfillJob = new CronJob(backfillPattern, () => runGuarded('abandonedBackfill', async () => {
        jobs.backfill = jobs.backfill || {executing: false}
        if (jobs.backfill.executing) {
            logger.info('abandonedBackfill-任务仍在执行，跳过本次触发')
            return
        }
        jobs.backfill.executing = true
        try {
            const ret = await runBackfill({})
            logger.info(`abandonedBackfill 完成: ${JSON.stringify(ret)}`)
        } catch (e) {
            logger.error(`abandonedBackfill 任务异常: ${e.stack || e.message}`)
        } finally {
            jobs.backfill.executing = false
        }
    }), null, true, cronConfig.timezone || 'Asia/Shanghai')
    registeredJobs.push(backfillJob)
    logger.info(`cron/abandonedBackfill 已注册 pattern=${backfillPattern} `
        + `写档=${cronConfig.backfillWrite ? 'ON' : 'OFF(只出计划)'} nextDate=${String(backfillJob.nextDate?.() ?? '-')}`)
} else {
    logger.info('cron/abandonedBackfill 未启用（需 cron_backfillEnabled=true；写库另需 cron_backfillWrite=true）')
}

/**
 * @description 收到终止信号后的收尾：停注册 → 等在途 → 退出
 * @param {String} signal 信号名
 * @returns {Promise<void>} 结果
 */
async function shutdown(signal) {
    const budget = resolveDrainBudget({
        envValue: process.env.CRON_DRAIN_TIMEOUT_MS,
        terminationGraceSeconds: process.env.TERM_GRACE_PERIOD_SECONDS,
        preStopSeconds: process.env.PRE_STOP_SECONDS,
    })
    const snap = drain.beginDraining()
    /** 先 stop 再等：不停的话排空期间 cron 还能再点一轮，等待就永远等不到头 */
    for (const j of registeredJobs) {
        try {
            j.stop()
        } catch (e) {
            logger.error(`cron stop 失败（不影响退出）: ${e.stack || e.message}`)
        }
    }
    const r = await drain.waitForDrain(budget.budgetMs)
    logger.warn(`cron 停机排空: signal=${signal} 预算=${budget.budgetMs}ms(${budget.reason}, env采纳=${budget.applied}) `
        + `置位时在途=${JSON.stringify(snap.pending)} 结果=${r.drained ? '已排空' : '超时未排空'} 等待=${r.waitedMs}ms `
        + `未完成=${JSON.stringify(r.pending)}${r.timedOut ? ' ⇒ 可能留下未释放的 redis 锁，下一次触发会被挡到锁过期' : ''}`)
    process.exit(0)
}

/** 用 once：收尾里有 await，重复信号不能把流程重入 */
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
        shutdown(sig).catch(e => {
            logger.error(`cron 停机收尾异常，直接退出: ${e.stack || e.message}`)
            process.exit(1)
        })
    })
}
