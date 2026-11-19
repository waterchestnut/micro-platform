/**
 * @fileOverview M2 子智能体端到端取证：真跑一个 agentChat child（真 execChat + 真落档 + 真读回）
 * @module evals/platform-probes/m2-child-probe
 * @description
 * 守本档那条线："handler 写完、node --check 过、childTurn 用例全绿" ≠ "agentChat 真能跑通一次 child"。
 * 本探针在 dev bootstrap 下真调 `agentChat.exec`（内部真跑 core `execChat`、落 message 档案与 llmUsage），
 * 再从 `messageDac` 直读那条 child message 验证"读回拿到正文"这条链路真成立。
 * 全程合成 conversationCode、只写合成本轮，不碰生产会话；跑完显式 process.exit（init 挂着 redis/kafka）。
 *
 * 前置：dev mongo/redis 可达（本机实测 192.168.31.124:27017/6379 OPEN）、relay 公网可用。
 * 判据（全真才算 M2 通过）：
 * - execChat 真跑了：handleStatus ∈ {2,-1}（非抛错崩树）、reason 明确；
 * - child 档案真落了：messageDac.getByCode 拿得到那条 message、progress 为终态之一；
 * - 读回归约真拿到内容：reduceChildResult 的 usable 与档案 answer 一致（有内容才 usable）。
 *
 * 用法：node evals/platform-probes/m2-child-probe.mjs [--q=小问题] [--maxtok=128]
 * 花真实 relay token（一个 child 一轮，已把 maxTokens 压小）；属"接 M2 实测"授权范围内。
 */
import { randomUUID } from 'node:crypto'

const argv = process.argv.slice(2)
const val = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d }

await import('../../init.js')
const { default: AgentChat } = await import('../../services/agent/handler/agentChat.js')
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const { reduceChildResult } = await import('../../services/agent/childTurn.js')

const agentCode = `m2child-${Date.now()}`
const childMessageCode = randomUUID()
const childConversationCode = `agent:${agentCode}`
const query = val('q', '用一句话解释什么是线性注意力。')
const maxtok = Number(val('maxtok', 128)) || 128

const taskInfo = {
    agentCode,
    handleStatus: 0,
    handler: 'agentChat',
    title: query.slice(0, 30),
    operator: { userCode: 'menglb', realName: 'M2 child 取证' },
    params: {
        query,
        channel: 'micro_common',
        protocol: 2,
        // 压小输出、关缓存，控制这次取证的成本
        execOptionsExtra: { cache: false, llmParams: { maxTokens: maxtok } },
        childMessageCode,
        childConversationCode,
    },
}

console.log(JSON.stringify({ '起点': { agentCode, childMessageCode, childConversationCode, query, maxtok } }))

const t0 = Date.now()
let handlerOut, handlerErr
try {
    const handler = new AgentChat()
    handlerOut = await handler.exec(taskInfo)
} catch (e) {
    handlerErr = String((e && e.message) || e).slice(0, 300)
}
const durMs = Date.now() - t0

// 独立读回那条 child message（不经 handler），证"档案真落了 + 读回口径对得上"
let archived = null
let archErr
try {
    const doc = await messageDac.getByCode(childMessageCode)
    archived = doc ? { messageCode: doc.messageCode, progress: doc.progress, answer: String(doc.answer || ''), answerLen: String(doc.answer || '').length, answerHead: String(doc.answer || '').slice(0, 60) } : null
} catch (e) {
    archErr = String((e && e.message) || e).slice(0, 200)
}

// 用真读回的完整 answer 归约（不是截断的 answerHead），才对得上"有内容⇒usable"
const reduced = reduceChildResult(archived ? { messageCode: archived.messageCode, answer: archived.answer, progress: archived.progress } : null)

console.log(JSON.stringify({
    handler: handlerErr ? { error: handlerErr } : { handleStatus: handlerOut.handleStatus, reason: handlerOut.handleRet?.reason, usable: handlerOut.handleRet?.usable, contentLen: String(handlerOut.handleRet?.content || '').length, errorMsg: handlerOut.errorMsg || null },
    archived,
    archErr: archErr || undefined,
    reduceFromArchive: { usable: reduced.usable },
    durMs,
    // 判据汇总
    verdict: {
        'execChat真跑了(2/-1非崩)': !handlerErr && [2, -1].includes(handlerOut?.handleStatus),
        'child档案真落': !!archived,
        '档案到终态': !!archived && ['finish', 'abort', 'error'].includes(archived.progress),
        '有内容则usable(读回一致)': !archived || (archived.answerLen > 0) === (handlerOut?.handleRet?.usable === true),
    },
}, null, 1))

process.exit(0)
