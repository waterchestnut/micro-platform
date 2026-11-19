/**
 * @fileOverview 会话追问轮（serialized-turn）的忠实重放执行体 handler（PR-任务编排 M1-b 设计 A）
 * @module services/agent/handler/turnRunner
 * @description
 * 排队模式下，一条"用户追问轮"先以 `handleMode:'manual'` 持久化（见 `taskQueueComposer.buildSerializedTurnTask`），
 * 等它所在会话空闲后，由短周期 pump 取认领并 `execAgentTask` 派发——派发到本 handler 执行。
 *
 * 为什么不是复用 `agentChat`（M2 的 child 执行体）：`agentChat` 走 `childTurn.buildChildExecOptions`，
 * 里面**硬编 `memory: CHILD_MEMORY_OFF`**、且会话身份默认派生成 `agent:<code>` 隔离。这两点对 fan-out 子任务是**对的**
 * （子任务各自独立、不污染主会话记忆），但对"用户自己的下一句追问"是**错的**——追问必须：
 * 1. 跑在**用户原 conversationCode** 上（§8.0：要看得到上一轮前文）；
 * 2. 用**与正常轮相同的 options**（含 memory 等），否则"排队的追问"和"没排队的追问"行为不一致。
 * 故本 handler **原样展开入队时存下的 `options`** 调 `execChat`，形状对齐 `root.js:425-445` 的正常轮。
 *
 * 与正常轮的唯一差异（都是"没有活连接"带来的，非语义偷工）：
 * - `streamCallback` 是有界 no-op：正文由 `execChat` 内部 `saveMessage` 落档，前端经 M1-c 的事件日志/续接看过程，不靠这里累积；
 * - 不带 `answerRouter/runMailbox/hardSteer`：后台轮没有人可插话/答题，不注册这些 ⇒ 绝不挂在 `await_input` 拖住队列
 *   （与 child 同一条"不挂起等人"纪律，理由不同但取向一致）。
 *
 * 诚实边界：本 handler 的**真值验证是 dev 端到端跑通一次入队→pump→重放**（m1b-queue-probe），
 * 离线只保证契约与调用形状对。不因"node --check 过了"就声称已验证。
 */
import BaseHandler from './base.js'
import { execChat } from '../../core/llmChat.js'
import messageDac from '../../../daos/core/dac/messageDac.js'
import { mapChildOutcome, reduceChildResult } from '../childTurn.js'

const tools = llm.tools
const logger = llm.logger

/** 后台重放的有界超时：一个追问轮不该无限占着会话与 run 名额；比 child 略宽（用户轮更常带工具/长答） */
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000

class TurnRunner extends BaseHandler {
    constructor() {
        super('local')
    }

    async exec(agentTaskInfo) {
        const p = agentTaskInfo.params || {}
        const userInfo = p.execUserInfo || agentTaskInfo.operator
        const userCode = userInfo?.userCode

        // 缺身份直接判错（execChat 首参需要 userInfo.userCode 归属与鉴权）
        if (!userCode) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'serialized-turn 缺少用户身份（execUserInfo/operator）', subsequentMode: '', subsequents: [] }
        }
        const query = String(p.query || agentTaskInfo.title || '').trim()
        if (!query) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'serialized-turn query 为空', subsequentMode: '', subsequents: [] }
        }
        // §8.0：跑用户原会话，绝不派生成 agent: 隔离；messageCode 用入队时那一条（本轮落档键）
        const conversationCode = p.conversationCode || agentTaskInfo.conversationCode
        if (!conversationCode) {
            return { handleStatus: -1, handleRet: null, errorMsg: 'serialized-turn 缺少 conversationCode', subsequentMode: '', subsequents: [] }
        }
        const messageCode = p.messageCode || agentTaskInfo.agentCode || tools.getUUID()

        const timeoutMs = Number(p.turnTimeoutMs) > 0 ? Number(p.turnTimeoutMs) : DEFAULT_TURN_TIMEOUT_MS
        const controller = new AbortController()
        const timer = setTimeout(() => {
            try { controller.abort(new Error('turn-timeout')) } catch { /* 已 abort */ }
        }, timeoutMs)
        timer.unref?.()

        let ret
        try {
            // 忠实重放：原样展开入队时存下的 options（含 memory/channel/protocol/llmModel/inputs 等），仅覆盖本轮身份
            ret = await execChat(userInfo, query, conversationCode, {
                ...(p.options || {}),
                messageCode,
                conversationCode,
                // §5-4 账本关联：排队追问轮=自根任务（rootCode 用自身 agentCode，行已在库）
                taskContext: {rootCode: agentTaskInfo.agentCode, agentCode: agentTaskInfo.agentCode, agentRole: 'serialized-turn'},
                signal: controller.signal,
                streamCallback: () => {},
                reqId: p.reqId,
            })
        } finally {
            clearTimeout(timer)
        }

        const aborted = controller.signal?.aborted === true
        const outcome = mapChildOutcome({ ret, aborted })

        // 读回本轮那条已落档 message（execChat 在返回前已 saveMessage），usable 与档案一致，不粉饰空正文
        let view = null
        try {
            const doc = await messageDac.getByCode(messageCode)
            if (doc) view = { messageCode: doc.messageCode, answer: doc.answer, progress: doc.progress }
        } catch (e) {
            logger.warn(`turnRunner 读回档案失败 messageCode=${messageCode}: ${String(e?.message || e).slice(0, 160)}`)
        }
        const result = reduceChildResult(view)

        return {
            handleStatus: outcome.handleStatus,
            handleRet: { ...result, conversationCode, retryable: outcome.retryable, reason: outcome.reason },
            errorMsg: outcome.handleStatus === -1 ? (result.note || outcome.reason) : '',
            subsequentMode: '',
            subsequents: [],
        }
    }
}

export default TurnRunner
