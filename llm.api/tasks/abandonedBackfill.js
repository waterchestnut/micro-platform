/**
 * @fileOverview 遗弃 run 回填的定时任务体
 * @module tasks/abandonedBackfill
 * @description
 * 由 `cron/retention.js` 注册（独立进程，一个环境一份）。这一层只做三件事：
 * **锁、开关、把结果变成日志**，判据与写库都在 `services/core/session/abandonedBackfill.js`。
 *
 * 为什么要有 redis 锁：认领虽然是原子的（不会写出重复档案），但两个进程同时扫会做重复的读与日志，
 * 而且"谁在写用户可见档案"这件事必须只有一个答案。锁是运营面的清晰，不是正确性的兜底——
 * 真正确性靠 `claimAbandoned` 的原子性。这个区别要写清，否则后来人会把锁当幂等用。
 *
 * 开关在 `config.cron`：`backfillEnabled` 与 `backfillWrite` **两道默认都关**（理由见配置注释）。
 */
import {acquireOnce} from '../daos/cache/l2Cache.js'
import {backfillAbandonedRuns} from '../services/core/session/abandonedBackfill.js'
import {validateOlderThan, DEFAULT_OLDER_THAN_MS} from '../daos/core/policy/llmUsagePolicy.js'

const logger = llm.logger
const config = llm.config

/**
 * @description 把"这次到底怎么跑"的决定抽成纯函数（可离线测；锁与写库都不该参与这层测试）
 * @param {Object} params 参数
 * @param {Object} [params.cronConfig] `config.cron`
 * @param {Object} [params.overrides] 调用方给的覆盖项
 * @param {Function} [params.now] 时间源（注入给阈值校验）
 * @returns {{ok: Boolean, reason: String, dryRun: Boolean, olderThanMs: Number, limit: Number}} 结果
 *
 * 阈值必须过安全阀：把回填调成比一次正常 run 还短，等于**定时制造假损失**
 * （每条还在跑的长生成都会被补成 `abort`，比原缺陷更糟），所以这里拒绝执行而不是记一条 warn。
 */
export function backfillRunPlan({cronConfig = {}, overrides = {}} = {}) {
    const olderThanMs = Number(overrides.olderThanMs ?? cronConfig.backfillOlderThanMs ?? DEFAULT_OLDER_THAN_MS)
    const check = validateOlderThan(olderThanMs)
    if (!check.ok) {
        return {ok: false, reason: check.reason, dryRun: true, olderThanMs, limit: 0}
    }
    return {
        ok: true,
        reason: 'planned',
        /**
         * `dryRun` 的默认值必须站在"不动数据"那一边：只有 `backfillWrite===true` 才写。
         * 用 `!== true` 而不是 `=== false`，是因为配置缺失（undefined）时的安全方向就是不写。
         */
        dryRun: overrides.dryRun ?? (cronConfig.backfillWrite !== true),
        olderThanMs,
        limit: Number(overrides.limit ?? cronConfig.backfillLimit ?? 200),
    }
}

/**
 * @description 跑一次遗弃 run 回填
 * @param {Object} [params] 参数
 * @param {Boolean} [params.dryRun] 只出计划（默认取 config.cron.backfillWrite 的反面）
 * @param {Number} [params.olderThanMs] 心跳阈值
 * @param {Number} [params.limit] 单次条数
 * @param {Number} [params.lockTtlSeconds] 锁窗口
 * @param {Boolean} [params.force] 跳过锁（人工补救时用）
 * @returns {Promise<Object>} 结果（含 skipped 原因）
 */
export async function runBackfill(params = {}) {
    const cronConfig = config.cron || {}
    const plan = backfillRunPlan({cronConfig, overrides: params})
    if (!plan.ok) {
        logger.error(`回填未执行：${plan.reason}`)
        return {skipped: 'invalid-olderThanMs', reason: plan.reason}
    }
    const {olderThanMs, dryRun, limit} = plan
    const lockKey = 'lock:abandonedBackfill'
    const lockTtl = Number(params.lockTtlSeconds ?? 10 * 60)
    const got = params.force ? true : await acquireOnce(lockKey, lockTtl)
    if (!got) {
        logger.info('回填锁占用中，跳过本次触发')
        return {skipped: 'lock-held'}
    }
    try {
        const r = await backfillAbandonedRuns({
            dryRun,
            olderThanMs,
            limit,
        })
        /**
         * 这条日志是运营面：模式、扫到几条、动了几条、跳过原因分布。
         * dry-run 时 `backfilled` 里全是计划，不写出来就等于"跑没跑过"无从判断。
         */
        logger.info(`abandonedBackfill ${dryRun ? '计划' : '执行'}: 扫到=${r.planned}, 回填=${r.backfilled.length}, `
            + `跳过=${r.skipped.length}, 跳过分布=${JSON.stringify(r.skipped.reduce((a, x) => {
                const k = String(x.reason).split(':')[0]
                a[k] = (a[k] || 0) + 1
                return a
            }, {}))}`)
        return {...r, lock: 'acquired', dryRun}
    } finally {
        try {
            const {default: redisClient} = await import('../daos/cache/redisClient.js')
            await redisClient.delValue(lockKey)
        } catch (e) {
            logger.warn(`回填锁释放失败(${e.message})，依赖 TTL 自动过期`)
        }
    }
}
