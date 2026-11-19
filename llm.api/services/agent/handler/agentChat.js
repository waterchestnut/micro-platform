/**
 * @fileOverview 会话任务树里"子智能体"的执行体 handler（PR-任务编排 M2 接线，薄 IO）
 * @module services/agent/handler/agentChat
 * @description
 * fan-out 出的每个 child agentTask 由本 handler 执行——它把一次会话 run（core `execChat`，带 skills/tools）
 * 包成一个 agentTask 节点。与现成 `llm` handler 的区别：`llm/handler/llmChat.js` 是**裸 OpenAI 调用**
 * （无技能/无工具/无落档），而子智能体要"和主会话一样能干"，必须走 core `execChat`。
 *
 * 编排契约（options 形状、终局映射、结果归约）全部复用**已离线穷举的 `childTurn`**，本文件只做 IO 接线，
 * 不重复实现阈值/裁决逻辑（同一契约不写两遍）。
 *
 * 关键红线（都在 childTurn 用例里钉死，这里只接线）：
 * - 不给 answerRouter/runMailbox/hardSteer ⇒ execChat 不注册 ask_user、不接插话 ⇒ child 绝不挂起等人拖死树；
 * - child 产出从其**自己那条已落档 message** 读回（messageDac.getByCode），不在 streamCallback 二次累积正文；
 * - execChat 返 'aborted' ⇒ handleStatus -1 且 retryable，绝不记成完成。
 *
 * 诚实边界：本 handler 的**真值验证是 dev 真跑一个 child**（`manualTriggerAgentTask`，会花 relay token、有副作用），
 * 属需授权窗口；离线只保证 childTurn 契约正确 + 本文件语法/API 用法对。不因"能 import、node --check 过"就声称已验证。
 */
import BaseHandler from './base.js'
import { execChat } from '../../core/llmChat.js'
import messageDac from '../../../daos/core/dac/messageDac.js'
import llmUsageDac from '../../../daos/core/dac/llmUsageDac.js'
import { buildChildExecOptions, mapChildOutcome, reduceChildResult } from '../childTurn.js'

const tools = llm.tools
const logger = llm.logger

const DEFAULT_CHILD_TIMEOUT_MS = 5 * 60 * 1000

class AgentChat extends BaseHandler {
    constructor() {
        super('local')
    }

    async exec(agentTaskInfo) {
        const p = agentTaskInfo.params || {}
        const curUserInfo = p.curUserInfo || agentTaskInfo.operator
        const userCode = curUserInfo?.userCode

        // 空正文不谎称成功（fan-in 综合/裁决如实看到空）；缺身份直接判错
        if (!userCode) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'child 缺少用户身份（operator/curUserInfo）', subsequentMode: '', subsequents: [] }
        }
        const query = String(p.query || agentTaskInfo.title || '').trim()
        if (!query) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'child query 为空', subsequentMode: '', subsequents: [] }
        }

        // child 身份：默认用本节点 agentCode 派生（幂等、可回读），上层可显式覆盖
        const childMessageCode = p.childMessageCode || agentTaskInfo.agentCode || tools.getUUID()
        const childConversationCode = p.childConversationCode || `agent:${agentTaskInfo.agentCode || childMessageCode}`

        // 有界超时：child 不该无限占着 run 名额（预算/并行度是全局约束）
        const timeoutMs = Number(p.childTimeoutMs) > 0 ? Number(p.childTimeoutMs) : DEFAULT_CHILD_TIMEOUT_MS
        const controller = new AbortController()
        const timer = setTimeout(() => {
            try { controller.abort(new Error('child-timeout')) } catch { /* 已 abort */ }
        }, timeoutMs)
        timer.unref?.()

        let ret
        try {
            // child 不连用户 SSE：streamCallback 是有界 no-op（正文靠读回档案，不靠这里累积）
            ret = await execChat(curUserInfo, query, childConversationCode, buildChildExecOptions({
                messageCode: childMessageCode,
                conversationCode: childConversationCode,
                channel: p.channel,
                protocol: p.protocol,
                llmModel: p.llmModel,
                // §3/§6 附件安全红线（B-2）：**child 不透传附件**。child 跑在 `agent:` 隔离会话，
                // 把用户 fileCode 随 execChat 存档=让文件标识进入与授权面不同的第二条落库路径；
                // 现阶段 child 无消费面（planner 只看 query 文本、llmChat 对 attachments 只存档不解析），
                // 真要用文件（附件 B/PDF 入库二期）必须走"fileCode 绑定发起 userCode + messageScope 同款
                // 归属校验"的显式通道，不开透传后门。turnRunner（用户自己的会话=同归属忠实重放）不受此限。
                signal: controller.signal,
                streamCallback: () => {},
                reqId: p.reqId,
                parentTraceId: p.parentTraceId,
                // §5-4 账本关联：child 行挂到所属树（rootCode=parentCode，树顶层 child 的父即 root）
                extra: {...(p.execOptionsExtra || {}), taskContext: {rootCode: agentTaskInfo.parentCode || agentTaskInfo.agentCode, agentCode: agentTaskInfo.agentCode, agentRole: 'child'}},
            }))
        } finally {
            clearTimeout(timer)
        }

        const aborted = controller.signal?.aborted === true
        const outcome = mapChildOutcome({ ret, aborted })

        // 读回 child 自己那条已落档 message（execChat 在返回前已 saveMessage 落档）
        let view = null
        try {
            const doc = await messageDac.getByCode(childMessageCode)
            if (doc) view = { messageCode: doc.messageCode, answer: doc.answer, progress: doc.progress }
        } catch (e) {
            logger.warn(`agentChat 读回 child 档案失败 messageCode=${childMessageCode}: ${String(e?.message || e).slice(0, 160)}`)
        }
        const result = reduceChildResult(view)

        // M6：child 的 credits 从它**自己的 llmUsage 行**读（口径唯一在落账点，见 creditMeter），
        // 供 fanIn.rollupCredits 汇总成 root 的树账。缺行/缺字段就**不带**——
        // 宁可 rollup 少一项并在 priced:false 上老实，也不在读取侧补一个算出来的 0（"缺席≠零"）。
        let usage = null
        try {
            usage = await llmUsageDac.getByCode(childMessageCode)
        } catch (e) {
            logger.warn(`agentChat 读 child 用量行失败 messageCode=${childMessageCode}: ${String(e?.message || e).slice(0, 160)}`)
        }
        const creditsFields = usage && typeof usage.credits === 'number'
            ? {credits: usage.credits, creditsPriced: usage.creditsPriced === true}
            : {}

        // execChat 说 done、但档案读回空/缺 ⇒ 不算可用成果（usable:false 随 handleRet 带给 fan-in 裁决），
        // 不据此把 handleStatus 改判——改判属仲裁职责，本层只如实交事实。
        return {
            handleStatus: outcome.handleStatus,
            handleRet: {...result, ...creditsFields, retryable: outcome.retryable, reason: outcome.reason},
            errorMsg: outcome.handleStatus === -1 ? (result.note || outcome.reason) : '',
            subsequentMode: '',
            subsequents: [],
        }
    }
}

export default AgentChat
