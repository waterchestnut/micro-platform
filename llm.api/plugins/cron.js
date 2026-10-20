/**
 * @fileOverview 定时任务注册
 * @module plugins/cron
 * @description 仓库早就装了 `cron` 却从未 import 过（配置里的 `cron.demoPattern` 也无人读取），
 * 留存与压实因此一直没有跑起来的机会。这里把它接上：随服务启动注册、随服务关闭停止，
 * 任务本体在 `tasks/retention.js`。
 *
 * 多副本下每个 pod 都会到点触发，所以 `runRetention` 内部先抢 redis 锁；
 * 抢不到就跳过，不会出现 N 个副本同时删数据的场面。
 */

import fp from 'fastify-plugin'
import {CronJob} from 'cron'
import config from '../conf/system.config.js'
import {runRetention} from '../tasks/retention.js'

export default fp(async function (fastify, opts) {
    const cfg = config.cron || {}
    const jobs = []

    /**
     * 注册一个任务：表达式缺失或被关掉就什么都不做，绝不因为定时任务配置不全而阻塞启动
     */
    const register = (name, pattern, handler, enabled) => {
        if (!enabled) {
            fastify.log.info(`定时任务 ${name} 未启用`)
            return
        }
        if (!pattern) {
            fastify.log.warn(`定时任务 ${name} 缺少 cron 表达式，跳过`)
            return
        }
        const job = new CronJob(pattern, async () => {
            try {
                await handler()
            } catch (e) {
                fastify.log.error(`定时任务 ${name} 执行异常: ${e.stack || e.message}`)
            }
        }, null, true, cfg.timezone || 'Asia/Shanghai')
        job.start()
        jobs.push({name, job})
        fastify.log.info(`定时任务 ${name} 已注册: ${pattern}`)
    }

    register('retention', cfg.retentionPattern, () => runRetention({}), cfg.retentionEnabled !== false)

    fastify.addHook('onClose', async () => {
        for (const {name, job} of jobs) {
            try {
                job.stop()
            } catch (e) {
                fastify.log.warn(`定时任务 ${name} 停止失败: ${e.message}`)
            }
        }
    })

    /** 便于运维核对下一次触发时间 */
    fastify.decorate('cronJobs', () => jobs.map(j => ({
        name: j.name,
        nextDate: typeof j.job.nextDate === 'function' ? String(j.job.nextDate()) : null,
    })))
})
