/**
 * @fileOverview fan-out root 完成后的编排收尾 handler（PR-任务编排 C/M4 步骤 A，薄 IO）
 * @module services/agent/handler/fanOutFinalizeTask
 * @description
 * 一棵 parallel/sequential 任务树的 children 都到终局后，由 finalize task 派发到本 handler 收尾：
 *   读 root + 各 child 的 handleRet → 纯判据 `finalizeFanOutRoot` 出"root 终态 + 派活动作" →
 *   `needSynthesis` 则真跑一次综合（**落 root 隔离会话 `root:<rootCode>`，不回填用户聊天线**——属主拍板）→
 *   把编排结果写回 root.handleRet。
 *
 * 契约全部复用已离线穷举的判据件（finalizeFanOutRoot → decideFanOutNext → fanIn/arbitration），本文件只做 IO 接线，
 * 不重算任何事实。与 `agentChat` 同为薄 IO handler：**真值验证 = dev 端到端真跑**（fanout-finalize e2e 探针），
 * 不因"能 import、node --check 过"就声称已验证。
 *
 * 红线与刻意选择：
 * - **绝不塞进 `updateParentAgentTaskWithLock` 的持锁汇聚体**（那会持锁调模型拖炸现网所有 fan-out）——
 *   本 handler 是"root 到终态后、锁外派发"的独立 task；谁在何时派发它属步骤 B（updateParent 锁外钩子）。
 * - synthesis 执行体：属主拍板"按任务特点模型自行总结、不用固定模板"，所以只给自然语言的引导
 *   （原问题 + 分节结果），不套输出格式；跑在 `root:<rootCode>` 隔离会话、memory 关（任务线不该吃聊天记忆、
 *   也不污染别处），有界超时（编排收尾不该无限占资源）。
 * - **不粉饰**：synthesis 失败/空正文如实记（`usable:false` + reason），root 终态仍由判据定，不假装综合成功。
 * - retry/replan 的"追加子任务/回炉 planner" 属 M4b（生成式 planner 未建），本 handler **如实回报 dispatch 指令**
 *   进 handleRet 并保留 root 判据态，不擅自重跑（半接线的"自己重试自己"比不接更糟）。
 */
import BaseHandler from './base.js'
import { execChat } from '../../core/llmChat.js'
import agentTaskDac from '../../../daos/core/dac/agentTaskDac.js'
import messageDac from '../../../daos/core/dac/messageDac.js'
import {getTreeUsage} from '../../core/usageStats.js'
import { updateAgentTaskWithLock, insertSubAgentTask, addAgentTask } from '../../core/agentTask.js'
import { finalizeFanOutRoot, buildSynthesisQuery } from '../fanOutFinalize.js'
import { emitTaskEvents } from '../taskEventEmit.js'
import { budgetDegradedWorthy } from '../../core/session/taskBudget.js'

const tools = llm.tools
const logger = llm.logger

const DEFAULT_SYNTHESIS_TIMEOUT_MS = 5 * 60 * 1000

class FanOutFinalizeTask extends BaseHandler {
    constructor() {
        super('local')
    }

    async exec(agentTaskInfo) {
        const p = agentTaskInfo.params || {}
        const rootCode = p.rootCode
        if (!rootCode) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'finalize 缺少 rootCode', subsequentMode: '', subsequents: [] }
        }
        const root = await agentTaskDac.getByCode(rootCode)
        if (!root) {
            return { handleStatus: -1, handleRet: null, errorMsg: `finalize 找不到 root: ${rootCode}`, subsequentMode: '', subsequents: [] }
        }
        // children 从 root.subAgents 回查。**带 params**——追活的轮次标记(planRound/followRound/retryOf)住在里面，
        // activeAttempts 判"每槽最新一次尝试"全靠它；漏了 params，superseded 语义就瞎了。
        const readAllChildren = async () => {
            const fresh = await agentTaskDac.getByCode(rootCode)
            const rows = []
            for (const s of (fresh?.subAgents || [])) {
                const child = await agentTaskDac.getByCode(s.agentCode)
                if (child) {
                    // 字段必须带齐给 buildRetrySpecs 复制用——e2e 实测漏 handler 时，retry 行拿到
                    // handler=undefined，getAgentHandler 在 try 外抛、被 allSettled 吞，行永驻 0、裁决瞎掉 pending。
                    rows.push({
                        agentCode: child.agentCode, title: child.title,
                        handleStatus: child.handleStatus, handleRet: child.handleRet, params: child.params,
                        handler: child.handler, agentType: child.agentType,
                        errorMode: child.errorMode, toParentOutputKey: child.toParentOutputKey,
                    })
                }
            }
            return rows
        }
        /**
         * §5-4 树真实花费 = **按 rootCode 查账**（llmUsage 关联列的查询面，与 detail.usage 树账同源同值）。
         * 口径修正记录：第一版是 Σ children 行——写回值与 detail 树账差一条 synthesis，
         * "树累计"两个数字不同名同义会分叉（排查刀）。rootCode 账天然含全部尝试（superseded）
         * 与 synthesis；预算闸时点在 synthesis 之前 ⇒ 当时读到的就是 children 账，语义不劣化。
         */
        const treeTokensUsed = async () => {
            try {
                return (await getTreeUsage(rootCode)).tokens
            } catch { /* 账本读失败按 0 计：预算闸宁可少拦不误拦，但缺席不许编数 */ return 0 }
        }
        const originalQuery = p.originalQuery || root.title || ''
        const orchCfg = llm.config.agentTask?.fanOutOrchestration || {}
        const { runFollowLoop, rollupAllAttemptCredits, mergeCancelAware } = await import('../fanOutFollow.js')
        const { budgetAllowsFollow } = await import('../../core/session/taskAccounting.js')
        const { execAgentTask } = await import('../index.js') // 动态：handler←index 静态互引会成环
        /** 追活循环：autoFollow 关（默认）⇒ 循环立即 stop，行为与步骤 A/B1 落库时逐字一致 */
        const { fin, all, follow } = await runFollowLoop({
            readAllChildren,
            // 每轮追活前问一次"用户是否已取消"（§5-2：cancel 端点在 root.handleRet.orchestration 落标）
            isCancelled: async () => {
                const fresh = await agentTaskDac.getByCode(rootCode)
                return fresh?.handleRet?.orchestration?.cancelled === true
            },
            // §5-4 追活预算闸：现场按 rootCode 现算已花费（与树账同一查询面），判定转调 taskBudget 单源阈值。
            // §7-3 预算运行时化：ceiling/est/ratio 从 fanOutPlanner cfg 透传（不配=单源缺省，现网行为不变）
            budgetGate: async ({planned}) => budgetAllowsFollow({
                tokensUsed: await treeTokensUsed(),
                planned,
                rootTokenCeiling: (llm.config.agentTask?.fanOutPlanner || {}).rootTokenCeiling,
                perSubtaskTokenEstimate: (llm.config.agentTask?.fanOutPlanner || {}).perSubtaskTokenEstimate,
                degradeRatio: (llm.config.agentTask?.fanOutPlanner || {}).degradeRatio,
            }),
            computeFin: (active, counts) => finalizeFanOutRoot({
                children: active, retryCount: counts.retryCount, replanCount: counts.replanCount, originalQuery,
            }),
            spawnRetrySpecs: async (specs) => {
                const inserted = await insertSubAgentTask(rootCode, specs)
                await Promise.allSettled(inserted.map((t) => execAgentTask(t)))
            },
            replanSubtasks: async ({ query }) => {
                const { planFanOutSubtasks } = await import('../fanOutPlannerService.js')
                // §7-3 replan 路径预算运行时化：现场树账喂 rootTokensUsed + cfg 预算参数透传。
                // 此前 replan 只吃 subtaskCeiling，预算判定从未参与追活——"缩小/改路径/降级单智能体"
                // 的阶梯在运行时空转。留痕由循环体自己做（follow.budgetNote），这里只喂数。
                const plannerCfg = llm.config.agentTask?.fanOutPlanner || {}
                return planFanOutSubtasks({
                    query,
                    rootTokensUsed: await treeTokensUsed(),
                    rootTokenCeiling: plannerCfg.rootTokenCeiling,
                    perSubtaskTokenEstimate: plannerCfg.perSubtaskTokenEstimate,
                    degradeRatio: plannerCfg.degradeRatio,
                })
            },
            spawnReplanSpecs: async (specs) => {
                const inserted = await insertSubAgentTask(rootCode, specs)
                await Promise.allSettled(inserted.map((t) => execAgentTask(t)))
            },
            // §8 层推进 spawn：与 retry/replan 同通道（insertSubAgentTask+本进程并行执行），
            // 层行的 planRound/layerIndex 由 buildLayerSpecs 盖好——没有新调度器。
            spawnLayerSpecs: async (specs) => {
                const inserted = await insertSubAgentTask(rootCode, specs)
                await Promise.allSettled(inserted.map((t) => execAgentTask(t)))
            },
            // §8/B1 恢复判据的写侧：每层消费即把"剩余层"写回 root.params.orchPlan——
            // 崩在中途时恢复扫描（buildOrchFinalizePendingFilter）看到的才是真未消费队列。
            // dac.update 直写（不走 updateAgentTaskWithLock 的汇聚语义；finalize 执行期间
            // 没有并发的同 root 写者——B1 首触闸 + 补派帽，与层写同行的轻互斥）。
            onLayerSpawned: async ({remaining}) => {
                await agentTaskDac.update({'params.orchPlan': remaining}, {agentCode: rootCode})
            },
            log: logger,
            cfg: {
                autoFollow: orchCfg.autoFollow === true,
                plannerEnabled: llm.config.agentTask?.fanOutPlanner?.enabled === true,
                spawnCap: Number(orchCfg.followSpawnCap) || 8,
                originalQuery,
                retryCount: Number(root.retryCount) || 0,
                replanCount: Number(root.replanCount) || 0,
                // §8 分层队列：**layered 关⇒强制空**（库里存着旧 orchPlan 也忽略——回滚语义逐字现网）
                orchPlan: orchCfg.layered === true && Array.isArray(root.params?.orchPlan) ? root.params.orchPlan : [],
                planRound: 0,
            },
        })
        // §7-3 预算降级事件：追活闸停（budgetStop）与 replan 预算拒（budgetNote）两形态都在
        // 接线位过白名单判据再发——判"要不要发"单源 taskBudget，执行"发"在 finalize（循环体零事件 import）。
        // 事件面关 ⇒ emitTaskEvents 内部 no-op；审计字段随 follow 落 orchestration.follow——账不开也看得见降级话。
        const budgetDeg = follow.budgetStop
            ? { degrade: String(follow.budgetStop.degrade || 'single-agent'), reason: String(follow.budgetStop.reason || ''), allowedSubtasks: Number(follow.budgetStop.allowedSubtasks) || 0 }
            : follow.budgetNote
        if (budgetDeg && budgetDegradedWorthy(budgetDeg)) {
            await emitTaskEvents({ rootCode, events: [{ type: 'budget_degraded', payload: { rootCode, ...budgetDeg } }] })
            follow.budgetDegraded = budgetDeg
        }
        // §5-2 写回前的取消感知：cancel 若在循环/综合落笔前已置标 ⇒ 跳过 synthesis（不再花模型钱），
        // 收尾改写为 cancelled 的如实 report(3)，且 cancelled 标记随写回保留、不被旧裁决覆盖。
        const freshRoot = await agentTaskDac.getByCode(rootCode)
        const finFinal = mergeCancelAware(fin, freshRoot?.handleRet?.orchestration)

        /**
         * §7-1 澄清冒泡截胡（默认关⇒passthrough 逐字现网）：判出 synthesize 不等于"可以综合"——
         * 有 child 申报了还没答的澄清，就把 root 挂在 await-input（handleStatus 回 1，非终态），
         * 问题清单进 root.params.clarifyHold（持久，detail 可见）。**不综合、不花钱、不悬内存 promise**。
         * 答复面（/clarifyAnswer）收齐后重派 child、再派 finalize 重算，回到这里时 answeredCodes
         * 已含答复过的 child ⇒ 不再为它挂起。cap 用尽 ⇒ 不挂（synthesize-degraded），note 如实。
         */
        const clarifyCfgF = llm.config.agentTask?.clarifyBubble || {}
        if (clarifyCfgF.enabled === true && finFinal.dispatch?.needSynthesis === true && finFinal.cancelled !== true) {
            const {extractClarifyRequests, decideFinalizeWithClarify} = await import('../clarifyBubble.js')
            const {activeAttempts: activeOf} = await import('../fanOutFollow.js')
            const answeredCodes = (freshRoot?.params?.clarifyAnswered || []).map((c) => String(c || '')).filter(Boolean)
            const clarifyCounts = {}
            for (const r of all) { if (r?.agentCode) clarifyCounts[r.agentCode] = Number(r.params?.clarifyRound) || 0 }
            const decided = decideFinalizeWithClarify({
                fin: finFinal,
                requests: extractClarifyRequests(activeOf(all)),
                answeredCodes, clarifyCounts,
                cap: Number(clarifyCfgF.cap) || 2,
            })
            if (decided.mode === 'await') {
                await agentTaskDac.update({
                    handleStatus: 1, // 等待答复不是终态——detail 相位靠 action 区分"在跑"与"在等人"
                    'handleRet.orchestration.action': 'await-input',
                    'handleRet.orchestration.reason': 'clarify-bubble',
                    'handleRet.orchestration.counts': finFinal.counts,
                    'handleRet.orchestration.credits': rollupAllAttemptCredits(all),
                    'handleRet.orchestration.follow': follow,
                    'params.clarifyHold': decided.hold,
                }, {agentCode: rootCode})
                logger.info(`fan-out 澄清挂起: root=${rootCode}, 待答=${decided.hold.requests.length}, 超限=${(decided.hold.capped || []).length}`)
                // M1-c：await 也是直播事件——发完 synthesizing 语义的"在等人"就收段
                // （段界 __end__=await-input：订阅者据此停 poll，答复后新段由端点开）
                await emitTaskEvents({
                    rootCode,
                    events: [{type: 'arbitration', payload: {rootCode, action: 'await-input', retryAgents: [], reason: 'clarify-bubble'}}],
                    end: 'await-input',
                })
                return {handleStatus: 2, handleRet: {awaited: true, requests: decided.hold.requests.length, capped: (decided.hold.capped || []).length}, errorMsg: '', subsequentMode: '', subsequents: []}
            }
            if (decided.mode === 'synthesize-degraded') {
                finFinal.clarifyNote = decided.note // 写回带 note：cap 用尽不是"没问题"，是"不再等"
                logger.warn(`fan-out 澄清超限仍收尾: root=${rootCode}, note=${decided.note}`)
            }
        }

        /**
         * §7-2 综合宽限窗（graceMs<=0 ⇒ 逐字现状"树完成即综合"，本刀地基）：
         * 窗口没满或用户在原会话还有动作 ⇒ **不综合**，排一条 synth-timer 等待行
         * （manual 不投 Kafka，pump 到点重算 finalize——重跑整轮 finalize 的裁决也是对的：
         * children 事实可能变了）。排行为什么幂等查"已有未到期等待行"：finalize 可能因
         * recover/重汇被再次触发，一 root 同时只许一张等待表。
         * treeDoneAt 锚：首算=现在；等待行重算用行上带的原锚（倒计时起点是**树完成**，
         * 不是"上次看它没到期"——否则每轮重算都会把自己顺延成无限等）。
         */
        const graceMs = Number(orchCfg.synthGraceMs) || 0
        if (graceMs > 0 && finFinal.dispatch?.needSynthesis === true && finFinal.cancelled !== true) {
            const {decideSynthTiming, buildSynthTimerTaskSpec, SYNTH_TIMER_ROLE} = await import('../../core/session/synthScheduling.js')
            const treeDoneAt = Number(p.treeDoneAt) || Date.now()
            let lastUserMsgAt = null
            try {
                // 活性=发起会话里"树完成之后的非空 query 行"（综合在 root: 隔离会话，串不进来）
                const act = await messageDac.getTop(1, {complexFilter: {
                    conversationCode: root.conversationCode,
                    query: {$nin: ['', null]},
                    insertTime: {$gt: new Date(treeDoneAt)},
                }}, {insertTime: -1})
                lastUserMsgAt = act?.[0]?.insertTime ? new Date(act[0].insertTime).getTime() : null
            } catch (e) {
                /** 读不到活性按"无新动作"处理（保守方向是**敢综合不是永挂**：等错不如到点交付，
                 *  账读故障留给用户下一条消息自己触发 defer） */
                logger.warn(`fanOutFinalizeTask 综合窗口活性读数失败(按无动作): root=${rootCode} ${String(e?.message || e).slice(0, 160)}`)
            }
            const timing = decideSynthTiming({
                graceMs, now: Date.now(), treeDoneAt, lastUserMsgAt,
                round: Number(p.synthRound) || 0,
                maxPostpone: Number(orchCfg.synthMaxPostpone) || 3,
            })
            if (timing.act === 'schedule') {
                // M1-c：窗未满是**段内等待**（下一段还会重算本段），只发 synthesizing 里程碑、不收段
                await emitTaskEvents({rootCode, events: [{type: 'synthesizing', payload: {rootCode}}]})
                /**
                 * 本次 finalize 跑在 timer 行上（pump 派发）⇒ **同一条就地重挂**：dueAt/round 刷新、
                 * 行返回 handleStatus 0——execAgentTask 的收尾写回就是"这条闹钟还活着"的账。
                 * 不复用的话（排新行）：泵派发时旧行仍是 0、排除自己后 others 为空会双排；
                 * 旧行随收尾变 2 又变死表（探针 G5 两轮撞的就是这条缝）。
                 * 首算（钩子的内存 fin- 任务）没有这条行可刷 ⇒ 走新排，返回 2 善终。
                 */
                if (Number(p.synthRound) > 0 && agentTaskInfo.agentRole === SYNTH_TIMER_ROLE) {
                    await agentTaskDac.update({
                        handleStatus: 0, 'params.dueAt': timing.dueAt,
                        'params.synthRound': Number(p.synthRound) + 1, updateTime: new Date(),
                    }, {agentCode: agentTaskInfo.agentCode})
                    logger.info(`编排综合挂起宽限窗(重挂同表): root=${rootCode}, reason=${timing.reason}, dueAt=${new Date(timing.dueAt).toISOString()}, round=${Number(p.synthRound) + 1}`)
                    return {handleStatus: 0, handleRet: {scheduled: true, reason: timing.reason, dueAt: timing.dueAt}, errorMsg: '', subsequentMode: '', subsequents: []}
                }
                /**
                 * 幂等查询必须**排除自己**：timer 派发场景下 finalize 就跑在等待行身上
                 * （execAgentTask 执行中不改行状态，行仍是 0）——不排除就命中自己、不排新行，
                 * 旧行随执行终了变 2 ⇒ 闹钟销毁而倒计时没接上（顺延黑洞，诊断实锤的形状）。
                 */
                const pend = await agentTaskDac.getTop(2, {complexFilter: {agentRole: SYNTH_TIMER_ROLE, handleStatus: 0, 'params.rootCode': rootCode}})
                const others = (pend || []).filter((r) => r.agentCode !== agentTaskInfo.agentCode)
                if (!others.length) {
                    const timer = buildSynthTimerTaskSpec({
                        rootCode, dueAt: timing.dueAt, treeDoneAt,
                        round: (Number(p.synthRound) || 0) + 1,
                        finParams: {originalQuery, channel: p.channel || root.params?.channel, protocol: p.protocol || 2},
                        operator: root.operator, conversationCode: root.conversationCode,
                    })
                    await addAgentTask(timer)
                }
                logger.info(`编排综合挂起宽限窗: root=${rootCode}, reason=${timing.reason}, dueAt=${new Date(timing.dueAt).toISOString()}`)
                return {handleStatus: 2, handleRet: {scheduled: true, reason: timing.reason, dueAt: timing.dueAt}, errorMsg: '', subsequentMode: '', subsequents: []}
            }
            if (timing.reason === 'postpone-exhausted') {
                finFinal.synthNote = timing.reason // 推迟到顶的如实入账（不是"没问题"，是"不再等"）
                logger.info(`编排综合推迟到顶收尾: root=${rootCode}, round=${p.synthRound}`)
            }
        }

        let synthesis = null
        if (finFinal.dispatch.needSynthesis && finFinal.synthesisInput && finFinal.cancelled !== true) {
            const conv = `root:${rootCode}`                        // 落 root 隔离会话，不回填用户聊天线（属主拍板）
            const messageCode = p.synthesisMessageCode || tools.getUUID()
            const timeoutMs = Number(p.synthesisTimeoutMs) > 0 ? Number(p.synthesisTimeoutMs) : DEFAULT_SYNTHESIS_TIMEOUT_MS
            const controller = new AbortController()
            const timer = setTimeout(() => {
                try { controller.abort(new Error('synthesis-timeout')) } catch { /* 已 abort */ }
            }, timeoutMs)
            timer.unref?.()
            synthesis = { messageCode, conversationCode: conv }
            const sT0 = Date.now()
            try {
                // 与 agentChat 同取向：无 answerRouter/runMailbox/hardSteer ⇒ 绝不挂起等人；正文靠读回归约
                await execChat({ userCode: root.operator?.userCode }, buildSynthesisQuery(finFinal.synthesisInput.originalQuery, finFinal.synthesisInput.sectionsText), conv, {
                    messageCode,
                    conversationCode: conv,
                    // §5-4 账本关联：综合行挂在 root 树下（role=synthesis），对账"这棵树花了多少"不再靠 conv 前缀反解
                    taskContext: {rootCode, agentCode: rootCode, agentRole: 'synthesis'},
                    channel: p.channel || root.params?.channel || 'xxzx_common',
                    protocol: p.protocol || 2,
                    memory: { enabled: false },
                    ...(p.execOptionsExtra || {}),
                    signal: controller.signal,
                    streamCallback: () => {},
                })
                synthesis.durMs = Date.now() - sT0
            } catch (e) {
                synthesis.error = String(e?.message || e).slice(0, 200)   // 失败如实进结果，不吞不装
            } finally {
                clearTimeout(timer)
            }
            // 读回综合档案判可用性（不靠返回值猜）
            try {
                const doc = await messageDac.getByCode(messageCode)
                synthesis.progress = doc?.progress || null
                synthesis.usable = !!(doc && String(doc.answer || '').trim().length > 0)
                if (!synthesis.usable && !synthesis.error) synthesis.note = 'empty-answer'
            } catch (e) {
                synthesis.usable = false
                synthesis.note = 'archive-read-failed'
                logger.warn(`fanOutFinalizeTask 读回综合档案失败 messageCode=${messageCode}: ${String(e?.message || e).slice(0, 160)}`)
            }
        }

        // 编排结果写回 root。**两个口径分列各自注释**：
        // - counts = active 集（每槽最新尝试）——"树现在的成绩"，retry 成功不该被旧失败遮蔽；
        // - credits = 全量尝试（含 superseded 的失败）——"树真实花掉的钱"，失败的 token 也是钱（M6 验收④反面就是这里）；
        //   missing 列如实带（确定性失败的 child 常没有用量行——缺席标注，不补 0）。
        const handleRet = {
            orchestration: {
                action: finFinal.action, reason: finFinal.reason, settled: finFinal.settled,
                counts: finFinal.counts, credits: rollupAllAttemptCredits(all),
                budgetTokensUsed: await treeTokensUsed(), // §5-4：树真实 token（rootCode 查账，与 detail.usage 树账同源同值；排查刀统一口径）
                dispatch: finFinal.dispatch,
                sections: finFinal.synthesisInput?.sections || [],
                ...(finFinal.cancelled === true ? {cancelled: true} : {}), // 用户意志随写回保留，不被旧裁决覆盖
                ...(finFinal.clarifyNote ? {clarifyNote: finFinal.clarifyNote} : {}), // §7-1：cap 用尽的如实标注（不是"没问题"）
                ...(finFinal.synthNote ? {synthNote: finFinal.synthNote} : {}), // §7-2：推迟到顶的如实标注
                follow,
            },
            synthesis,
        }
        await updateAgentTaskWithLock(rootCode, {
            handleStatus: finFinal.handleStatus, handleRet,
            retryCount: follow.retryCount, replanCount: follow.replanCount,
            budgetUsedTokens: handleRet.orchestration.budgetTokensUsed, // 列已声明；对账=与 orchestration.budgetTokensUsed 同值同源
            // §8/B1 恢复锚：终局即清 orchPlan——"非空"永远等于"finalize 没成功写过"（扫描判据前提）。
            // 计划历史不丢：spawnedLayers/skippedLayers/pendingAfter 都在 orchestration.follow 账里。
            'params.orchPlan': [],
        })

        /**
         * M1-c 直播段尾：裁决事实进 root 事件账后**收段**（__end__=本段 finalize 的终局）。
         * 计数逐字取自账本（counts 是 reduceFanIn 的单源读数），不在这重算；
         * report/failed 段也发——直播的"结局"必须与 detail 面同一句话，只是晚一帧。
         * 段界之后若再有 finalize（clarifyAnswer 重派/grace 泵），那是下一段的新账。
         */
        await emitTaskEvents({
            rootCode,
            events: [{
                type: 'arbitration',
                payload: {rootCode, action: finFinal.action, retryAgents: finFinal.dispatch?.retryAgents || [], reason: finFinal.reason},
            }],
            end: finFinal.action,
        })

        return { handleStatus: finFinal.handleStatus, handleRet, errorMsg: '', subsequentMode: '', subsequents: [] }
    }
}

export default FanOutFinalizeTask
