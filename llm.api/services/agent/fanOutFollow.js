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
 *   这里只加**执行侧保险**（总 spawn 帽 + 环境给不出动作时的降级），
 *   保险不许吞掉 arbitrate 的裁决——`degrade` 只发生在"裁决要的动作**没有承接方**"：
 *   replan 无 planner / spawn 帽触顶 / 预算闸停 / 规格空转 / **§7-4：autoFollow 关时的 retry/replan**
 *   （finalize 只派发一次，悬 1=永久死悬，dev 实测 5 棵——降级 report 带原裁决审计）/
 *   **§8：分层计划未完时的半树 synthesize**（layered-not-advanced——半棵树综合=谎报完成，
 *   skippedLayers 如实记账；层推进本身走 spawnLayer，不是重试、不吃 retry 预算）。
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
 * §8 层推进规格：orchPlan 存量项（service 侧 stampChildHandler 已盖形状）→ spawn specs。
 * 与 buildReplanSpecs 同纪律：只带执行所需，身份交下游 format；layerIndex 进 params 做血统审计
 * （槽键=新 agentCode，active 集天然与先代分账——层间是"新槽位"不是"重试"，计数不吃 retry 预算）。
 * **deps 的真语义在这兑现：下游 query 拼上游产出**——不传产出的 deps 只是时序约束，设计稿
 * "先调研 A、再基于 A 写对比"要的是 A 的正文真进 B 的输入。id/deps 住 params（库内反查锚）。
 * upstream 读不到的 dep ⇒ 如实标注"上游未产出"（缺席不装存在，绝不静默丢依赖）。
 */
export function buildLayerSpecs(layer = [], { planRound = 0, layerIndex = 1, upstream = {}, maxUpstreamChars = 2000 } = {}) {
    return (layer || []).filter((s) => s && (s.query || s.params?.query)).map((s) => {
        const base = String(s.query || s.params?.query || '')
        const deps = Array.isArray(s.deps) ? s.deps : (Array.isArray(s.params?.deps) ? s.params.deps : [])
        let query = base
        if (deps.length) {
            const parts = deps.map((d) => {
                const u = upstream[d]
                const body = u && typeof u.content === 'string' && u.content.trim()
                    ? u.content.trim().slice(0, maxUpstreamChars)
                    : '（上游未产出，标注假设继续）'
                return `- ${d}${u && u.title ? `（${u.title}）` : ''}: ${body}`
            })
            query = base + '\n\n【上游子任务产出（按依赖注入）】\n' + parts.join('\n')
        }
        const id = s.id || s.params?.id
        return {
            title: s.title,
            agentType: s.agentType || 'local',
            handler: s.handler || 'agentChat',
            errorMode: s.errorMode || 'break',
            toParentOutputKey: s.toParentOutputKey,
            params: {
                ...(s.params || {}),
                query,
                planRound, followRound: 0, layerIndex,
                ...(id ? { id } : {}),
                ...(deps.length ? { deps } : {}),
            },
        }
    })
}

/**
 * 一步决策：给定 arbitrate 的 action 与现场计数，要不要继续 spawn、做什么、计数怎么进。
 * @param {Object} p
 * @param {Number} [p.pendingLayers] §8 分层计划剩余未 spawn 层数（0=无分层，逐字旧行为）
 * @returns {{act:'stop'|'spawnRetry'|'spawnReplan'|'spawnLayer', reason:String, counts:{retryCount,replanCount}, degrade:(String|null)}}
 */
export function planFollowStep({
    action, retryCount = 0, replanCount = 0,
    autoFollow = false, plannerEnabled = false, spawned = 0, spawnCap = 8, cancelled = false,
    pendingLayers = 0,
} = {}) {
    const counts = { retryCount: num(retryCount), replanCount: num(replanCount) }
    const moreLayers = num(pendingLayers) > 0
    // 用户取消优先于一切追活意图：人已喊停，预算再充裕也不许再 spawn
    if (cancelled === true) return { act: 'stop', reason: 'cancelled-by-user', counts, degrade: 'cancelled-by-user' }
    // §7-4 无承接方的裁决不许悬空：OFF 形态下 retry/replan 同样降级（终局收口），
    // synthesize/report 本就是终态动作、无"等待者"问题，degrade 保持 null。
    if (autoFollow !== true) {
        const willDangle = action === 'retry' || action === 'replan'
        // §8 第二形态：分层计划没走完而 autoFollow 关——停在 synthesize=拿半棵树谎报完成，
        // 同样"没有承接方"（这次没承接的是"后续层"），降级 report 如实收口。
        const halfTreeSynth = action === 'synthesize' && moreLayers
        return {
            act: 'stop', reason: 'auto-follow-off', counts,
            degrade: willDangle ? 'auto-follow-off' : (halfTreeSynth ? 'layered-not-advanced' : null),
        }
    }
    if (action === 'synthesize') {
        // §8 层推进：计划未完不许 synthesize——交循环 spawn 下一层（无新调度器，复用追活机制）；
        // 推进同样吃保险帽（spawnLayer 若成环是计划 bug，cap 是第二道闸）。
        if (moreLayers) {
            if (num(spawned) >= num(spawnCap)) return { act: 'stop', reason: 'spawn-cap', counts, degrade: 'layer-cap' }
            return { act: 'spawnLayer', reason: 'layer-advance', counts, degrade: null }
        }
        return { act: 'stop', reason: 'terminal:synthesize', counts, degrade: null }
    }
    if (action === 'report') return { act: 'stop', reason: `terminal:${action}`, counts, degrade: null }
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
    // onLayerSpawned：层 spawn 成功后的"计划已被消费"回执（接线方把剩余层写回库——
    // §8/B1 恢复判据的前提：orchPlan 非空必须真等于"没消费"，崩在 spawn 后写库前的
    // 双 spawn 微窗与 B1 direct 窗同族，如实记不假装消除）
    const { readAllChildren, spawnRetrySpecs, replanSubtasks, spawnReplanSpecs, spawnLayerSpecs, computeFin, onLayerSpawned, log = console } = p
    const cfg = p.cfg || {}
    // §8 分层计划：orchPlan=未 spawn 的后续层队列（layered 关时接线方给空数组——循环逐字旧行为）
    const layersQ = Array.isArray(cfg.orchPlan) ? cfg.orchPlan.filter((L) => Array.isArray(L) && L.length).map((L) => L.slice()) : []
    const follow = {
        attempted: cfg.autoFollow === true, retryCount: 0, replanCount: 0,
        spawned: 0, superseded: [], degrade: null, stopReason: 'auto-follow-off',
        budgetNote: null, // §7-3 replan 预算拒的话术留痕（budgetStop 是闸停形态，两者都归接线方裁决发射）
        spawnedLayers: 0, // §8 层推进审计：本次 finalize 内 spawn 过的后续层数
    }
    let counts = { retryCount: num(cfg.retryCount), replanCount: num(cfg.replanCount) }
    let all = await readAllChildren()
    let fin = computeFin(activeAttempts(all), counts)
    if (cfg.autoFollow !== true) {
        // §7-4 仲裁升级（dev 实测 5 棵 retry 树永悬 st=1 定案）：finalize 只派发一次（B1 闸），
        // OFF 形态下 retry/replan 裁决**没有任何承接方**——后开 autoFollow 也不会重跑，悬=死。
        // 与 replan-no-planner/not-settled 同一原则降级 report(3)：终局如实收口，
        // 原裁决留在 reason("原裁决:retry/…")与 dispatch.needRetry——观测方看得见"该追但没追"。
        // pending 不在此列："未终局不收尾"是另一条纪律，且 dev 实测 0 命中——没账不造刀。
        // §8 同款：分层计划没走完的 synthesize=半棵树谎报完成，没承接方（后续层没人 spawn）⇒ 降级。
        let degrade = null
        if (fin.action === 'retry' || fin.action === 'replan') {
            fin = degradeFollowToReport(fin, 'auto-follow-off')
            degrade = 'auto-follow-off'
        } else if (fin.action === 'synthesize' && layersQ.length) {
            fin = degradeFollowToReport(fin, 'layered-not-advanced')
            degrade = 'layered-not-advanced'
            follow.skippedLayers = layersQ.length
        }
        return { fin, all, follow: { ...follow, degrade, stopReason: degrade ? (degrade === 'auto-follow-off' ? 'auto-follow-off' : 'layered-not-advanced') : follow.stopReason, superseded: markSuperseded(all) } }
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
            pendingLayers: layersQ.length,
        })
        follow.stopReason = step.reason
        if (step.act === 'stop') {
            if (step.degrade) {
                fin = degradeFollowToReport(fin, step.degrade)
                follow.degrade = step.degrade
                if (layersQ.length) follow.skippedLayers = layersQ.length // §8 没走完的层如实记账
            }
            break
        }
        let specs = []
        try {
            if (step.act === 'spawnRetry') {
                specs = buildRetrySpecs({ children: all, retryAgents: fin.dispatch.retryAgents })
            } else if (step.act === 'spawnLayer') {
                // §8 层推进：pop 下一层 ⇒ spawn specs（项形状由 service 侧 stampChildHandler 单源产出，
                // layerIndex 进 params 做血统审计；槽键=新 agentCode，与 active 集天然分账）
                const layerIdx = (cfg.layerBase || 0) + follow.spawnedLayers + 1
                // 上游产出索引：库内行按 params.id 建锚（active 集优先取最新尝试——上游被 retry 过
                // 就给最新成果；usable 才有正文，"上游未产出"由 buildLayerSpecs 如实标注）
                const upstream = {}
                for (const c of activeAttempts(all)) {
                    const k = c.params?.id
                    if (!k) continue
                    const content = c.handleRet?.usable === true ? String(c.handleRet?.content || '') : ''
                    if (!upstream[k] || content) upstream[k] = { title: c.title || '', content: content || undefined }
                }
                specs = buildLayerSpecs(layersQ.shift(), { planRound: round(cfg.planRound) || 0, layerIndex: layerIdx, upstream })
                follow.pendingAfter = layersQ.length
            } else {
                const planned = await replanSubtasks({ query: buildReplanQuery(cfg.originalQuery, fin) })
                if (planned && planned.needFanOut) {
                    specs = buildReplanSpecs({ subtasks: planned.subtasks, planRound: nextPlanRound(all) })
                    // §8 换代即废弃（推理自查出的判据错，replan 前提=全败）：旧计划的残层
                    // 依赖的是**这一代已全败的上游**——新代没给承接计划时旧层更无权存活，
                    // 否则换代后突然冒出基于败局产出的层=错形执行。新代带 layers 则接管。
                    if (layersQ.length) follow.layerPlanReset = (follow.layerPlanReset || 0) + layersQ.length
                    layersQ.length = 0
                    if (Array.isArray(planned.orchPlan)) {
                        layersQ.push(...planned.orchPlan.filter((L) => Array.isArray(L) && L.length))
                    }
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
            if (layersQ.length || step.act === 'spawnLayer') {
                follow.skippedLayers = layersQ.length + (step.act === 'spawnLayer' ? 1 : 0)
            }
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
                // §8 闸停也要记跳过层：被拦的这层（layer 动作时 specs 即它的计划）+ 队列里的余层
                if (layersQ.length || step.act === 'spawnLayer') {
                    follow.skippedLayers = layersQ.length + (step.act === 'spawnLayer' ? 1 : 0)
                }
                break
            }
        }
        try {
            const act = step.act === 'spawnLayer' ? spawnLayerSpecs : (step.act === 'spawnRetry' ? spawnRetrySpecs : spawnReplanSpecs)
            await act(specs)
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
        if (step.act === 'spawnLayer') {
            follow.spawnedLayers += 1
            // 计划消费回执（接线方写库"剩余层"——恢复判据 orchPlan 非空=真没消费 的前提）
            if (typeof onLayerSpawned === 'function') {
                try { await onLayerSpawned({remaining: layersQ.slice()}) } catch (e) {
                    log.warn(`层消费回执写库失败(恢复面可能双 spawn 该层，B1 同族窗): ${String(e?.message || e).slice(0, 200)}`)
                    follow.layerAckFailed = (follow.layerAckFailed || 0) + 1
                }
            }
        }
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
    buildRetrySpecs, buildReplanSpecs, buildLayerSpecs, nextPlanRound, buildReplanQuery,
    planFollowStep, degradeFollowToReport, rollupAllAttemptCredits, runFollowLoop, mergeCancelAware,
}
