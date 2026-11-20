/**
 * @fileOverview 追活（follow-up）判据：retry/replan 的轮次语义与预算步进（PR-任务编排 (f)，纯函数）
 * @module services/agent/fanOutFollow
 * @description
 * finalize 判出 `retry/replan` 后，"接下来 spawn 什么、算第几轮、预算还剩几步、拿不到 planner 怎么降级"
 * 全在这件里算清；fanOutFinalizeTask 只执行这里的决定。**轮次语义**是这刀的全部风险面：
 *
 * - 每次重试是**新行**（新 agentCode，`params.retryOf=槽位`，`followRound+1`），不是把 -1 行改回 0——
 *   终态行是事实，改写历史 = "aborted 绝不记完成"的镜像禁令。
 * - **计数看 active（每槽最新一次尝试），花钱看 all（含被取代的失败尝试）**：
 *   旧失败若留在计数里，retry 成功后 `arbitrate` 仍见 -1 → 永远 synthesize 不了（重试白跑）；
 *   而失败尝试真烧了 token，rollup 里装作没有 = 对账造假（M6 验收④的反面）。两个口径各归各处，注释点名。
 * - **replan 整体换代**（`planRound+1` 的新槽位集）：replan 的前提是"全失败"，旧代没有保留价值，
 *   active 只看最新一代；旧代进花钱账。
 * - 预算**不在这重造**：retryCount/replanCount 是喂给 `arbitrate` 的入参，上限语义在它（2/1）；
 *   这里只加**执行侧保险**（总 spawn 帽 + "replan 无 planner 可问 ⇒ 降级 report"），
 *   保险不许吞掉 arbitrate 的裁决——`degrade` 只发生在"裁决要 replan 但环境给不出计划"一种情况。
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
const round = (v) => Number(v) || 0

/** 从 DB child 行抽出"规格"（追活新行只带执行所需，身份/历史字段交下游 format 重新生成） */
function toSpec(child, over = {}) {
    const p = child.params || {}
    return {
        title: p.title || child.title || '',
        agentType: child.agentType || 'local',
        handler: child.handler,
        errorMode: child.errorMode || 'break',
        toParentOutputKey: child.toParentOutputKey,
        params: { ...p, ...over.params },
        ...over.top,
    }
}

/** 最新一代 planRound */
export function latestPlanRound(children = []) {
    return (children || []).reduce((m, c) => Math.max(m, round(c?.params?.planRound)), 0)
}

/** 每槽（retryOf||agentCode）取最新 followRound ⇒ **active 集**（计数/裁决用它） */
export function activeAttempts(children = []) {
    const gen = latestPlanRound(children)
    const bySlot = new Map()
    for (const c of (children || [])) {
        if (!c || round(c.params?.planRound) !== gen) continue
        const slot = c.params?.retryOf || c.agentCode
        const cur = bySlot.get(slot)
        if (!cur || round(c.params?.followRound) > round(cur.params?.followRound)) bySlot.set(slot, c)
    }
    return [...bySlot.values()]
}

/** 被取代的尝试（含旧代与旧轮次）——**花钱账**用全集，这里是差集（follow 日志/对账可见性） */
export function supersededAttempts(children = []) {
    const active = new Set(activeAttempts(children).map((c) => c.agentCode))
    return (children || []).filter((c) => c && !active.has(c.agentCode))
}

/**
 * retry 规格：对 arbitrate 给出的每个待重跑槽位，复制其**最新一次尝试**的执行形状，
 * 打 retryOf/followRound 标记；参数原样（handler 失败原因多半在参数/环境，保留现场才能复现）。
 * @returns {Array} 可直接喂 `insertSubAgentTask` 的 specs（不含 agentCode，交 format 生成）
 */
export function buildRetrySpecs({ children, retryAgents = [], titleSuffix = '重试' } = {}) {
    const active = activeAttempts(children)
    const slots = new Set(retryAgents.filter(Boolean))
    if (!slots.size) return []
    // 匹配两种给出法：直接点名这行本身（agentCode）或点名它所在槽（retryOf）——
    // arbitrate 给的是"最新失败行"的 agentCode，而槽键=retryOf||agentCode；只按槽匹配会让第 2 轮起
    // 的 retry 永远空手（e2e 第二轮实测：第 1 轮侥幸、第 2 轮 empty）。
    return active
        .filter((c) => slots.has(c.agentCode) || slots.has(c.params?.retryOf || c.agentCode))
        .map((c) => {
            const slot = c.params?.retryOf || c.agentCode
            const next = round(c.params?.followRound) + 1
            const spec = toSpec(c, {
                params: { retryOf: slot, planRound: round(c.params?.planRound), followRound: next },
            })
            spec.title = `${(spec.title || c.agentCode)}(${titleSuffix}${next})`
            return spec
        })
}

/** replan 规格：新一代（`planRound` 由调用方用 `nextPlanRound(children)` 按现场算）全新槽位；
 *  subtasks 来自 planner 归一产物（形状已是 buildRootTask 兼容形） */
export function buildReplanSpecs({ subtasks = [], planRound = 1 } = {}) {
    const gen = Math.max(1, round(planRound))
    return (subtasks || []).filter((s) => s && (s.query || s.params?.query)).map((s) => ({
        title: s.title,
        agentType: s.agentType || 'local',
        handler: s.handler || 'agentChat',
        errorMode: s.errorMode || 'break',
        toParentOutputKey: s.toParentOutputKey,
        params: { ...(s.params || {}), query: s.query || s.params?.query, planRound: gen, followRound: 0 },
    }))
}

/** replan 的新代号 = 现有最大 planRound + 1（独立出来免得 buildReplanSpecs 拿不到现场） */
export function nextPlanRound(children = []) {
    return latestPlanRound(children) + 1
}

/**
 * 一步决策：给定 arbitrate 的 action 与现场计数，要不要继续 spawn、做什么、计数怎么进。
 * @returns {{act:'stop'|'spawnRetry'|'spawnReplan', reason:String, counts:{retryCount,replanCount}, degrade:(String|null)}}
 */
export function planFollowStep({
    action, retryCount = 0, replanCount = 0,
    autoFollow = false, plannerEnabled = false, spawned = 0, spawnCap = 8, cancelled = false,
} = {}) {
    const counts = { retryCount: num(retryCount), replanCount: num(replanCount) }
    // 用户取消优先于一切追活意图：人已喊停，预算再充裕也不许再 spawn
    if (cancelled === true) return { act: 'stop', reason: 'cancelled-by-user', counts, degrade: 'cancelled-by-user' }
    if (autoFollow !== true) return { act: 'stop', reason: 'auto-follow-off', counts, degrade: null }
    if (action === 'synthesize' || action === 'report') return { act: 'stop', reason: `terminal:${action}`, counts, degrade: null }
    if (action === 'pending') {
        // 现场还有未终局的子行。finalize 只在 root 首次到终态时派发，正常走不到这；走到说明有外部
        // 慢子行。绝不把 root 改写回 1（orchestration 已落，B1 的 alreadyFinalized 不会二次触发——root
        // 会永久悬在 1）。降级 report(3)：如实说"finalize 时仍有在途子行"，把裁决原文留在 reason 里。
        return { act: 'stop', reason: 'not-settled-at-finalize', counts, degrade: 'not-settled' }
    }
    if (num(spawned) >= num(spawnCap)) {
        // 保险触发：不再 spawn。仲裁若还想要活，如实标 degrade（root 别停在"进行中"的悬空语义上）
        return { act: 'stop', reason: 'spawn-cap', counts, degrade: action === 'retry' ? 'retry-cap' : 'replan-cap' }
    }
    if (action === 'retry') return { act: 'spawnRetry', reason: 'arbitrate-retry', counts: { ...counts, retryCount: counts.retryCount + 1 }, degrade: null }
    if (action === 'replan') {
        if (plannerEnabled !== true) {
            // 裁决要换方案，但环境没配 planner ⇒ 给不出新计划。降级成 report（带原 dispatch），
            // 绝不把 root 悬在 1"等一个不会来的 replan"——那比如实报败更坏。
            return { act: 'stop', reason: 'replan-unavailable', counts, degrade: 'replan-no-planner' }
        }
        return { act: 'spawnReplan', reason: 'arbitrate-replan', counts: { ...counts, replanCount: counts.replanCount + 1 }, degrade: null }
    }
    return { act: 'stop', reason: `unknown-action:${action || '-'}`, counts, degrade: 'unknown-action' }
}

/** 降级 report 的 fin 形状（保留原 action/dispatch 供审计，root 落 3=完成含错） */
export function degradeFollowToReport(fin, reason) {
    return {
        ...fin,
        action: 'report',
        reason: `${reason}(原裁决:${fin.action}/${fin.reason})`,
        handleStatus: 3,
        terminal: true,
    }
}

/** replan 给 planner 的追加提示：只带"换代重拆"的事实，不替 planner 决定怎么拆 */
export function buildReplanQuery(originalQuery, fin) {
    return `上一版任务计划执行失败（${(fin && fin.reason) || '全部子任务失败'}）。\n`
        + '请换一条拆解路径或收窄范围，重新给出可独立执行的子任务（不要重复上一版原样）。\n'
        + `原始请求：${originalQuery || ''}`
}

/** 全尝试花钱账（含 superseded）：credits 逐子从 handleRet 搬（同源 M6），缺席如实 missing 不补 0 */
export function rollupAllAttemptCredits(children = []) {
    const list = (children || []).filter(Boolean)
    let total = 0
    let priced = list.length > 0
    const counted = []
    const missing = []
    for (const c of list) {
        const hr = c.handleRet || {}
        if (typeof hr.credits === 'number') {
            total += hr.credits
            if (hr.creditsPriced === false) priced = false
            counted.push(c.agentCode)
        } else {
            missing.push(c.agentCode)
        }
    }
    return {
        totalCredits: Math.round(total * 1e6) / 1e6,
        priced: list.length > 0 && priced,
        count: counted.length,
        counted, missing,
    }
}

/**
 * @description 追活循环（deps 注入 ⇒ 与 recoverCandidate 同法：派活分支能被测试**真跑**，不靠读文本）
 * @param {Object} p
 * @param {Function} p.readAllChildren 现场重读全部尝试行 () => Promise<rows>
 * @param {Function} p.spawnRetrySpecs 插入并执行 retry 代 (specs) => Promise<void>
 * @param {Function} p.replanSubtasks 问 planner 拿新一代 subtasks () => Promise<{needFanOut,subtasks,reason}>
 * @param {Function} p.spawnReplanSpecs 插入并执行 replan 代 (specs) => Promise<void>
 * @param {Function} p.computeFin (activeChildren, counts) => fin（真实现=finalizeFanOutRoot）
 * @param {Object} p.cfg {autoFollow, plannerEnabled, spawnCap, originalQuery, retryCount, replanCount}
 * @param {Object} p.log logger
 * @returns {Promise<{fin:Object, all:Array, follow:Object}>}
 */
export async function runFollowLoop(p = {}) {
    const { readAllChildren, spawnRetrySpecs, replanSubtasks, spawnReplanSpecs, computeFin, log = console } = p
    const cfg = p.cfg || {}
    const follow = {
        attempted: cfg.autoFollow === true, retryCount: 0, replanCount: 0,
        spawned: 0, superseded: [], degrade: null, stopReason: 'auto-follow-off',
        budgetNote: null, // §7-3 replan 预算拒的话术留痕（budgetStop 是闸停形态，两者都归接线方裁决发射）
    }
    let counts = { retryCount: num(cfg.retryCount), replanCount: num(cfg.replanCount) }
    let all = await readAllChildren()
    let fin = computeFin(activeAttempts(all), counts)
    if (cfg.autoFollow !== true) {
        return { fin, all, follow: { ...follow, superseded: markSuperseded(all) } }
    }

    // 循环上界由 planFollowStep 的 spawnCap 保证（裁决预算 2+1 本身有界，cap 是保险不是主闸）；
    // 每轮**重新读现场**——不缓存上轮结果，防止"我以为它还在跑"的过期视图参与裁决。
    for (let guard = 0; guard < 32; guard++) {
        // 每轮先问"用户是否已取消"（isCancelled 由接线方读 root.orchestration.cancelled）：
        // 喊停之后，本循环不再 spawn，且把 fin 改写成 cancelled 的如实 report。
        const cancelled = p.isCancelled ? await p.isCancelled() : false
        const step = planFollowStep({
            action: fin.action, retryCount: counts.retryCount, replanCount: counts.replanCount,
            autoFollow: true, plannerEnabled: cfg.plannerEnabled === true,
            spawned: follow.spawned, spawnCap: cfg.spawnCap || 8, cancelled,
        })
        follow.stopReason = step.reason
        if (step.act === 'stop') {
            if (step.degrade) {
                fin = degradeFollowToReport(fin, step.degrade)
                follow.degrade = step.degrade
            }
            break
        }
        let specs = []
        try {
            if (step.act === 'spawnRetry') {
                specs = buildRetrySpecs({ children: all, retryAgents: fin.dispatch.retryAgents })
            } else {
                const planned = await replanSubtasks({ query: buildReplanQuery(cfg.originalQuery, fin) })
                if (planned && planned.needFanOut) {
                    specs = buildReplanSpecs({ subtasks: planned.subtasks, planRound: nextPlanRound(all) })
                } else if (planned && String(planned.reason || '').startsWith('budget:')) {
                    // §7-3：replan 被预算闸拒（budget:* 话术）⇒ 留痕给接线方发降级事件。
                    // 循环不发事件也不 import 事件件——**判"要不要发"在 taskBudget 白名单，
                    // 执行"发"在 finalize 接线位**（副作用不进循环体是本仓一贯纪律）。
                    follow.budgetNote = { degrade: 'single-agent', reason: String(planned.reason), allowedSubtasks: 0 }
                }
            }
        } catch (e) {
            // 规格构造失败(裁决/解析层):降级 report 是设计内退路,但要 error 级 + 原因入 follow 审计
            log.error(`fan-out 追活规格构造失败(降级 report): ${String(e?.message || e).slice(0, 300)}`)
            follow.error = String(e?.message || e).slice(0, 200)
        }
        if (!specs.length) {
            // 要追但拿不出可执行的规格（槽位找不到 / planner 给不出新方案）⇒ 如实降级，绝不空转
            fin = degradeFollowToReport(fin, `${step.act}-empty`)
            follow.degrade = `${step.act}-empty`
            follow.stopReason = follow.degrade
            break
        }
        // §5-4 追活预算闸（budgetGate 由接线方给，内部转调 taskBudget——阈值单源不在这里）：
        // 本轮要 spawn 的行数在剩余预算下开不动 ⇒ 停止追活并按已有事实收尾，绝不"预算裸奔式"重试。
        if (p.budgetGate) {
            const gate = await p.budgetGate({planned: specs.length})
            if (gate && gate.allow === false) {
                follow.budgetStop = {planned: specs.length, degrade: gate.degrade, reason: gate.reason}
                fin = degradeFollowToReport(fin, `budget-exhausted(${gate.reason})`)
                follow.degrade = 'budget-exhausted'
                follow.stopReason = follow.degrade
                break
            }
        }
        try {
            await (step.act === 'spawnRetry' ? spawnRetrySpecs(specs) : spawnReplanSpecs(specs))
        } catch (e) {
            // spawn/执行的 IO 异常也不能让 finalize 空手而归:降级 report 把失败落进 root(审计带原因)。
            // (e2e 实测教训:这一行曾在 try 外,一次依赖缺失让 root 无 orchestration、探针只能猜)
            log.error(`fan-out 追活 spawn 失败(降级 report): ${String(e?.stack || e?.message || e).slice(0, 400)}`)
            follow.error = String(e?.message || e).slice(0, 200)
            fin = degradeFollowToReport(fin, `${step.act}-spawn-failed`)
            follow.degrade = `${step.act}-spawn-failed`
            follow.stopReason = follow.degrade
            break
        }
        follow.spawned += specs.length
        counts = step.counts
        follow.retryCount = counts.retryCount
        follow.replanCount = counts.replanCount
        all = await readAllChildren()
        fin = computeFin(activeAttempts(all), counts)
    }
    follow.superseded = markSuperseded(all)
    return { fin, all, follow }
}

/**
 * @description 写回取消感知：cancel 端点先落了 `orchestration.cancelled` 时，finalize 的收尾**不得**
 * 拿旧裁决把用户意志覆盖掉（竞态窗很小，但"覆盖了取消标记"= 取消按钮偶发失灵，正是最难复现的那类）。
 * @param {Object} fin finalize 结论
 * @param {Object} [freshOrch] 写回前重读的 root.handleRet.orchestration
 * @returns {Object} 若已取消 ⇒ 改写为 cancelled 的如实 report(3)，否则原样
 */
export function mergeCancelAware(fin, freshOrch) {
    if (!freshOrch || freshOrch.cancelled !== true) return fin
    return {
        ...fin,
        action: 'report',
        reason: `cancelled-by-user(原裁决:${fin.action}/${fin.reason})`,
        handleStatus: 3,
        terminal: true,
        cancelled: true,
    }
}

function markSuperseded(all) {
    return supersededAttempts(all).map((c) => ({
        agentCode: c.agentCode, slot: c.params?.retryOf || c.agentCode,
        planRound: round(c.params?.planRound), followRound: round(c.params?.followRound),
        handleStatus: c.handleStatus,
    }))
}

export default {
    latestPlanRound, activeAttempts, supersededAttempts,
    buildRetrySpecs, buildReplanSpecs, nextPlanRound, buildReplanQuery,
    planFollowStep, degradeFollowToReport, rollupAllAttemptCredits, runFollowLoop, mergeCancelAware,
}
