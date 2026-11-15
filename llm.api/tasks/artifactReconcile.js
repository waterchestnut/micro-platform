/**
 * @fileOverview artifact 对账的定时任务体（PR-H2 窗口项"对账 cron 部署+实测 verify"的收口刀）
 * @module tasks/artifactReconcile
 * @description
 * backfill/sleepTime 同款形态：**runPlan 纯函数、锁、编排、日志**在这一层；
 * 分类与动作白名单在 `services/core/artifact/artifactReconcile.js`（判据），
 * 执行核在 `reconcileRunner.js`（默认干跑+AUTO_ACTIONS+行级隔离），本层只接线。
 *
 * 三道默认关的理由与其它写库任务同族且更直接：这个任务**会删 doc.api 上的用户内容**
 * （tombstone 覆盖）——`artifactReconcileEnabled` 控注册、`artifactReconcileEnforce` 控动手，
 * 只开注册=完整跑分类与核验、plans 里如实列"如果开闸会做什么"，一个动作都不做。
 *
 * 取数面是两个扫描的并集，缺一就有隐身区：
 *   scanStalled = started/pulled/uploaded（在途卡住）；
 *   scanHandleMissing = registered/ready 却没有 fileCode（2026-11-15 born-registered 实锤的
 *   教训：谎称登记态的行恰好在第一扫描的视野外，旧判据还会把它们读成 consistent）。
 * 按 artifactCode 去重（一行只进一次批次，动作序稳定）。
 *
 * verify 的判据来自同一轮实测（HEAD 200/404/其余；Range 不可用），实现在 docApiUpload。
 */
import {runReconcilePass} from '../services/core/artifact/reconcileRunner.js'

const logger = llm.logger
const config = llm.config

/** 核验/补偿用的系统身份（内网 user-info 只要求可解码，ragStore 同款信任模型；审计面认得它是 cron） */
const RECONCILING_USER = {userCode: 'cron:artifactReconcile', realName: 'reconciler'}

/**
 * @description "这次到底怎么跑"的纯决定（先校验后加锁，与 backfillRunPlan 同律）
 * @param {Object} params {cronConfig, overrides}
 * @returns {Object} {ok, reason, enforce, graceMs, limit}
 *
 * 安全阀只有破坏方向：graceMs 小于一次大文件 intake 的量级（64MB 上限的上传按分钟计），
 * 对账就会把**在途** intake 当孤儿回收——这正是 backfill"阈值比 run 短=定时制造假损失"的同族，
 * 所以低于 10 分钟直接拒绝执行（runner 的 10 分钟默认值就是这里的地板）。
 */
export function artifactReconcileRunPlan({cronConfig = {}, overrides = {}} = {}) {
    const graceMs = Number(overrides.graceMs ?? cronConfig.artifactReconcileGraceMs ?? 10 * 60 * 1000)
    if (!Number.isFinite(graceMs) || graceMs < 10 * 60 * 1000) {
        return {ok: false, reason: `graceMs=${graceMs} 低于 10 分钟地板：宽限小于一次大文件 intake，对账会把在途当孤儿回收`, enforce: false, graceMs, limit: 0}
    }
    const limit = Number(overrides.limit ?? cronConfig.artifactReconcileLimit ?? 200)
    if (!(limit >= 1)) {
        return {ok: false, reason: `limit=${limit} 必须 ≥1`, enforce: false, graceMs, limit: 0}
    }
    return {
        ok: true,
        reason: 'planned',
        /** 严格布尔：'true' 字符串不算开（FASTIFY_CLOSE_GRACE_DELAY 同因）；默认干跑 */
        enforce: overrides.enforce ?? (cronConfig.artifactReconcileEnforce === true),
        graceMs,
        limit,
    }
}

/**
 * @description 跑一轮 artifact 对账
 * @param {Object} [params] {graceMs, limit, enforce, lockTtlSeconds, force, now, deps}
 * @param {Object} [params.deps] 注入依赖（离线用例；缺省懒取真件——默认关时整条链根本不加载 dac）
 * @returns {Promise<Object>} 结果（含 skipped 原因）
 */
export async function runArtifactReconcile(params = {}) {
    const cronConfig = config.cron || {}
    const plan = artifactReconcileRunPlan({cronConfig, overrides: params})
    if (!plan.ok) {
        logger.error(`artifact 对账未执行：${plan.reason}`)
        return {skipped: 'invalid-plan', reason: plan.reason}
    }
    const deps = params.deps || (await realDeps())
    const lockKey = 'lock:artifactReconcile'
    const lockTtl = Number(params.lockTtlSeconds ?? cronConfig.artifactReconcileLockTtlSeconds ?? 30 * 60)
    const got = params.force ? true : await deps.acquireOnce(lockKey, lockTtl)
    if (!got) {
        logger.info('artifact 对账锁占用中，跳过本次触发')
        return {skipped: 'lock-held'}
    }
    try {
        const now = params.now ?? Date.now()
        const olderThan = new Date(now - plan.graceMs)
        /** 两扫描并集按 artifactCode 去重：矛盾行同时被两边捞到时只进一次批次 */
        const rows = []
        const seen = new Set()
        for (const list of [await deps.scanStalled(olderThan, plan.limit), await deps.scanHandleMissing(olderThan, plan.limit)]) {
            for (const r of list || []) {
                if (r?.artifactCode && !seen.has(r.artifactCode)) {
                    seen.add(r.artifactCode)
                    rows.push(r)
                }
            }
        }
        const ret = await runReconcilePass({
            rows,
            opts: {graceMs: plan.graceMs, now, enforce: plan.enforce},
            deps: {
                verifyDocFile: deps.verifyDocFile,
                // 引用面当前只有行上的挂载列（跨消息引用未接线）；挂载接线落地后这里自然升级，判据不动
                isReferenced: (row) => Boolean(row?.messageCode),
                markIntegrity: (artifactCode, mark) => deps.setIntegrity(artifactCode, mark),
                deleteDocFile: (artifactCode, fileCode) => deps.tombstoneDocFile({fileCode, artifactCode}),
                dropAllocation: (artifactCode) => deps.markUnregistered(artifactCode),
                notify: (payload) => logger.warn(`artifact 对账通报: ${JSON.stringify(payload)}`),
            },
        })
        logger.info(`artifactReconcile ${plan.enforce ? '执行' : '干跑'}: 行=${rows.length}, `
            + Object.entries(ret.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ')
            + `, 动作=${ret.executedAll}, 跳过终态=${ret.skippedSettled}`)
        return {...ret, lock: 'acquired', scanned: rows.length, dryRun: !plan.enforce}
    } finally {
        try {
            await deps.releaseLock(lockKey)
        } catch (e) {
            logger.warn(`artifact 对账锁释放失败(${e.message})，依赖 TTL 自动过期`)
        }
    }
}

/** 真依赖全动态（schema 链顶层 await 连库；默认关时一行都不加载——abandonedBackfill 家规） */
async function realDeps() {
    const [{acquireOnce}, {default: dac}, uploadMod, wiringMod] = await Promise.all([
        import('../daos/cache/l2Cache.js'),
        import('../daos/core/dac/artifactDac.js'),
        import('../services/core/artifact/docApiUpload.js'),
        import('../services/core/artifact/intakeWiring.js'),
    ])
    const docApiConfig = config.docApiConfig || {}
    return {
        scanStalled: (olderThan, limit) => dac.scanStalled(olderThan, limit),
        scanHandleMissing: (olderThan, limit) => dac.scanHandleMissing(olderThan, limit),
        setIntegrity: (artifactCode, mark) => dac.setIntegrity(artifactCode, mark),
        markUnregistered: (artifactCode) => dac.markUnregistered(artifactCode),
        verifyDocFile: uploadMod.makeDocFileVerifier({docApiConfig, userInfo: RECONCILING_USER}),
        tombstoneDocFile: ({fileCode}) => wiringMod.tombstoneDocFile({fileCode, docApiConfig, userInfo: RECONCILING_USER}),
        acquireOnce: (key, ttl) => acquireOnce(key, ttl),
        releaseLock: async (key) => {
            const {default: redisClient} = await import('../daos/cache/redisClient.js')
            await redisClient.delValue(key)
        },
    }
}

export default {artifactReconcileRunPlan, runArtifactReconcile}
