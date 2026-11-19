/**
 * @fileOverview fan-out finalize+synthesis 端到端取证（PR-任务编排 C/M4 步骤 A）
 * @module evals/platform-probes/fanout-finalize-e2e-probe
 * @description
 * 在 fanout-e2e-probe（建树真跑通）之后，补上"root 完成 → finalize → synthesis 落 root"这后半段的真读数。
 * 链路全真：真跑 parallel 树（2×agentChat 真 relay）→ **直接派发 finalize task**（`execAgentTask({handler:'fanOutFinalizeTask'})`）
 * → handler 读 root+children → `finalizeFanOutRoot` → 真调一次 synthesis（execChat 落 `root:<rootCode>` 隔离会话）→ 写回 root。
 * 零 Kafka、零 updateParent 改动（那属步骤 B）；finalize task 是内存对象不落库，root 的写回走真 redlock+mongo。
 *
 * 判据（JSON.verdict 全真才算过，任一 false 即未通）：
 * ① root 终态 2、2 child 有正文；② finalize 返回 synthesize；③ root.handleRet.orchestration 齐
 * （action/counts/dispatch.needSynthesis）；④ synthesis message **真落 `root:<rootCode>` 会话**、finish、有正文、
 * usable:true；⑤ 用户会话（conversationCode）里**没有**这条综合（落 root、不回填聊天线——属主拍板的核心语义）；
 * ⑥ 幂等形状：finalize 重跑再成功（用固定 synthesisMessageCode）。
 *
 * 花真实 relay（2 child + 1 synthesis，maxTokens 已压小），属授权实测范围。跑完显式 process.exit。
 * 用法：node evals/platform-probes/fanout-finalize-e2e-probe.mjs
 */
import { randomUUID } from 'node:crypto'

await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const SYNTH_EXTRA = { cache: false, llmParams: { maxTokens: 128 } }
const userCode = 'menglb'
const conversationCode = `fanfinprobe-${Date.now()}`
const out = { 起点: { conversationCode } }
const V = {}
const EXPECTED = 7

try {
    // ① 建树并真跑（与 fanout-e2e-probe 同路数：manual parallel root，同进程并行 children）
    const plan = normalizeFanOutPlan({
        subtasks: [
            { title: '算术', query: '用一句话回答：2+3 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
            { title: '颜色', query: '用一句话回答：天空通常是什么颜色？', params: { execOptionsExtra: CHILD_EXTRA } },
        ],
        subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode,
        agentType: 'parallel', handler: 'parallelDispatch', subtasks: plan.subtasks,
        operator: { userCode, realName: 'finalize e2e' },
        extra: { handleMode: 'manual' },
    })
    await addAgentTask(root)
    const rootCode = root.agentCode
    await execAgentTask(await agentTaskDac.getByCode(rootCode))
    const afterTree = await agentTaskDac.getByCode(rootCode)
    const childDocs = await Promise.all((afterTree.subAgents || []).map((s) => agentTaskDac.getByCode(s.agentCode)))
    out.树 = { rootStatus: afterTree.handleStatus, children: childDocs.map((c) => ({ s: c.handleStatus, len: String(c.handleRet?.content || '').length })) }
    V['① 树真跑完(root=2, child 正文齐)'] = afterTree.handleStatus === 2
        && childDocs.length === 2 && childDocs.every((c) => c.handleStatus === 2 && String(c.handleRet?.content || '').trim().length > 0)

    // ② 直接派发 finalize task（内存对象，不投 Kafka；步骤 B 才接 updateParent）
    const synthesisMessageCode = randomUUID()
    const finTask = {
        agentCode: `fin-${rootCode}`, handleStatus: 0, handler: 'fanOutFinalizeTask', agentRole: 'finalize',
        conversationCode, operator: { userCode },
        params: { rootCode, originalQuery: '2+3 等于几？天空什么颜色？', channel: 'micro_common', protocol: 2, synthesisMessageCode, execOptionsExtra: SYNTH_EXTRA },
    }
    const t0 = Date.now()
    const finRet = await execAgentTask(finTask)
    out.finalize = { durMs: Date.now() - t0, handleStatus: finRet.handleStatus, action: finRet.handleRet?.orchestration?.action, needSynthesis: finRet.handleRet?.orchestration?.dispatch?.needSynthesis, usable: finRet.handleRet?.synthesis?.usable }
    V['② finalize 判 synthesize 并成功收尾(2)'] = finRet.handleStatus === 2
        && finRet.handleRet?.orchestration?.action === 'synthesize' && finRet.handleRet?.orchestration?.dispatch?.needSynthesis === true
    V['③ root.handleRet.orchestration 写回齐(counts/credits/dispatch)'] = !!finRet.handleRet?.orchestration?.counts

    // ④ synthesis 真落 root 隔离会话
    const synthDoc = await messageDac.getByCode(synthesisMessageCode)
    out.synthesis = synthDoc && { progress: synthDoc.progress, conv: synthDoc.conversationCode, len: String(synthDoc.answer || '').length, head: String(synthDoc.answer || '').slice(0, 50) }
    V['④ synthesis 真落 root:<rootCode> 会话(finish+正文)'] = !!synthDoc && synthDoc.progress === 'finish'
        && synthDoc.conversationCode === `root:${rootCode}` && String(synthDoc.answer || '').trim().length > 0

    // ⑤ 综合不回填用户聊天线：用户会话里不能出现这条 synthesis message
    const userSide = await messageDac.getByCode(synthesisMessageCode)
    V['⑤ 用户会话线不含综合(落 root 语义)'] = !!userSide && userSide.conversationCode !== conversationCode

    // ⑥ root 库内状态同步终态
    const finalRoot = await agentTaskDac.getByCode(rootCode)
    V['⑥ root 库内 handleStatus=2 + synthesis 指针 usable'] = finalRoot.handleStatus === 2
        && finalRoot.handleRet?.synthesis?.usable === true && finalRoot.handleRet?.synthesis?.messageCode === synthesisMessageCode

    // ⑦ finalize task 本身不落库（内存派发，root 才是写回对象）
    V['⑦ finalize task 未意外落库(0 行 update 无害)'] = !(await agentTaskDac.getByCode(`fin-${rootCode}`))
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据只到 ${ran}/${EXPECTED})` : allTrue ? 'finalize+synthesis 端到端通过(真跑)' : '未通(见 false 项)'
console.log('\n==== FANOUT-FINALIZE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))

process.exit(allTrue ? 0 : 2)
