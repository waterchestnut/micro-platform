/**
 * @fileOverview §7-3 预算降级事件端到端取证（budget_degraded 实发，2026-11-20）
 * @module evals/platform-probes/budget-degraded-e2e-probe
 * @description
 * 单测钉了判据（worthy 白名单/budgetNote 留痕/budgetStop 形态），本探针钉**接合**：
 * finalize 接线位真读 config 的预算参数、budgetGate 真拒、事件账真落 budget_degraded。
 *
 * 形态（两棵树各一发 relay，零 token 赌局）：
 *   T1 闸停树：ceiling=1 + 1 真成功 + 1 确定性必败（turnRunner 缺会话零 relay 失败）
 *     ⇒ 首轮 budgetGate over-ceiling 必停 ⇒ budgetStop 留账 + 事件实发
 *     budget_degraded(degrade=single-agent, reason=over-ceiling) + 无 retry spawn +
 *     report(3) 如实收口 + 段序（降级帧在 __end__ 前）。
 *   T2 对照树：ceiling 缺省(1M) + 两真成功 ⇒ 无闸停 ⇒ 事件账**无** budget_degraded
 *     （归因对照：降级帧是闸停专属，不是镜像的默认噪音）。
 * 阶段切换进程内直改 llm.config（cfg 解析归 conf 单测，本探针测行为接合）。
 * B1 自动派发必须关（enabled=false）：自动+手派双 finalize 并发会把 execChat 堆到
 * 同一会话——本轮首版双阶段探针 OOM 的实锤教训（对照用轻树形不为竞态买单）。
 * 边界如实：budgetNote（replan 预算拒）形需 planner 真给 budget:* 拒话，dev 自然流量
 * 留观察；本探针覆盖 budgetStop 主形态，budgetNote 由单测留痕钉死。
 * 用法：node evals/platform-probes/budget-degraded-e2e-probe.mjs（本机 src 目录下）
 */
import Redis from 'ioredis'

process.env.agentTask_taskEvents = 'true'
process.env.agentTask_fanOutPlanner = 'true'

await import('../../init.js')
const { execAgentTask } = await import('../../services/agent/index.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')
const { taskEventKey } = await import('../../services/core/session/taskEventLog.js')

// B1 自动派发关（双 finalize 竞态红线，见文件头 OOM 教训）；autoFollow 按阶段进程内切
const orch = llm.config.agentTask.fanOutOrchestration
orch.enabled = false
orch.autoFollow = true

const userCode = 'menglb'
const CHILD_EXTRA = { cache: false, llmParams: { maxTokens: 48 } }
const V = {}
const out = { phases: {} }
const EXPECTED = 4

async function runTree(tag, subtasks) {
    const conversationCode = `budprobe-${tag}-${Date.now()}`
    const plan = normalizeFanOutPlan({ subtasks, subtaskCeiling: 4 })
    const root = buildRootTask({
        conversationCode, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: { userCode },
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    // manual 根 execAgentTask 同步到全树终态（parallelDispatch 进程内等待），随后直派 finalize
    await execAgentTask(await agentTaskDac.getByCode(root.agentCode))
    const finTask = {
        agentCode: `fin-${root.agentCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode, operator: { userCode },
        params: { rootCode: root.agentCode, originalQuery: '6+7 等于几（预算降级试验树）', channel: 'micro_common', protocol: 2, execOptionsExtra: CHILD_EXTRA },
    }
    await execAgentTask(finTask)
    const finalRoot = await agentTaskDac.getByCode(root.agentCode)
    return { rootCode: root.agentCode, conversationCode, finalRoot }
}

async function readEvents(ev, rootCode) {
    const raw = await ev.xrange(taskEventKey(rootCode), '-', '+')
    return raw.map(([id, flat]) => {
        const o = {}
        for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1]
        return { id, type: o.type, data: o.data }
    })
}

const created = []
let ev = null
try {
    const rc = llm.config.redisConfig
    const ec = llm.config.redisEventConfig || {}
    ev = new Redis({ host: rc.host, port: rc.port, username: rc.username, password: rc.password, db: Number.isFinite(ec.db) ? ec.db : 12 })

    // ── T1 闸停树：ceiling=1 ⇒ 首轮 budgetGate over-ceiling 必停
    const plannerSec = llm.config.agentTask.fanOutPlanner
    plannerSec.rootTokenCeiling = 1
    const t1 = await runTree('gate', [
        { title: '算术(成)', query: '用一句话回答：6+7 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
        { title: '必败槽', handler: 'turnRunner', query: '这句话永远不会被执行', params: { query: '这句话永远不会被执行' } },
    ])
    created.push(t1)
    const e1 = await readEvents(ev, t1.rootCode)
    const types1 = e1.map((e) => e.type)
    const deg1 = e1.filter((e) => e.type === 'budget_degraded')
    const o1 = t1.finalRoot?.handleRet?.orchestration || {}
    V['B1 闸停实发：budgetStop 留账 + 事件 budget_degraded(degrade/reason 真话)'] =
        !!o1.follow?.budgetStop && deg1.length === 1 &&
        JSON.parse(deg1[0].data).degrade === 'single-agent' &&
        /over-ceiling|no-headroom/.test(String(JSON.parse(deg1[0].data).reason))
    V['B2 闸停行为面：无 retry spawn + report(3) 如实收口（预算裸奔重试被掐死）'] =
        (o1.follow?.spawned ?? 0) === 0 && o1.action === 'report' && t1.finalRoot?.handleStatus === 3
    V['B4 段序纪律：降级帧在段界 __end__ 之前（结束后不追加）'] = (() => {
        const ei = types1.indexOf('budget_degraded')
        const xi = types1.indexOf('__end__')
        return ei >= 0 && xi >= 0 && ei < xi
    })()
    out.phases.T1 = { types: types1, deg: deg1[0] ? JSON.parse(deg1[0].data) : null, follow: o1.follow, status: t1.finalRoot?.handleStatus }

    // ── T2 对照树：ceiling 缺省 ⇒ 无闸停 ⇒ 账上无降级帧（归因：事件是闸停专属不是默认噪音）
    delete plannerSec.rootTokenCeiling
    const t2 = await runTree('plain', [
        { title: '算术一', query: '用一句话回答：1+1 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
        { title: '算术二', query: '用一句话回答：2+2 等于几？', params: { execOptionsExtra: CHILD_EXTRA } },
    ])
    created.push(t2)
    const e2 = await readEvents(ev, t2.rootCode)
    V['B3 对照归因：无闸停树的事件账不含 budget_degraded'] =
        e2.filter((e) => e.type === 'budget_degraded').length === 0 && e2.length > 0
    out.phases.T2 = { types: e2.map((e) => e.type), status: t2.finalRoot?.handleStatus }
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
} finally {
    for (const { rootCode } of created) {
        try { await ev.del(taskEventKey(rootCode)) } catch { /* 键清失败不掩读数 */ }
    }
    if (ev) ev.disconnect()
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '§7-3 预算降级事件实发实止（闸停留痕/行为掐死/段序合规/对照归因）' : '未通(见 false 项)'
console.log('\n==== BUDGET-DEGRADED E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
