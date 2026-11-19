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
import { updateAgentTaskWithLock, insertSubAgentTask } from '../../core/agentTask.js'
import { finalizeFanOutRoot, buildSynthesisQuery } from '../fanOutFinalize.js'

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
            // §5-4 追活预算闸：现场按 rootCode 现算已花费（与树账同一查询面），判定转调 taskBudget 单源阈值
            budgetGate: async ({planned}) => budgetAllowsFollow({
                tokensUsed: await treeTokensUsed(),
                planned,
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
                return planFanOutSubtasks({ query })
            },
            spawnReplanSpecs: async (specs) => {
                const inserted = await insertSubAgentTask(rootCode, specs)
                await Promise.allSettled(inserted.map((t) => execAgentTask(t)))
            },
            log: logger,
            cfg: {
                autoFollow: orchCfg.autoFollow === true,
                plannerEnabled: llm.config.agentTask?.fanOutPlanner?.enabled === true,
                spawnCap: Number(orchCfg.followSpawnCap) || 8,
                originalQuery,
                retryCount: Number(root.retryCount) || 0,
                replanCount: Number(root.replanCount) || 0,
            },
        })
        // §5-2 写回前的取消感知：cancel 若在循环/综合落笔前已置标 ⇒ 跳过 synthesis（不再花模型钱），
        // 收尾改写为 cancelled 的如实 report(3)，且 cancelled 标记随写回保留、不被旧裁决覆盖。
        const freshRoot = await agentTaskDac.getByCode(rootCode)
        const finFinal = mergeCancelAware(fin, freshRoot?.handleRet?.orchestration)

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
                follow,
            },
            synthesis,
        }
        await updateAgentTaskWithLock(rootCode, {
            handleStatus: finFinal.handleStatus, handleRet,
            retryCount: follow.retryCount, replanCount: follow.replanCount,
            budgetUsedTokens: handleRet.orchestration.budgetTokensUsed, // 列已声明；对账=与 orchestration.budgetTokensUsed 同值同源
        })

        return { handleStatus: finFinal.handleStatus, handleRet, errorMsg: '', subsequentMode: '', subsequents: [] }
    }
}

export default FanOutFinalizeTask
