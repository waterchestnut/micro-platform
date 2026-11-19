/**
 * @fileOverview 扇出(fan-out)端到端取证：真跑一棵 parallel 任务树并如实归约+决策（PR-任务编排 C/M4 方案1）
 * @module evals/platform-probes/fanout-e2e-probe
 * @description
 * 承 M1-b/M2 的取证路数（探针驱动**真实组件**跑真链路，而非把一切焊进热路径再跑）。这条验的是"扇出树真能跑通、
 * 子结果真能归到 root、`fanOutOrchestrate` 的决策对真实 agentChat 结果真合得上"——离线件全绿 ≠ 真能扇出去跑一棵树。
 *
 * 全链路（真 relay、真落档，零 Kafka、零 consumer）：
 *   ① `fanOutPlanner.normalizeFanOutPlan` 真裁 2 个子任务
 *   ② `taskQueueComposer.buildRootTask`(agentType=parallel, **handleMode=manual**) 组 root
 *   ③ `addAgentTask` 落库展开 children（manual ⇒ 不投 Kafka；且 addAgentTask 只对顶层投，子行不外抛）
 *   ④ `execAgentTask(root)` —— parallelDispatch 的 manual 分支返回 subsequents，
 *      execAgentTaskCore `await Promise.allSettled(execAgentTask(child))` **同进程并行**跑 2 个 `agentChat` child
 *      （各自真 execChat、隔离 `agent:` 会话、落档），updateParent 汇聚子态 → root 终态
 *   ⑤ 读回 root 的 children → `decideFanOutNext` → 断言真产出 synthesize + usable 分节
 *
 * ⚠️ 刻意边界：本探针**演练**编排层将来在"parent 完成时"做的事（把子结果喂 fanIn/orchestrate 得下一步），
 *   **没有**把 orchestrate 焊进现网 `updateParentAgentTaskWithLock` 汇聚热路径（那会波及建课等所有现网 fan-out，
 *   属需 e2e 回归的接线手术）；也没接入口触发/synthesis 落库/credits。这些是后续需评审的步。
 * 花真实 relay token（2 个小 child 轮，maxTokens 已压小），属已授权实测范围。跑完显式 process.exit（init 挂 redis/kafka）。
 *
 * 用法：node evals/platform-probes/fanout-e2e-probe.mjs
 * 判据以 JSON.verdict 每一路布尔为准，任一 false 即扇出端到端未通，不许靠"看起来绿"下结论。
 */
import { randomUUID } from 'node:crypto'

await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')
const { decideFanOutNext } = await import('../../services/agent/fanOutOrchestrate.js')

const userCode = 'menglb'
// 每个 child 压小输出、关缓存控成本；execOptionsExtra 经 params 透传进 agentChat
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const conversationCode = `fanoutprobe-${Date.now()}`
const out = { 起点: { conversationCode, userCode } }
const V = {}
const EXPECTED = 6

try {
    // ① 规划：真跑 planner
    const plan = normalizeFanOutPlan({
        subtasks: [
            { title: '算术', query: '用一句话回答：2+3 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
            { title: '颜色', query: '用一句话回答：天空通常是什么颜色？', params: { execOptionsExtra: CHILD_EXTRA } },
        ],
        subtaskCeiling: 4,
    })
    out.规划 = { mode: plan.mode, n: plan.subtasks.length, handlers: plan.subtasks.map(s => s.handler) }
    V['① planner 出 2 子任务(handler=agentChat)'] = plan.mode === 'fan-out' && plan.subtasks.length === 2
        && plan.subtasks.every(s => s.handler === 'agentChat')

    // ② 组 root：parallel + **manual**（manual ⇒ 不投 Kafka、parallelDispatch 走同进程 subsequents）
    const root = buildRootTask({
        conversationCode,
        agentType: 'parallel',
        handler: 'parallelDispatch',
        subtasks: plan.subtasks,
        operator: { userCode, realName: '扇出 e2e' },
        extra: { handleMode: 'manual' },
    })
    V['② root 形成为 parallel/manual（不投 Kafka 的前提）'] = root.agentType === 'parallel'
        && root.handler === 'parallelDispatch' && root.handleMode === 'manual' && root.subAgents.length === 2

    // ③ 落库展开（addAgentTask 内 formatWaitAddAgentTask 生成 agentCode 并写回；子行不外抛 Kafka）
    await addAgentTask(root)
    const rootCode = root.agentCode
    const storedRoot = await agentTaskDac.getByCode(rootCode)
    out.落库 = !!storedRoot && { rootCode, subAgents: storedRoot.subAgents?.length, handleStatus: storedRoot.handleStatus }
    V['③ root+children 落库(waiting, subAgents 已生成 agentCode)'] = !!storedRoot
        && storedRoot.handleStatus === 0 && storedRoot.subAgents?.length === 2
        && storedRoot.subAgents.every(s => !!s.agentCode)

    // ④ 同进程并行跑完整棵树（2×agentChat 真 execChat，隔离会话）
    const t0 = Date.now()
    await execAgentTask(storedRoot)
    out.跑树 = { durMs: Date.now() - t0 }
    const afterRoot = await agentTaskDac.getByCode(rootCode)
    out.root终态 = afterRoot?.handleStatus
    V['④ 树跑通:root 到成功终态(2)'] = afterRoot?.handleStatus === 2

    // ⑤ 读回 children（各自 agentChat 的 handleRet）喂 orchestrate
    const children = []
    for (const s of (afterRoot?.subAgents || [])) {
        const child = await agentTaskDac.getByCode(s.agentCode)
        if (child) children.push({
            agentCode: child.agentCode, title: child.title,
            handleStatus: child.handleStatus, handleRet: child.handleRet,
        })
    }
    out.children = children.map(c => ({ code: c.agentCode, status: c.handleStatus, contentLen: String(c.handleRet?.content || '').length, usable: c.handleRet?.usable }))
    V['⑤ 2 个 child 都到成功终态且读回有正文'] = children.length === 2
        && children.every(c => c.handleStatus === 2 && String(c.handleRet?.content || '').trim().length > 0)

    const next = decideFanOutNext({ children })
    out.决策 = { action: next.action, counts: next.counts, sections: next.input.sections.length, settled: next.settled }
    V['⑥ orchestrate 对真实结果判 synthesize(usable 2)'] = next.action === 'synthesize'
        && next.counts.usable === 2 && next.input.sections.length === 2 && next.settled === true

    out.分节正文预览 = next.input.sections.map(s => ({ 标题: s.title, 正文: s.content }))
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(执行抛错)'
    : ran < EXPECTED ? `未通(判据只跑到 ${ran}/${EXPECTED})`
        : allTrue ? '扇出端到端通过(真跑一棵 parallel 树 + 真归约决策)' : '未通(见 false 项)'
console.log('\n==== FANOUT E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
