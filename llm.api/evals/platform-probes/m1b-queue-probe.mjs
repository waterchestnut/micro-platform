/**
 * @fileOverview M1-b 会话任务队列端到端取证：真跑"连发不丢 + 同会话串行 + 忠实重放"（PR-任务编排 设计 A）
 * @module evals/platform-probes/m1b-queue-probe
 * @description
 * 这条链第3步改了最脆的 root.js，按本仓纪律"结论只能来自读数"——判据件全绿、源码接线测试全绿都≠真能跑通一次。
 * 本探针在 dev bootstrap 下把**真实的路由侧函数 + pump 候选件 + turnRunner** 串跑一遍（不起整个 fastify、不碰 Kafka）：
 *   1. 真跑一个 turn1（execChat）落在会话 C 上，作为"前文"；
 *   2. 造一条 processing 账本行模拟"又一轮正在跑"→ 真 decideOverlap 判拒 → 真 decideQueueOnOverlap 判 queue
 *      → 真 addAgentTask 落一条 manual serialized-turn（**不投 Kafka ⇒ 不会双跑**）；
 *   3. 会话仍忙时跑真 pump 候选件 ⇒ waiting-conversation（排队不丢、绝不并发）；
 *   4. 关掉忙碌行让会话空闲 → 真 pump 候选件 ⇒ dispatched，并把 turnRunner 的 execChat 真跑完（认领交接）；
 *   5. 读回本轮 message：finish、有正文、且 conversationCode 就是**用户原会话 C**（§8.0：非 agent: 隔离、看得到前文）。
 *
 * 全程合成 conversationCode、只写合成会话、压小 maxTokens 控成本；跑完显式 process.exit（init 挂着 redis/kafka）。
 * 判据以 JSON.verdict 里每一路布尔为准——任一 false 就是 M1-b 没真通，不许靠"看起来绿"下结论。
 *
 * 用法：node evals/platform-probes/m1b-queue-probe.mjs
 * 花真实 relay token（两个小轮），属已授权的 M1-b 实测范围。
 */
import { randomUUID } from 'node:crypto'

await import('../../init.js')
const execChat = (await import('../../services/core/llmChat.js')).execChat
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
const { LlmUsage } = await import('../../daos/core/schema/index.js')
const { decideOverlap } = await import('../../services/core/session/runOverlap.js')
const { decideQueueOnOverlap } = await import('../../services/core/session/turnScheduler.js')
const { buildSerializedTurnTask } = await import('../../services/core/session/taskQueueComposer.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const { pumpOneTurnCandidate } = await import('../../services/agent/serializedTurnCandidate.js')
const { acquireClaim, releaseClaim } = await import('../../services/agent/execClaim.js')
const { execAgentTask } = await import('../../services/agent/index.js')

const logger = llm.logger
const userCode = 'menglb'
const OPTS = { channel: 'micro_common', protocol: 2, cache: false, llmParams: { maxTokens: 48 } }

const conversationCode = `m1bprobe-${Date.now()}`
const m1 = randomUUID()
const m2 = randomUUID()
const busyCode = `busy-${m1}`

const out = { 起点: { conversationCode, m1, m2, busyCode } }
const V = {}

try {
    // ---- 0) 真跑 turn1 落在会话 C 上（作为后续追问要看的前文）
    const t0 = Date.now()
    await execChat({ userCode }, '用一句话回答：1+1 等于几？', conversationCode, { ...OPTS, messageCode: m1, streamCallback: () => {} })
    out.turn1 = { durMs: Date.now() - t0 }
    const d1 = await messageDac.getByCode(m1)
    out.turn1.progress = d1?.progress
    out.turn1.answerLen = String(d1?.answer || '').length
    V['turn1真落档(finish+正文)'] = !!d1 && d1.progress === 'finish' && out.turn1.answerLen > 0

    // ---- 1) 造 processing 账本行模拟"上一轮仍在跑"→ 真判据（读真实账本）
    await llmUsageDac.markStarted({ messageCode: busyCode, conversationCode, userCode })
    const prevOpen = await llmUsageDac.findOpenRun({ conversationCode, excludeMessageCode: m2 })
    const od = decideOverlap({ prev: prevOpen, now: Date.now(), windowMs: 1500, reject: true })
    out.判定 = { prevOpen: !!prevOpen, admit: od.admit, reason: od.reason, ageMs: od.ageMs }
    V['真判据:会话忙时本应拒(不丢的前提)'] = od.admit === false

    // 关/开两态都验一遍"默认关=逐字拒绝"
    V['关时仍判拒(4291,逐字不变)'] = decideQueueOnOverlap({ enabled: false, overlapAdmit: od.admit, overlapReason: od.reason }).decision === 'reject'
    const q = decideQueueOnOverlap({ enabled: true, overlapAdmit: od.admit, overlapReason: od.reason, queueCount: 0, maxQueue: 50 })
    V['开时判queue(排队非拒绝)'] = q.decision === 'queue'

    // ---- 2) 真入队（manual：落库、不投 Kafka）
    const turn = buildSerializedTurnTask({
        conversationCode, messageCode: m2, query: '把上一条的答案原样再确认一遍。',
        request: {}, options: OPTS, userInfo: { userCode }, handler: 'turnRunner',
    })
    await addAgentTask(turn)
    const stored = await agentTaskDac.getByCode(turn.agentCode)
    out.入队行 = stored && {
        agentCode: stored.agentCode, handleStatus: stored.handleStatus, handleMode: stored.handleMode,
        agentRole: stored.agentRole, conversationCode: stored.conversationCode, paramsMessageCode: stored.params?.messageCode,
    }
    // 这是第2步 schema 修复的**经验性验证**：这些是顶层字段，若未被 schema 静默丢弃才读得回来
    V['入队持久化(manual/serialized-turn/会话身份齐, 未丢字段)'] = !!stored
        && stored.handleMode === 'manual' && stored.handleStatus === 0
        && stored.agentRole === 'serialized-turn' && stored.conversationCode === conversationCode
        && stored.params?.messageCode === m2
    // manual 关键证据：此刻 m2 尚未被执行（没投 Kafka ⇒ consumer 不会抢跑），会话里不该有 m2 档案
    const m2Before = await messageDac.getByCode(m2)
    V['manual 未自动派发(m2 此刻无档案,证明不会双跑)'] = !m2Before

    // ---- 3) 会话仍忙时跑真 pump 候选件 ⇒ 必须 waiting（排队不丢、绝不并发）
    const deps = { findOpenRun: (a) => llmUsageDac.findOpenRun(a), acquireClaim, releaseClaim, exec: execAgentTask, log: logger }
    const p1 = await pumpOneTurnCandidate({ task: stored, staleMs: 45000, leaseMs: 900000, now: Date.now(), deps })
    out.pump忙时 = { outcome: p1.outcome, reason: p1.reason }
    V['会话忙时 pump 不派发(waiting-conversation)'] = p1.outcome === 'waiting-conversation'
    V['忙时确实没跑 m2'] = !(await messageDac.getByCode(m2))

    // ---- 4) 关掉忙碌行 → 会话空闲 → 真 pump 派发并 await 其 execChat
    await LlmUsage.updateOne({ messageCode: busyCode }, { $set: { progress: 'finish', updateTime: new Date() } })
    let execPromise = null
    const depsObs = { ...deps, exec: (t, o) => { execPromise = execAgentTask(t, o); return execPromise } }
    const p2 = await pumpOneTurnCandidate({ task: stored, staleMs: 45000, leaseMs: 900000, now: Date.now(), deps: depsObs })
    out.pump空闲 = { outcome: p2.outcome }
    V['会话空闲时 pump 派发(dispatched)'] = p2.outcome === 'dispatched' && !!execPromise
    if (execPromise) {
        const t2 = Date.now()
        const execRet = await execPromise
        out.turn2 = { durMs: Date.now() - t2, handleStatus: execRet?.handleStatus, reason: execRet?.handleRet?.reason, usable: execRet?.handleRet?.usable }
    }

    // ---- 5) 读回本轮真实档案
    const d2 = await messageDac.getByCode(m2)
    out.turn2归档 = d2 && { progress: d2.progress, conversationCode: d2.conversationCode, answerLen: String(d2.answer || '').length, answerHead: String(d2.answer || '').slice(0, 40) }
    V['追问真跑并落档(finish+正文)'] = !!d2 && d2.progress === 'finish' && String(d2.answer || '').length > 0
    // §8.0 核心：这一轮跑在**用户原会话**上（能读到 turn1 前文），而不是 agent: 隔离会话
    V['忠实重放:跑在用户原会话(非 agent: 隔离)'] = !!d2 && d2.conversationCode === conversationCode

    // 排队轮执行完应把 agentTask 行推到终态（handleStatus 2）
    const storedAfter = await agentTaskDac.getByCode(turn.agentCode)
    out.入队行终态 = { handleStatus: storedAfter?.handleStatus }
    V['排队轮执行后任务行到终态(2)'] = storedAfter?.handleStatus === 2
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
}

// 判据必须**齐且全真**才算通过——空 verdict / 少一项 / 抛错都不能被 [].every() 的空真蒙混成"通过"
const EXPECTED = 12
const allTrue = !out.错误 && Object.keys(V).length === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? 'M1-b 未通(执行中抛错)'
    : Object.keys(V).length < EXPECTED ? `M1-b 未通(判据只跑了 ${Object.keys(V).length}/${EXPECTED}，有步骤没走到)`
        : allTrue ? 'M1-b 端到端通过(真跑)' : 'M1-b 未通(见 false 项)'
console.log('\n==== M1-B E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
