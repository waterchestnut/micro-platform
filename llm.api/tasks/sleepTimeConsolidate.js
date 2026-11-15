/**
 * @fileOverview sleep-time 记忆整理的定时任务体（PR-O 执行壳；判据在 services/core/memory/sleepTime.js）
 * @module tasks/sleepTimeConsolidate
 * @description
 * 与 `tasks/abandonedBackfill.js` 同款形态：**锁、开关、编排、日志**在这一层；
 * 可证明关系与消费选择都在判据层（纯函数）；模型 I/O 在 `services/core/memory/consolidator.js`。
 *
 * 开关沿用作坊的双闸纪律：`cron_sleepTimeEnabled`（注册定时）与 `cron_sleepTimeWrite`（真写库）
 * **默认都关**——这个任务会退役用户的记忆条目、会花真金白银的模型调用，
 * "开定时"和"开始写"必须是两个可分别回退的动作（backfill 的注释理由在此全额适用）。
 *
 * 执行只走 `consolidationAdvisory()` 白名单里的三种动作：
 *   insert-atom（提炼产物，**state=review**）、soft-retire-atom（被并条目带 supersededBy 退役）、
 *   mark-distilled（episode 打 distilledInto 标）。
 * 硬删、动 pinned、跨 namespace 写都不存在——白名单是门不是君子协定，
 * 所以编排层对注入进来的动作仍做一次 kind/证据复核（防的是未来有人给 parse 加"聪明"分支）。
 *
 * 提炼产物进 review 而非 active：与 promote 的 supersede 决定同款纪律
 * （"替代者先进待审，避免自动判定直接改写用户可见的记忆生效集"）——
 * 整理 agent 的输出也要经过既有的确认通道，sleep-time 不新造"模型直写生效集"这条路。
 *
 * distilledInto 的存储位是 tags（schema 没有专字段，不为一个后台标去动权威 schema）：
 * 判据层契约字段 `distilledInto` 由本层的 toJudgeAtoms/打标函数适配，读写两侧都只认这个约定。
 */
import {planConsolidation, selectDistillCandidates, DISTILLABLE_KINDS, CONSOLIDATION_ACTIONS} from '../services/core/memory/sleepTime.js'
import {runConsolidation} from '../services/core/memory/consolidator.js'
import MemoryStatusEnum from '../daos/core/enum/MemoryStatusEnum.js'

const logger = llm.logger
const config = llm.config
const tools = llm.tools

/**
 * dac 一律**不静态 import**（`services/core/session/abandonedBackfill.js` 文件头的家规原文）：
 * dac 链上的 schema/index.js 顶层 await 真连 mongodb、失败三连后 `process.exit(1)`——
 * 静态引它等于让执行壳的每一条纯编排逻辑在离线单测里拖真环境下水。
 * 需要真依赖时由 `realDeps()` 动态 import；测试注入全套假 deps，根本不走到那条路。
 */
const REQUIRED_DEPS = ['atomDac', 'namespaceDac', 'runConsolidation', 'dropFromStore', 'journal', 'getUUID', 'acquireOnce', 'releaseLock']

/** 白名单的机械常量（判据层 consolidationAdvisory 的 allowed 项名，断言用例里对账） */
const DISTILLED_TAG_KEY = 'distilledInto'

/**
 * @description 存储形态（mongo doc）→ 判据视图的适配（sleepTime.js 认 text/insertTime(Number)/pinned/distilledInto）
 * @param {Object[]} docs atom 文档
 * @returns {Object[]} 判据视图（保留 doc 引用在 $doc 供写路径取字段）
 */
export function toJudgeAtoms(docs = []) {
    return docs.map((d) => ({
        atomCode: d.atomCode,
        kind: d.kind,
        text: d.content,
        confidence: Number(d.confidence) || 0,
        insertTime: d.insertTime ? new Date(d.insertTime).getTime() : 0,
        /** promotion 硬规则 2 的存储形态：用户显式保存 = source user_save */
        pinned: d.source === 'user_save',
        distilledInto: (d.tags || []).find?.(t => t?.key === DISTILLED_TAG_KEY)?.value,
        $doc: d,
    }))
}

/**
 * @description 把"这次到底怎么跑"的决定抽成纯函数（backfillRunPlan 同款可离线测）
 * @param {Object} params 参数
 * @param {Object} [params.cronConfig] `config.cron`
 * @param {Object} [params.memoryConfig] `config.memory`
 * @param {Object} [params.overrides] 调用方覆盖项
 * @returns {Object} {ok, reason, dryRun, dupSimilarity, maxNamespaces, idleMs, atomCap, distill}
 *
 * 安全阀只拦**破坏性方向**：dupSimilarity < 0.8 会把不同事实批量判成重复——
 * 整理在无人审路径上静默退役真记忆，比不整理糟糕得多；阈值调高只是少合并（保守方向），不拦。
 * atomCap < minEpisodes 也拦：这是"配置自相矛盾"（永远凑不齐提炼门槛的静默空转，
 * 闸关着登记表恒空同族的事，比报错更难查）。
 */
export function sleepTimeRunPlan({cronConfig = {}, memoryConfig = {}, overrides = {}} = {}) {
    const cons = memoryConfig.consolidation || {}
    const dupSimilarity = Number(overrides.dupSimilarity ?? cons.dupSimilarity ?? 0.92)
    if (!Number.isFinite(dupSimilarity) || dupSimilarity < 0.8) {
        return {ok: false, reason: `dupSimilarity=${dupSimilarity} 低于 0.8：相似度判据过松会把不同事实批量判成重复并静默退役，拒绝执行`, dryRun: true}
    }
    const idleMs = Number(overrides.idleMs ?? cronConfig.sleepTimeIdleMs ?? 60 * 60 * 1000)
    if (!Number.isFinite(idleMs) || idleMs < 0) {
        return {ok: false, reason: `sleepTimeIdleMs=${idleMs} 不是非负毫秒数`, dryRun: true}
    }
    const distill = {
        minEpisodeAgeDays: Number(overrides.minEpisodeAgeDays ?? cons.minEpisodeAgeDays ?? 7),
        minEpisodes: Number(overrides.minEpisodes ?? cons.minEpisodes ?? 3),
        maxPerRun: Number(overrides.maxPerRun ?? cons.maxPerRun ?? 20),
    }
    const atomCap = Number(overrides.atomCap ?? cons.atomCap ?? 500)
    if (!(atomCap >= 2) || !(atomCap >= distill.minEpisodes)) {
        return {ok: false, reason: `atomCap=${atomCap} 低于 minEpisodes=${distill.minEpisodes}：永远凑不齐提炼门槛的静默空转`, dryRun: true}
    }
    const maxNamespaces = Number(overrides.maxNamespaces ?? cronConfig.sleepTimeMaxNamespaces ?? 20)
    if (!(maxNamespaces >= 1)) {
        return {ok: false, reason: `maxNamespaces=${maxNamespaces} 必须 ≥1`, dryRun: true}
    }
    return {
        ok: true,
        reason: 'planned',
        /** 默认站"不动数据"一边：只有 sleepTimeWrite===true 才写（严格布尔，backfill 同款教训） */
        dryRun: overrides.dryRun ?? (cronConfig.sleepTimeWrite !== true),
        dupSimilarity,
        idleMs,
        maxNamespaces,
        atomCap,
        distill,
        /** 提炼产物的置信度起点（review 态，确认后由人工通道调整） */
        confidence: Number(overrides.confidence ?? cons.confidence ?? 0.5),
    }
}

/**
 * @description 证据并集（eventCode/atomCode 双键去重——比 promote 的 merge 分支多认 atomCode 键，
 * 整理产物与原子的证据可能指向 episode 原子而非事件；两种来源混排时单键去重会留下重复证据）
 * @param {...Array} lists 证据数组们
 * @returns {Object[]} 并集
 */
function unionEvidence(...lists) {
    const seen = new Set()
    const out = []
    for (const list of lists) {
        for (const e of list || []) {
            const key = e?.eventCode ? `e:${e.eventCode}` : e?.atomCode ? `a:${e.atomCode}` : null
            if (!key || seen.has(key)) {
                continue
            }
            seen.add(key)
            out.push(e)
        }
    }
    return out
}

/**
 * @description 单个 namespace 的整理编排（判据 → 合并落库 → 提炼消费）
 * @param {Object} args 参数
 * @param {Object} args.ns {userCode, channel, workspaceId}
 * @param {Object} args.plan sleepTimeRunPlan 的产物
 * @param {Number} args.now 时间源
 * @param {Object} args.deps 注入依赖 {atomDac, runConsolidation, dropFromStore, journal, getUUID}（离线用例走真函数体）
 * @returns {Promise<Object>} 本 ns 的统计
 *
 * dry-run 不调模型：模型调用是真金白银，"只出计划"必须连钱都不花。
 * 合并写路径的顺序照抄 promote 的 supersede 分支（先退役 away、再更新 keep、再摘索引、journal 双行），
 * 但**不降级证据事件**——dedupe 合并里被并方不是错误事实，其事件仍是 keep 方成立证据的一部分。
 */
export async function consolidateNamespace({ns, plan, now, deps}) {
    const {atomDac, runConsolidation: callModel, dropFromStore: dropStore, journal, getUUID} = deps
    const nsFilter = {userCode: ns.userCode, channel: ns.channel, workspaceId: ns.workspaceId || null}
    const rows = await atomDac.getTop(plan.atomCap, {...nsFilter, state: MemoryStatusEnum.active.value}, {insertTime: 1}) || []
    const judge = toJudgeAtoms(rows)

    // —— 1. 可证明关系合并 ——
    const {actions: mergeActions} = planConsolidation(judge, {now, dupSimilarity: plan.dupSimilarity})
    const awaySet = new Set(mergeActions.map(a => a.away))
    let mergesApplied = 0
    if (mergeActions.length && !plan.dryRun) {
        const byCode = new Map(judge.map(a => [a.atomCode, a]))
        /** keep 侧的并集要跨多条 action 累积（一个 keep 可能吃掉多个 away） */
        const keepAdds = new Map()
        for (const act of mergeActions) {
            const away = byCode.get(act.away); const keep = byCode.get(act.keep)
            await atomDac.update({state: MemoryStatusEnum.retired.value, supersededBy: act.keep}, {atomCode: act.away})
            await journal({
                userCode: ns.userCode, channel: ns.channel, actor: 'system', op: 'supersede',
                targetType: 'atom', targetCode: act.away,
                before: {state: MemoryStatusEnum.active.value, content: away?.text},
                after: {state: MemoryStatusEnum.retired.value, replacedBy: act.keep},
                reason: `sleep-time-consolidation:${act.evidence.contained ? 'contained' : 'similar'}(sim=${act.evidence.sim})`,
            })
            const acc = keepAdds.get(act.keep) || {mergedFrom: [], evidence: [...(keep?.$doc?.evidence || [])]}
            acc.mergedFrom.push(act.away)
            acc.evidence = unionEvidence(acc.evidence, away?.$doc?.evidence)
            keepAdds.set(act.keep, acc)
            await dropStore(away?.$doc || {atomCode: act.away, ...nsFilter})
            mergesApplied++
        }
        for (const [keepCode, acc] of keepAdds) {
            const keepDoc = byCode.get(keepCode)?.$doc
            await atomDac.update({
                mergedFrom: [...new Set([...(keepDoc?.mergedFrom || []), ...acc.mergedFrom])],
                evidence: acc.evidence,
            }, {atomCode: keepCode})
            await journal({
                userCode: ns.userCode, channel: ns.channel, actor: 'system', op: 'merge',
                targetType: 'atom', targetCode: keepCode,
                after: {mergedAway: acc.mergedFrom, evidenceCount: acc.evidence.length},
                reason: 'sleep-time-consolidation',
            })
        }
    }

    // —— 2. 提炼候选（写路径以库为准重读；dry 路径用计划视图） ——
    let view
    if (plan.dryRun) {
        view = judge.filter(a => !awaySet.has(a.atomCode))
    } else {
        const fresh = await atomDac.getTop(plan.atomCap, {...nsFilter, state: MemoryStatusEnum.active.value}, {insertTime: 1}) || []
        view = toJudgeAtoms(fresh)
    }
    const candidates = selectDistillCandidates(view, {
        now,
        minEpisodeAgeDays: plan.distill.minEpisodeAgeDays,
        minEpisodes: plan.distill.minEpisodes,
        maxPerRun: plan.distill.maxPerRun,
    })
    const existingDP = view.filter(a => DISTILLABLE_KINDS.includes(a.kind))

    let distillsInserted = 0
    let episodesMarked = 0
    let model = null
    if (candidates.length && !plan.dryRun) {
        const ret = await callModel({episodes: candidates, existingAtoms: existingDP})
        model = ret.model
        const candidateCodes = new Set(candidates.map(c => c.atomCode))
        const producedCodes = []
        for (const act of ret.actions || []) {
            if (!act || act.action !== 'distill') {
                continue
            }
            /** 执行层的白名单复核（门不是君子协定）：kind 与证据出处不合法的动作直接拒执行 */
            if (!DISTILLABLE_KINDS.includes(act.kind)) {
                logger.warn(`整理动作 kind=${act.kind} 不在白名单，拒执行`)
                continue
            }
            const ev = (act.evidenceAtomCodes || []).filter(c => candidateCodes.has(c))
            if (!ev.length || typeof act.text !== 'string' || !act.text.trim()) {
                logger.warn('整理动作缺有效证据或正文，拒执行')
                continue
            }
            const atomCode = getUUID()
            await atomDac.add({
                ...nsFilter,
                atomCode,
                kind: act.kind,
                content: act.text.trim(),
                headline: act.text.trim().slice(0, 500),
                topic: 'consolidated',
                topics: ['consolidated'],
                confidence: plan.confidence,
                evidence: ev.map(atomCodeEv => ({atomCode: atomCodeEv, quote: null})),
                source: 'auto',
                state: MemoryStatusEnum.review.value,
                operator: {userCode: ns.userCode, realName: ''},
            })
            await journal({
                userCode: ns.userCode, channel: ns.channel, actor: 'system', op: 'create',
                targetType: 'atom', targetCode: atomCode,
                after: {state: MemoryStatusEnum.review.value, kind: act.kind, content: act.text.trim().slice(0, 200)},
                evidence: ev.map(atomCodeEv => ({atomCode: atomCodeEv})),
                reason: 'sleep-time-distill',
            })
            producedCodes.push(atomCode)
            distillsInserted++
        }
        // —— 3. 消费标记：无论有没有产出，进过模型的 episode 都打标（不重复烧钱） ——
        const tagValue = producedCodes.join(',') || 'noop'
        for (const cand of candidates) {
            const doc = cand.$doc
            const tags = [...(doc?.tags || []).filter(t => t?.key !== DISTILLED_TAG_KEY), {key: DISTILLED_TAG_KEY, value: tagValue}]
            await atomDac.update({tags}, {atomCode: cand.atomCode})
            /** 打标不写 journal：tags 不是生效内容（家规管的是"对记忆生效内容的变更"），
             *  出处链由提炼原子的 evidence 承载；noop 消费的痕迹在任务日志里 */
            episodesMarked++
        }
    }
    return {
        ns: `${ns.userCode}/${ns.channel}/${ns.workspaceId || '-'}`,
        mergesPlanned: mergeActions.length,
        mergesApplied,
        distillCandidates: candidates.length,
        distillsInserted,
        episodesMarked,
        model,
    }
}

/** 真实依赖（动态装配——schema 链只在真执行时载入；锁也可注入，backfill 的锁路径只能真环境摸，这里不留那个盲区） */
async function realDeps() {
    const [{acquireOnce}, {default: atomDac}, {default: namespaceDac}, promoteMod] = await Promise.all([
        import('../daos/cache/l2Cache.js'),
        import('../daos/core/dac/memoryAtomDac.js'),
        import('../daos/core/dac/memoryNamespaceDac.js'),
        import('../services/core/memory/promote.js'),
    ])
    return {
        atomDac,
        namespaceDac,
        runConsolidation,
        dropFromStore: promoteMod.dropFromStore,
        journal: promoteMod.journalMemoryChange,
        getUUID: () => tools.getUUID(),
        acquireOnce: (key, ttl) => acquireOnce(key, ttl),
        releaseLock: async (key) => {
            const {default: redisClient} = await import('../daos/cache/redisClient.js')
            await redisClient.delValue(key)
        },
    }
}

/**
 * @description 跑一轮 sleep-time 整理
 * @param {Object} [params] 参数（overrides 进 sleepTimeRunPlan）
 * @param {Object} [params.deps] 注入依赖（离线用例）
 * @param {Number} [params.now] 时间源
 * @param {Boolean} [params.force] 跳过锁（人工补跑）
 * @param {Number} [params.lockTtlSeconds] 锁窗口
 * @returns {Promise<Object>} 结果（含 skipped 原因与逐 ns 统计）
 */
export async function runSleepTimeConsolidate(params = {}) {
    const cronConfig = config.cron || {}
    const plan = sleepTimeRunPlan({cronConfig, memoryConfig: config.memory || {}, overrides: params})
    if (!plan.ok) {
        logger.error(`sleep-time 整理未执行：${plan.reason}`)
        return {skipped: 'invalid-plan', reason: plan.reason}
    }
    /** 注入优先、缺失才补真依赖——补真依赖会动态载入 dac 链（连 mongodb），全套注入时根本不发生 */
    let deps = params.deps
    if (!deps || REQUIRED_DEPS.some(k => !(k in deps))) {
        deps = {...await realDeps(), ...(deps || {})}
    }
    const lockKey = 'lock:sleepTimeConsolidate'
    const lockTtl = Number(params.lockTtlSeconds ?? cronConfig.sleepTimeLockTtlSeconds ?? 50 * 60)
    const got = params.force ? true : await deps.acquireOnce(lockKey, lockTtl)
    if (!got) {
        logger.info('sleep-time 整理锁占用中，跳过本次触发')
        return {skipped: 'lock-held'}
    }
    const now = params.now ?? Date.now()
    try {
        const allNs = await deps.namespaceDac.getTop(plan.maxNamespaces, {}, {lastActiveAt: 1}) || []
        /** 静默窗口：刚有读写活动的 namespace 不碰——整理不与在线采集抢同一命名空间的稳定态 */
        const idleNs = allNs.filter((n) => n?.userCode && n?.channel
            && Number.isFinite(new Date(n.lastActiveAt).getTime())
            && now - new Date(n.lastActiveAt).getTime() >= plan.idleMs)
        const perNs = []
        const failures = []
        for (const n of idleNs) {
            try {
                perNs.push(await consolidateNamespace({
                    ns: {userCode: n.userCode, channel: n.channel, workspaceId: n.workspaceId || null},
                    plan, now, deps,
                }))
            } catch (e) {
                /** 一个 namespace 失败不带走整轮（毒数据 ns 不该饿死其它 ns 的窗口） */
                logger.error(`sleep-time 整理单 ns 失败(${n.userCode}/${n.channel}): ${e.message}`)
                failures.push({ns: `${n.userCode}/${n.channel}`, error: e.message})
            }
        }
        const totals = perNs.reduce((t, r) => ({
            mergesPlanned: t.mergesPlanned + r.mergesPlanned,
            mergesApplied: t.mergesApplied + r.mergesApplied,
            distillCandidates: t.distillCandidates + r.distillCandidates,
            distillsInserted: t.distillsInserted + r.distillsInserted,
            episodesMarked: t.episodesMarked + r.episodesMarked,
        }), {mergesPlanned: 0, mergesApplied: 0, distillCandidates: 0, distillsInserted: 0, episodesMarked: 0})
        logger.info(`sleepTimeConsolidate ${plan.dryRun ? '计划' : '执行'}: ns(候选/静默达标)=${allNs.length}/${idleNs.length}, `
            + `合并=${plan.dryRun ? totals.mergesPlanned : totals.mergesApplied}, 提炼候选=${totals.distillCandidates}, `
            + `提炼入库=${totals.distillsInserted}, 消费标记=${totals.episodesMarked}, 失败ns=${failures.length}`)
        return {dryRun: plan.dryRun, namespacesScanned: allNs.length, namespacesIdle: idleNs.length, perNs, failures, totals, lock: 'acquired'}
    } finally {
        try {
            await deps.releaseLock(lockKey)
        } catch (e) {
            logger.warn(`sleep-time 整理锁释放失败(${e.message})，依赖 TTL 自动过期`)
        }
    }
}

/** 白名单常量再导出：执行壳与判据层对账用（用例断言这里没有 hard-delete） */
export {CONSOLIDATION_ACTIONS}

export default {sleepTimeRunPlan, consolidateNamespace, runSleepTimeConsolidate, toJudgeAtoms}
