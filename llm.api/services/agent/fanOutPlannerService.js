/**
 * @fileOverview 生成式扇出 planner 服务（PR-任务编排 M4b c1b；IO 壳，判据全转调）
 * @module services/agent/fanOutPlannerService
 * @description
 * `planFanOutFromRequest` = 把"一句用户请求"变成"一个已入库的编排 root（或不扇出）"的最小服务：
 *   低档裸调用（无工具/无落档/非流式，快超时）→ `fanOutIntake.parsePlannerOutput`（语义严判，解析失败=不扇）
 *   → `fanOutPlanner.normalizeFanOutPlan`（预算/上限裁剪，不重造阈值）→ `taskQueueComposer.buildRootTask`
 *   （`orchestrated:true`）→ `addAgentTask` 入库。
 *
 * 刻意的边界：
 * - **无自动入口**：本服务当前只被显式调用（e2e 探针/未来接线方）。`/stream` 上"每条消息自动判定"要付
 *   一次模型往返的时延与成本，且综合落 root 后聊天线的结果可见性依赖 M1-c/M8——都未就绪，不抢跑。
 * - **关/失败都走普通回答**：开关关、模型缺配、调用抛错、输出不可解析、预算不允——统统 `fanOut:false`，
 *   把"要不要答"的决定权交回调用方的老路（漏判无损、误判有事故的不对称，见 fanOutIntake 头注）。
 * - planner 的提示词要求 JSON 契约，但**解析器不信承诺**（needFanOut 严格布尔、子任务≥2）。
 * - `handleMode` 由调用方给：生产=queue（**前置：consumer 已部署含 agentChat/parallelDispatch/fanOutFinalizeTask
 *   的版本**，同 B1 kafka 派发的前提）；调试/e2e=manual + 本进程 execAgentTask。
 */
import { OpenAI } from 'openai'
import { parsePlannerOutput, buildSystemPrompt } from './fanOutIntake.js'
import { normalizeFanOutPlan, stampChildHandler } from './fanOutPlanner.js'
import { layerFanOutPlan, planTotals } from './fanOutPlanGraph.js'
import { checkBudget } from '../core/session/taskBudget.js'
import { buildRootTask } from '../core/session/taskQueueComposer.js'
import { addAgentTask } from '../core/agentTask.js'
import { buildIdemFilter, pickIdempotentHit, isDuplicateKeyError } from '../core/session/taskIdempotency.js'
import { emitTaskEvents } from './taskEventEmit.js'
import agentTaskDac from '../../daos/core/dac/agentTaskDac.js'

const logger = llm.logger
const config = llm.config

/** 用户请求进 planner 前的截断上限（planner 只需要任务结构，不需要把 5 万字原文再吃一遍） */
const MAX_QUERY_CHARS = 4000

/**
 * planner 提示词已迁 `fanOutIntake.buildSystemPrompt`（纯件可直测，service 挂全局 llm）——
 * §8 分层契约段只在 layered=true 注入，关时逐字现网。
 */

/**
 * @description 只跑"判定+拆解"（不发 root 不入队）——`planFanOutFromRequest` 与 finalize 的 replan 共用这台拆解机
 * @param {Object} p
 * @param {String} p.query 给 planner 的请求文本（replan 时由调用方拼上"上一代全败"的提示）
 * @param {Number} [p.subtaskCeiling] 覆盖配置上限（replan 可收窄）
 * @param {Number} [p.rootTokensUsed] §7-3 预算运行时化：该 root 已花费（首建不传=0 走缺省；replan 必须传现场树账）
 * @param {Number} [p.rootTokenCeiling] 预算天花板（缺省吃 taskBudget 单源 100 万，conf 可覆盖）
 * @param {Number} [p.perSubtaskTokenEstimate] 单子任务预估（给了才做"开了会不会爆"预检；缺省不启用）
 * @param {Number} [p.degradeRatio] 逼近天花板降级比（缺省 0.85 单源）
 * @returns {Promise<{ok:Boolean, needFanOut:Boolean, subtasks:Array, reason:String}>}
 */
export async function planFanOutSubtasks({ query, subtaskCeiling, rootTokensUsed, rootTokenCeiling, perSubtaskTokenEstimate, degradeRatio } = {}) {
    const cfg = config.agentTask?.fanOutPlanner || {}
    if (cfg.enabled !== true) return { ok: false, needFanOut: false, subtasks: [], reason: 'disabled' }
    const q = String(query || '').trim()
    if (!q) return { ok: false, needFanOut: false, subtasks: [], reason: 'no-query' }

    const llmConfig = (config.models || {})[cfg.model || 'relay_common_low']
    if (!llmConfig?.apiKey || !llmConfig?.baseURL) return { ok: false, needFanOut: false, subtasks: [], reason: 'planner-model-missing' }

    // §8 分层：契约注入与判据都吃 fanOutOrchestration.layered（关时 prompt 逐字现网、图判不跑）
    const layered = config.agentTask?.fanOutOrchestration?.layered === true

    // 1) 低档裸调用：短超时 + 少重试（planner 卡住＝拖垮交互，921s 教训在 llmChat.js:24-27 写着）
    let text = ''
    const t0 = Date.now()
    try {
        const openai = new OpenAI({
            apiKey: llmConfig.apiKey,
            baseURL: llmConfig.baseURL,
            timeout: Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 30000,
            maxRetries: Number.isFinite(Number(cfg.maxRetries)) ? Math.max(0, Number(cfg.maxRetries)) : 1,
        })
        const ret = await openai.chat.completions.create({
            model: llmConfig.model,
            messages: [
                { role: 'system', content: buildSystemPrompt({ layered }) },
                { role: 'user', content: q.slice(0, MAX_QUERY_CHARS) + (q.length > MAX_QUERY_CHARS ? '\n（原文过长，已截断）' : '') },
            ],
            max_tokens: Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : 512,
            temperature: 0.1,
            stream: false,
        })
        text = ret?.choices?.[0]?.message?.content || ''
    } catch (e) {
        logger.warn(`fan-out planner 调用失败(按不扇出处理): ${String(e?.message || e).slice(0, 200)}`)
        return { ok: false, needFanOut: false, subtasks: [], reason: 'planner-call-failed' }
    }
    logger.info(`fan-out planner 返回 ${Date.now() - t0}ms, ${text.length} 字`)

    // 2) 语义严判（解析失败/承诺不整一律不扇）
    const parsed = parsePlannerOutput(text, { maxInput: 8 })
    if (!parsed.needFanOut) {
        return { ok: parsed.ok, needFanOut: false, subtasks: [], reason: parsed.reason, plannerRaw: text.slice(0, 300) }
    }

    // 3a) §8 分层路径（layered 开且模型真声明了 deps）：图严判 ⇒ 预算吃全树总量（**不修剪图**——
    // 删上游=下游悬空错形，超限整案不扇交回普通回答）。无 deps/单层输出走 3b 旧路，逐字现网。
    if (layered && parsed.subtasks.some((s) => s.deps !== undefined)) {
        const g = layerFanOutPlan({ subtasks: parsed.subtasks })
        if (!g.ok) {
            return { ok: true, needFanOut: false, subtasks: [], reason: `graph:${g.reason}`, plannerRaw: text.slice(0, 300) }
        }
        const totals = planTotals(g.layers)
        const bud = checkBudget({
            rootTokensUsed: Number(rootTokensUsed) > 0 ? Number(rootTokensUsed) : 0,
            plannedSubtasks: totals.total,
            subtaskCeiling: subtaskCeiling ?? cfg.subtaskCeiling,
            rootTokenCeiling, perSubtaskTokenEstimate, degradeRatio,
        })
        if (!bud.ok || bud.degrade !== 'none' || bud.allowedSubtasks < totals.total) {
            return { ok: true, needFanOut: false, subtasks: [], reason: `budget:${bud.degrade === 'single-agent' ? 'single-agent' : bud.reason}`, plannerRaw: text.slice(0, 300) }
        }
        const stamped = g.layers.map((L) => stampChildHandler(L))
        const first = stamped.shift()
        return { ok: true, needFanOut: true, subtasks: first, orchPlan: stamped, reason: 'layered' }
    }

    // 3b) 预算/上限裁剪（阈值在 taskBudget，转调不重造）
    const plan = normalizeFanOutPlan({ subtasks: parsed.subtasks, subtaskCeiling: subtaskCeiling ?? cfg.subtaskCeiling })
    if (plan.mode !== 'fan-out') {
        return { ok: true, needFanOut: false, subtasks: [], reason: `budget:${plan.reason}`, plannerRaw: text.slice(0, 300) }
    }
    return { ok: true, needFanOut: true, subtasks: plan.subtasks, reason: plan.reason }
}

/**
 * @description 规划并（判定适合时）入库一个编排 root
 * @param {Object} p
 * @param {String} p.query 用户请求
 * @param {String} p.conversationCode 归属会话
 * @param {Object} [p.operator] {userCode,...}（root 归属与 finalize 执行的身份）
 * @param {Object} [p.request] 透传进 root.params 的请求上下文（channel/protocol/inputs 等）
 * @param {String} [p.handleMode] root 执行模式：'queue'（生产，consumer 前置同 B1）|'manual'（e2e/调试），缺省吃配置
 * @param {String} [p.taskCode] 幂等键（§5-1）：会话内同键只建一棵树，重复请求指回原 rootCode；不传⇒无幂等
 * @returns {Promise<Object>} `{fanOut:Boolean, reason:String, rootCode?:String, subtasks?:Array, plannerRaw?:String, duplicate?:Boolean}`
 */
export async function planFanOutFromRequest({ query, conversationCode, operator, request = {}, handleMode, taskCode } = {}) {
    const cfg = config.agentTask?.fanOutPlanner || {}
    if (cfg.enabled !== true) return { fanOut: false, reason: 'disabled' }
    if (!conversationCode) return { fanOut: false, reason: 'no-conversation' }
    const q = String(query || '').trim()
    if (!q) return { fanOut: false, reason: 'no-query' }
    // 未显式指定就吃配置的 handleMode（生产 queue / 灰度联调 manual）；给了非法值不猜、直接不扇
    const mode = handleMode || (cfg.handleMode === 'manual' ? 'manual' : 'queue')
    if (mode !== 'queue' && mode !== 'manual') return { fanOut: false, reason: 'bad-handle-mode' }

    /**
     * 幂等预查（§5-1）：**在调 planner 之前**——同键重发既省一次模型调用也保证同一 rootCode。
     * 预查只是"快路径"；并发双插的终裁在 partial-unique 索引（uniq_orchestratedRoot_idemKey），
     * 撞键后回查返回既有行（isDuplicateKeyError 分支）。
     */
    const idemKey = String(taskCode || '').trim()
    if (idemKey) {
        const hit = await findRootByKey({ conversationCode, idemKey })
        if (hit) return { fanOut: true, duplicate: true, reason: 'idempotent-hit', ...hit }
    }

    const planned = await planFanOutSubtasks({ query: q })
    if (!planned.needFanOut) {
        return { fanOut: false, reason: planned.reason, plannerOk: planned.ok, plannerRaw: planned.plannerRaw }
    }
    const plan = { subtasks: planned.subtasks, reason: planned.reason, orchPlan: planned.orchPlan || null }

    // 4) 成形入库（orchestrated:true 是 finalize 的显式声明，缺了 B1 永不触发）
    const root = buildRootTask({
        conversationCode,
        query: q,
        request,
        operator,
        agentType: 'parallel',
        handler: 'parallelDispatch',
        subtasks: plan.subtasks,
        // ⚠️ 用解析后的 mode，不是入参 handleMode：e2e 抓到过写 `{handleMode}` 把 undefined 展平进 extra
        // 盖掉 buildRootTask 的默认值、行被 schema default 落成 'queue' ⇒ addAgentTask 误投 Kafka（半部署环境里
        // 会被 dev consumer 捡去跑成"没有 finalize 的孤儿树"）。resolved 值必须真的传下去。
        extra: { handleMode: mode, orchestrated: true },
    })
    if (cfg.synthesisExecOptions) root.params = { ...root.params, synthesisExecOptions: cfg.synthesisExecOptions }
    if (idemKey) root.params = { ...root.params, idemKey } // 幂等键住 params.idemKey（索引字段），root 行永久占键
    // §8 未 spawn 的后续层落库（params Mixed 已声明面，无新列）——层推进的"计划事实"住库里，
    // 进程死在层间，recover/finalize 重派时按 root.params.orchPlan 续（与 orchestration 同源思路）。
    if (planned.orchPlan && planned.orchPlan.length) root.params = { ...root.params, orchPlan: planned.orchPlan }
    try {
        await addAgentTask(root)
    } catch (e) {
        // 并发窗口：两个同键请求都过了预查，索引只放一个 ⇒ 落败方**回查返回既有行**（不双树、不报错给用户）
        if (idemKey && isDuplicateKeyError(e)) {
            const hit = await findRootByKey({ conversationCode, idemKey })
            if (hit) return { fanOut: true, duplicate: true, reason: 'idempotent-hit-race', ...hit }
        }
        throw e
    }
    // M1-c 刀1：受理即开段——task_queued + subtask_spawned 两个里程碑进 root 事件账
    // （flag 关/redis 不可用 ⇒ emitTaskEvents 内部静默 no-op，主流程零变化）。
    // agentCode 在 addAgentTask 的 format 里生成、title 在 plan.subtasks 里——按序 zip（两处同源同序）。
    await emitTaskEvents({
        rootCode: root.agentCode,
        events: [
            { type: 'task_queued', payload: { rootCode: root.agentCode, queuePosition: 1 } },
            { type: 'subtask_spawned', payload: { rootCode: root.agentCode, subtasks: (root.subAgents || []).map((s, i) => ({ agentCode: s.agentCode, title: plan.subtasks?.[i]?.title || '' })) } },
        ],
    })
    return { fanOut: true, reason: plan.reason, rootCode: root.agentCode, subtasks: plan.subtasks, layered: !!(plan.orchPlan && plan.orchPlan.length) }
}

/**
 * @description 按幂等键找既有编排 root（含子任务清单回查——duplicate 响应与首发**形状一致**，前端不必特判）
 * @param {Object} p
 * @param {String} p.conversationCode 会话
 * @param {String} p.idemKey 幂等键
 * @returns {Promise<{rootCode:String, subtasks:Array}|null>} 命中；查无 ⇒ null
 */
async function findRootByKey({ conversationCode, idemKey }) {
    const rows = await agentTaskDac.getTop(5, buildIdemFilter({
        conversationCode, agentRole: 'root', keyField: 'idemKey', keyValue: idemKey, waitingOnly: false,
    }), { insertTime: 1 })
    const hit = pickIdempotentHit({ rows, keyField: 'idemKey', keyValue: idemKey })
    if (!hit) return null
    const subtasks = []
    for (const s of (hit.subAgents || [])) {
        const child = s.agentCode ? await agentTaskDac.getByCode(s.agentCode) : null
        if (child) subtasks.push({ title: child.title || '', query: String(child.params?.query || '') })
    }
    return { rootCode: hit.agentCode, subtasks: subtasks.length ? subtasks : null }
}

export default { planFanOutFromRequest, planFanOutSubtasks }
