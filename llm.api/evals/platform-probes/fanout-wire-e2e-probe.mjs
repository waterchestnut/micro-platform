/**
 * @fileOverview finalize 自动触发接线端到端取证（PR-任务编排 C/步骤 B1）
 * @module evals/platform-probes/fanout-wire-e2e-probe
 * @description
 * 步骤 A 证明"finalize task 被直接派发时真能收尾+综合落 root"；本探针证**接线本身**：
 * 编排 root 首次到终态时，`updateParentAgentTaskWithLock` 锁外自动派发 finalize——
 * 且三阶段各自钉死一条现网安全性质：
 *   P1 开关默认关 ⇒ 树跑完 root 无 orchestration（与 B0/现网逐字一致，finalize 根本不触发）；
 *   P2 开关开(direct) ⇒ 同一链路**无需任何手动派发**，root.handleRet.orchestration 自动出现、
 *      synthesis 真落 `root:<rootCode>` 且有正文；
 *   P3 开关开但 root 不带 orchestrated 标志（建课类普通父）⇒ 不触发——总开关被误开也不碰老任务。
 * 零 Kafka（direct 同进程 fire-and-forget；kafka 模式的前置条件"consumer 已部署新 handler"不属本机验证）。
 * 花真实 relay（3 child + 1 synthesis，压小 maxTokens），属授权实测。跑完显式 process.exit。
 * 用法：node evals/platform-probes/fanout-wire-e2e-probe.mjs
 */
await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

const userCode = 'menglb'
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const SYNTH_EXTRA = { cache: false, llmParams: { maxTokens: 96 } }
const out = {}
const V = {}
const EXPECTED = 5

const cfg = () => llm.config.agentTask.fanOutOrchestration

/** 跑一棵"单 child"的编排/普通 parallel root（同 manual 建树路数，最小成本） */
async function runTree({ orchestrated, suffix }) {
    const conversationCode = `fanwire-${suffix}-${Date.now()}`
    const root = buildRootTask({
        conversationCode,
        agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: [{
            title: '算术', handler: 'agentChat',
            params: { query: '用一句话回答：3+4 等于几？', execOptionsExtra: CHILD_EXTRA },
        }],
        operator: { userCode },
        extra: { handleMode: 'manual', ...(orchestrated ? { orchestrated: true } : {}) },
    })
    root.params = { ...(root.params || {}), query: '3+4 等于几？', channel: 'micro_common', protocol: 2, synthesisExecOptions: SYNTH_EXTRA }
    await addAgentTask(root)
    await execAgentTask(await agentTaskDac.getByCode(root.agentCode))
    return { rootCode: root.agentCode, conversationCode }
}

async function pollOrchestration(rootCode, ms = 60000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        const r = await agentTaskDac.getByCode(rootCode)
        if (r?.handleRet?.orchestration) return r
        await new Promise((res) => setTimeout(res, 500))
    }
    return null
}

try {
    // ---- P1 默认关：逐字不变
    V['P1a 进程起来时开关默认关'] = cfg().enabled === false
    const p1 = await runTree({ orchestrated: true, suffix: 'off' })
    const r1 = await agentTaskDac.getByCode(p1.rootCode)
    out.P1 = { rootStatus: r1.handleStatus, hasOrch: !!r1.handleRet?.orchestration }
    V['P1b 关时:树正常跑完(root=2)且 root 无 orchestration(逐字不变)'] = r1.handleStatus === 2 && !r1.handleRet?.orchestration

    // ---- P2 开关开(direct)：自动 finalize + synthesis 落 root
    cfg().enabled = true
    cfg().dispatch = 'direct'
    const p2 = await runTree({ orchestrated: true, suffix: 'on' })
    const r2 = await pollOrchestration(p2.rootCode)
    out.P2 = r2 && {
        status: r2.handleStatus, action: r2.handleRet?.orchestration?.action,
        synthConv: r2.handleRet?.synthesis?.conversationCode, synthUsable: r2.handleRet?.synthesis?.usable,
    }
    V['P2a 开时:finalize 自动触发(root.handleRet.orchestration 出现且 synthesize)'] =
        !!r2 && r2.handleRet?.orchestration?.action === 'synthesize' && r2.handleStatus === 2
    const synthCode = r2?.handleRet?.synthesis?.messageCode
    const synthDoc = synthCode ? await messageDac.getByCode(synthCode) : null
    out.P2synth = synthDoc && { conv: synthDoc.conversationCode, progress: synthDoc.progress, len: String(synthDoc.answer || '').length }
    V['P2b synthesis 真落 root:<rootCode> 会话且有正文'] = !!synthDoc
        && synthDoc.conversationCode === `root:${p2.rootCode}` && synthDoc.progress === 'finish'
        && String(synthDoc.answer || '').trim().length > 0

    // ---- P3 开关开、但非编排 root（建课类）：不触发
    const p3 = await runTree({ orchestrated: false, suffix: 'legacy' })
    await new Promise((res) => setTimeout(res, 3000))  // 给 direct 派发留窗口（不该有任何东西被派发）
    const r3 = await agentTaskDac.getByCode(p3.rootCode)
    out.P3 = { status: r3.handleStatus, hasOrch: !!r3.handleRet?.orchestration, orchestrated: r3.orchestrated }
    V['P3 开关开但无 orchestrated 标志:老任务照旧机械汇聚、不被 finalize'] = r3.handleStatus === 2
        && !r3.handleRet?.orchestration && r3.orchestrated !== true
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据只到 ${ran}/${EXPECTED})` : allTrue ? 'B1 接线端到端通过(关逐字不变/开自动收尾/老任务免疫)' : '未通(见 false 项)'
console.log('\n==== FANOUT-WIRE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
