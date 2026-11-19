/**
 * @fileOverview 生成式 planner 端到端取证（PR-任务编排 M4b c1c）
 * @module evals/platform-probes/fanout-planner-e2e-probe
 * @description
 * 从**一句自然语言**到**归档的综合**的全链真跑：planner 低档判定/拆解（真模型）→ 语义严判 → 预算裁剪 →
 * orchestrated root 入库 → manual 跑树（真 agentChat children）→ B1 自动 finalize → synthesis 落 root。
 * 外加两性格验证：默认关连模型都不碰（P0）；"你好"这类请求**不许**被拆（P3）。
 * 花真实 relay（2 次 low 判定 + N child + 1 综合），压小输出档，属授权实测。跑完显式 process.exit。
 * 用法：node evals/platform-probes/fanout-planner-e2e-probe.mjs
 */
await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const { planFanOutFromRequest } = await import('../../services/agent/fanOutPlannerService.js')

const userCode = 'menglb'
const out = {}
const V = {}
const EXPECTED = 6

async function pollOrchestration(rootCode, ms = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        const r = await agentTaskDac.getByCode(rootCode)
        if (r?.handleRet?.orchestration) return r
        await new Promise((res) => setTimeout(res, 500))
    }
    return null
}

try {
    // ---- P0 默认关：连模型都不碰
    V['P0 planner 默认关 ⇒ disabled 短路'] = (await planFanOutFromRequest({ query: '随便', conversationCode: 'x' })).reason === 'disabled'

    // ---- 开启 planner + 编排接线（e2e 内存翻转；生产走 env）
    llm.config.agentTask.fanOutPlanner.enabled = true
    llm.config.agentTask.fanOutOrchestration.enabled = true
    llm.config.agentTask.fanOutOrchestration.dispatch = 'direct'

    // ---- P1 可拆请求 ⇒ 真判定/拆解 ⇒ orchestrated root 入库（manual，不投 Kafka）
    const conv1 = `fanplan-on-${Date.now()}`
    const p1 = await planFanOutFromRequest({
        query: '分别说明 HTTP 缓存强弱缓存各自的适用场景，最后给一句选择建议。',
        conversationCode: conv1,
        operator: { userCode },
        request: { channel: 'micro_common', protocol: 2 },
        handleMode: 'manual',
    })
    out.P1 = { fanOut: p1.fanOut, reason: p1.reason, n: p1.subtasks?.length, rootCode: p1.rootCode, raw: p1.plannerRaw }
    V['P1a 真 planner 判扇出且 subtasks>=2'] = p1.fanOut === true && (p1.subtasks?.length || 0) >= 2
    const stored = p1.rootCode ? await agentTaskDac.getByCode(p1.rootCode) : null
    V['P1b root 落库:orchestrated=true 且 children>=2(parallel)'] = !!stored
        && stored.orchestrated === true && stored.agentType === 'parallel' && (stored.subAgents?.length || 0) >= 2

    // ---- P2 跑树 ⇒ B1 自动 finalize ⇒ synthesis 落 root（全链闭环）
    if (stored) {
        await execAgentTask(stored)
        const done = await pollOrchestration(p1.rootCode)
        const synthCode = done?.handleRet?.synthesis?.messageCode
        const synthDoc = synthCode ? await messageDac.getByCode(synthCode) : null
        out.P2 = done && {
            status: done.handleStatus, action: done.handleRet?.orchestration?.action,
            children: (done.subAgents || []).length,
            synthConv: done.handleRet?.synthesis?.conversationCode,
            synthLen: String(synthDoc?.answer || '').length,
        }
        V['P2 自动 finalize+综合落 root:<rootCode> 有正文'] = !!done
            && done.handleRet?.orchestration?.action === 'synthesize' && done.handleStatus === 2
            && !!synthDoc && synthDoc.conversationCode === `root:${p1.rootCode}`
            && String(synthDoc.answer || '').trim().length > 0

        // 用户线不该出现综合
        V['P2b 综合不落用户会话线'] = !!synthDoc && synthDoc.conversationCode !== conv1
    } else {
        V['P2 自动 finalize+综合落 root:<rootCode> 有正文'] = false
        V['P2b 综合不落用户会话线'] = false
    }

    // ---- P3 闲聊 ⇒ 不许拆（模型说不扇，入库必须 0 行）
    const conv3 = `fanplan-off-${Date.now()}`
    const p3 = await planFanOutFromRequest({ query: '你好！', conversationCode: conv3, operator: { userCode }, handleMode: 'manual' })
    out.P3 = { fanOut: p3.fanOut, reason: p3.reason }
    V['P3 闲聊不扇出(且未产生 root)'] = p3.fanOut === false

    llm.config.agentTask.fanOutPlanner.enabled = false
    llm.config.agentTask.fanOutOrchestration.enabled = false
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据只到 ${ran}/${EXPECTED})` : allTrue ? 'M4b planner 端到端通过(自然语言→判定→拆→树→自动综合落 root)' : '未通(见 false 项)'
console.log('\n==== FANOUT-PLANNER E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
