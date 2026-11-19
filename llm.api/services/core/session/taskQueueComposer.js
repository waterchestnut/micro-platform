/**
 * @fileOverview 会话→任务队列的决策组合与 root 记录组装（PR-任务编排 M1-b 前置，纯函数）
 * @module services/core/session/taskQueueComposer
 * @description
 * 把 M1-a 的判定件（`taskAdmission`/`taskBudget`/`creditMeter`）串成"这一次会话请求：立即跑还是入队、
 * 入队就产出 root agentTask 记录"，供 M1-b 的 `root.js` 队列模式分叉调用。本件**不碰热路径、不执行**——
 * 只做决策组合 + 记录成形，Kafka/DB/Streams 的副作用留给接线方。
 *
 * 两条刻意的设计约束：
 * 1. **handler 名注入**：root 的执行体（富 `agentChat`）属 M2，本件绝不硬编一个还不存在的 handler，
 *    调用方给什么用什么（缺省留空，接线方补）。避免"写了个指向不存在东西的默认值"这种假就绪。
 * 2. **判定不重造**：容量/预算/裁决一律转调 M1-a 的纯件，这里只组合，不出现第二套阈值逻辑
 *    （同一契约不写两遍）。
 *
 * root 记录形状对齐 `agentTaskSchema`：`agentType`(编排类 parallel/sequential 或原子 local)、
 * `handleMode:'queue'`（投 Kafka）、`handleStatus:0`、新维度 `conversationCode/rootCode/agentRole`。
 * `agentCode/parentCode/agentCodePath` 由下游 `formatWaitAddAgentTask` 生成，本件不越俎预填（避免两处生 id 打架）。
 */

import { decideTaskAdmission } from './taskAdmission.js'
import { checkBudget } from './taskBudget.js'

/**
 * @description 组装一条会话 root agentTask 记录（不落库、不派发）
 * @param {Object} p
 * @param {String} p.conversationCode 会话标识（必填）
 * @param {String} [p.query] 用户请求文本
 * @param {Object} [p.request] 原始 chat 请求（channel/protocol/attachments 等透传进 params）
 * @param {Object} [p.operator] 归属（userCode 等），进 operator
 * @param {String} [p.handler] root 执行体 handler 名（注入；M2 前调用方传占位或留空）
 * @param {String} [p.agentType] 'parallel'|'sequential'|'local'（默认 local 单智能体；带 subtasks 时上层应传并行/串行）
 * @param {Array} [p.subtasks] planner 产出的子任务规划 [{title,handler?,params?,deps?}...]；映射成 subAgents 骨架
 * @param {Object} [p.extra] 其它透传字段（浅合并）
 * @returns {Object} agentTask 记录（缺 agentCode，交下游 format 生成）
 */
export function buildRootTask({
    conversationCode,
    query = '',
    request = {},
    operator,
    handler = '',
    agentType = 'local',
    subtasks,
    extra = {},
} = {}) {
    if (!conversationCode) {
        throw new Error('buildRootTask 需要 conversationCode')
    }
    const type = ['parallel', 'sequential', 'local'].includes(agentType) ? agentType : 'local'
    const rec = {
        title: query ? String(query).slice(0, 60) : undefined,
        agentType: type,
        handler,
        handleMode: 'queue',
        handleStatus: 0,
        errorMode: 'break',
        conversationCode,
        // rootCode 在拿到 agentCode 后由接线方回填（self-root）；此处留空不猜 id
        agentRole: 'root',
        budgetUsedTokens: 0,
        retryCount: 0,
        operator,
        params: {
            query,
            channel: request.channel,
            protocol: request.protocol,
            attachments: request.attachments,
            ...request,
            ...(query ? { query } : {}),
        },
    }
    // planner 产出的子任务 → subAgents 骨架（子记录各自成行由 addAgentTask.format 递归展开）
    if (Array.isArray(subtasks) && subtasks.length) {
        rec.subAgents = subtasks.map((s) => ({
            title: s.title,
            handler: s.handler || handler,
            agentType: s.agentType || 'local',
            params: s.params || {},
            toParentOutputKey: s.toParentOutputKey,
            errorMode: s.errorMode || 'break',
        }))
    }
    return { ...rec, ...extra }
}

/**
 * @description 组合一次会话请求的准入/预算决策，queue 时附 root 记录
 * @param {Object} p
 * @param {Object} p.admission 透传给 decideTaskAdmission 的计数/阈值
 * @param {Object} [p.budget] 透传给 checkBudget（root 预算）；不给则不做预算门
 * @param {Object} p.build 透传给 buildRootTask
 * @returns {{action:'proceed'|'queue'|'reject', admission:Object, budget:Object|null, rootTask:Object|null, reason:String}}
 */
export function decideAndBuild({ admission = {}, budget = null, build = {} } = {}) {
    const adm = decideTaskAdmission(admission)

    // 预算门：只有准入放行(proceed)才进一步问预算；queue/reject 时预算无意义，跳过
    let bud = null
    if (adm.action === 'proceed' && budget) {
        bud = checkBudget(budget)
    }

    if (adm.action === 'reject') {
        return { action: 'reject', admission: adm, budget: null, rootTask: null, reason: adm.reason }
    }

    // queue 或（预算要降级/超支也算不立即开）→ 组 root 入队
    const budgetBlocks = bud && (bud.degrade === 'single-agent' && !bud.ok)
    if (adm.action === 'queue' || budgetBlocks) {
        const rootTask = buildRootTask(build)
        return {
            action: 'queue',
            admission: adm,
            budget: bud,
            rootTask,
            reason: adm.action === 'queue' ? adm.reason : (bud && bud.reason) || 'budget',
        }
    }

    return { action: 'proceed', admission: adm, budget: bud, rootTask: null, reason: adm.reason }
}

/**
 * @description 组装一条"用户追问轮"的排队记录（serialized-turn）——同会话串行、持久不派发
 * @param {Object} p
 * @param {String} p.conversationCode **用户自己的**会话标识（必填；§8.0：跑前文要看得到上一轮）
 * @param {String} p.messageCode 本轮的 messageCode（root.js 已生成的 `messageCodeForGate`；执行时按它落档）
 * @param {String} [p.query] 用户请求文本
 * @param {Object} [p.request] 原始 chat 请求（channel/protocol/llmModel/inputs 等，供忠实重放）
 * @param {Object} [p.operator] 归属（userCode 等）
 * @param {String} [p.handler] 执行体 handler 名（**注入，不默认**）
 * @param {Object} [p.options] 原 `request.reqParams.options`（execChat 的忠实 options，供重放时原样展开）
 * @param {Object} [p.userInfo] 原 `request.userInfo`（execChat 首参，重放时原样传回）
 * @param {Object} [p.extra] 其它透传（浅合并）
 * @returns {Object} agentTask 记录（缺 agentCode，交下游 format 生成）
 * @description
 * 与 fan-out child 的 `buildRootTask` 三点关键不同（都来自 §3.3 读 consumer/handler 后的实证）：
 * 1. `handleMode:'manual'`：`addAgentTask` 只在 `queue` 时投 Kafka（agentTask.js:123），而 consumer 无会话级串行、
 *    一到就 `execAgentTask`——若在上一轮还在跑时投 queue，就会在同一 conversationCode 上并发跑第二轮（正是要防的竞态）。
 *    `manual` 让这轮**持久化但不自动派发**，何时跑交消费侧 `decideTurnStart` + 排水器决定。
 * 2. `agentRole:'serialized-turn'`（非 root）：它是一轮用户对话，不是 fan-out 树的根；排水/事件呈现据此区分。
 * 3. `handler` 不默认：`agentChat` 硬编 `memory:off`（childTurn），忠实重放用户轮**不能**用它当默认执行体；
 *    真正的 turn-runner（与 root.js 正常轮同 options）接线前，这里留空由调用方注入，避免"看着能跑其实跑错语义"。
 *
 * ⚠️ 本件只**成形记录**，不入库、不执行、不决定何时跑。`conversationCode`/`messageCode` 缺一即抛（宁抛不猜会话身份）。
 * ⚠️ `options`/`userInfo` 是忠实重放的关键：turn-runner 要 `execChat(userInfo, query, conversationCode, {...options, messageCode,...})`，
 *    与 root.js 正常轮 root.js:425-445 同形状（仅少活连接上的控制把手）。丢了 `options` 就等于把用户轮跑成另一副语义。
 */
export function buildSerializedTurnTask({
    conversationCode, messageCode, query = '', request = {}, options, userInfo, operator, handler = '', extra = {},
} = {}) {
    if (!conversationCode) throw new Error('buildSerializedTurnTask 需要 conversationCode')
    if (!messageCode) throw new Error('buildSerializedTurnTask 需要 messageCode（本轮 messageCode）')
    // 以 request 为底（channel/protocol/inputs 等多半在里面），再盖本轮身份与忠实重放所需的原样字段
    const params = { ...request }
    params.query = query
    params.conversationCode = conversationCode   // §8.0：用户原会话，非 agent: 隔离
    params.messageCode = messageCode             // 本轮落档用
    if (options) params.options = options        // 原 execChat options，重放时原样展开
    if (userInfo) params.execUserInfo = userInfo // 原 userInfo，重放时作 execChat 首参
    return {
        title: query ? String(query).slice(0, 60) : undefined,
        agentType: 'local',
        handler,                   // 注入，不默认（见文件头③）
        handleMode: 'manual',      // 持久不派发（见文件头①）
        handleStatus: 0,
        errorMode: 'break',
        conversationCode,
        agentRole: 'serialized-turn',
        operator,
        params,
        ...extra,
    }
}

export default { buildRootTask, buildSerializedTurnTask, decideAndBuild }
