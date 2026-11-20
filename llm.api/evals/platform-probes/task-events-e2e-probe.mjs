/**
 * @fileOverview 任务事件直播镜像端到端取证（M1-c 刀 1，2026-11-20）
 * @module evals/platform-probes/task-events-e2e-probe
 * @description
 * 真 redis（专用客户端 db12）+ 剧本中继的编排全链：受理段、child 终局、finalize 段尾
 * 都真发射、真落账、真回放。判据：
 *   E1 受理段：task_queued + subtask_spawned（subtasks 带 agentCode——zip 自 plan.subtasks）；
 *   E2 child 里程碑：subtask_done×2（usable 是构造器补的账读数，不是猜测）；
 *   E3 段尾：arbitration(action=synthesize) + __end__ 段界；
 *   E4 游标增量：从头读到段界为止；末条 id 之后增量读=空窗（reason empty）；
 *   E5 隔离实证：事件键在 db12（XRANGE 直连 db10 查不到——D38 分账不是口号）；
 *   E6 清场：探针键删净；
 *   E7~E9（刀 2 订阅面）：真 XREAD BLOCK 的批次回帧/exclusive 游标/段界收口/空窗 timeout
 *   守 waitMs/订阅键清场——BLOCK 语义假件说不上话，必须真机取证。
 * 用法：node evals/platform-probes/task-events-e2e-probe.mjs（本机 src 目录下，需 dev 栈可达）
 */
import { spawn } from 'node:child_process'
import Redis from 'ioredis'

const RELAY_PORT = 13068
const ts = Date.now()
const conv = `tev-${ts}`
const V = {}
const out = {}
const EXPECTED = 9
let relay = null

try {
    process.env.LLM_RELAY_BASE_URL = `http://127.0.0.1:${RELAY_PORT}/v1`
    process.env.agentTask_taskEvents = 'true'
    process.env.agentTask_fanOutPlanner = 'true'

    await import('../../init.js')
    const rc = llm.config.redisConfig
    const ec = llm.config.redisEventConfig
    const {AgentTask, Message, Conversation} = await import('../../daos/core/schema/index.js')
    const {execAgentTask} = await import('../../services/agent/index.js')
    const {taskEventKey} = await import('../../services/core/session/taskEventLog.js')

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-clarify.mjs', `--port=${RELAY_PORT}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))

    // ① 真受理链：planFanOutFromRequest（planner 非流式判定→buildRootTask→addAgentTask→受理段发射）
    const {planFanOutFromRequest} = await import('../../services/agent/fanOutPlannerService.js')
    const planned = await planFanOutFromRequest({
        query: 'TEV 事件探针：分别完成 TEV-A 例行工作与 TEV-B 例行工作',
        conversationCode: conv,
        operator: {userCode: 'menglb', realName: '事件e2e'},
        request: {channel: 'micro_common', protocol: 2},
    })
    if (!planned.fanOut) throw new Error(`planner 没扇出（reason=${planned.reason}）——受理段发射点没走到`)
    const rootCode = planned.rootCode
    // 树执行走 finalize 的 readAllChildren 同款取数（行上带 handler/parentCode 的完整形状）；
    // parallelDispatch(manual) 只返回 subsequents 引用——**行快照没有 parentCode**（format 的
    // 就地改写产物），必须由探针按 DB 行逐 child 派发，否则发射点拿不到 root（e2e 实锤的账形）
    const rootRow = await AgentTask.collection.findOne({agentCode: rootCode})
    await execAgentTask(rootRow)
    const kidRefs = (rootRow.subAgents || []).map((s) => s.agentCode)
    const kidRows = await AgentTask.collection.find({agentCode: {$in: kidRefs}}).toArray()
    await Promise.allSettled(kidRows.map((k) => execAgentTask(k)))
    // children 是 fire-and-forget 并行——等两行真终局再派 finalize（里程碑要在 finalize 之前落账）
    for (let i = 0; i < 60; i++) {
        const kidsNow = await AgentTask.collection.find({agentCodePath: rootCode, handler: 'agentChat'}).toArray()
        if (kidsNow.length >= 2 && kidsNow.every((k) => [2, 3, -1].includes(k.handleStatus))) break
        await new Promise((r) => setTimeout(r, 2000))
    }
    // finalize 显式派发（与 fanout-finalize-e2e 同法；direct 模式 finalize 不经 kafka）
    const finTask = {
        agentCode: `fin-${rootCode}`, handleStatus: 0, handler: 'fanOutFinalizeTask', agentRole: 'finalize',
        conversationCode: conv, operator: {userCode: 'menglb'},
        params: {rootCode, originalQuery: 'TEV 事件探针', channel: 'micro_common', protocol: 2},
    }
    await execAgentTask(finTask)

    // 读账（专用客户端参数，显式 db）
    const key = taskEventKey(rootCode)
    const ev = new Redis({host: rc.host, port: rc.port, username: rc.username, password: rc.password, db: ec.db})
    const raw = await ev.xrange(key, '-', '+')
    const flat = raw.map(([id, f]) => {
        const o = {}
        for (let i = 0; i < f.length; i += 2) o[f[i]] = f[i + 1]
        return {id, type: o.type, data: o.data}
    })
    const types = flat.map((x) => x.type)
    out.账 = {key, n: flat.length, types}

    V['E1 受理段：task_queued+subtask_spawned（subtasks 带 agentCode）'] = (() => {
        const sp = flat.find((x) => x.type === 'subtask_spawned')
        if (!types.includes('task_queued') || !sp) return false
        const p = JSON.parse(sp.data)
        return Array.isArray(p.subtasks) && p.subtasks.length === 2 && p.subtasks.every((s) => s.agentCode)
    })()

    V['E2 child 里程碑：subtask_done×2 且 usable 字段在账'] = (() => {
        const dones = flat.filter((x) => x.type === 'subtask_done')
        return dones.length === 2 && dones.every((d) => 'usable' in JSON.parse(d.data))
    })()

    V['E3 段尾：arbitration(synthesize) + __end__ 收口'] = (() => {
        const arb = flat.find((x) => x.type === 'arbitration')
        const end = flat.find((x) => x.type === '__end__')
        return arb && JSON.parse(arb.data).action === 'synthesize' && end && end.data === 'synthesize'
    })()

    V['E4 游标增量：末条 id 之后=空窗（段界后无新段）'] = await (async () => {
        const lastId = flat[flat.length - 1]?.id
        const r = await ev.xrange(key, `(${lastId}`, '+')
        return r.length === 0
    })()

    V['E5 隔离实证：同一键在 cache db10 查不到（事件与缓存分账，D38 不是口号）'] = await (async () => {
        const c10 = new Redis({host: rc.host, port: rc.port, username: rc.username, password: rc.password, db: rc.db})
        const r = await c10.xrange(key, '-', '+')
        await c10.quit()
        return r.length === 0
    })()

    await ev.del(key)
    const residual = await ev.xrange(key, '-', '+')
    V['E6 清场：探针键删净'] = residual.length === 0

    // ── 刀 2：订阅面（waitTaskEventLog）在真 redis 的全语义——e2e 只跑过回放件，
    // XREAD BLOCK 的游标 exclusive/BLOCK 超时/段界收口必须真机取证（假件说不上话）
    const {waitTaskEventLog, createTaskEventMirror} = await import('../../services/core/session/taskEventLog.js')
    const subKey = taskEventKey(`sub-${ts}`)
    const mSub = createTaskEventMirror({getClient: async () => ev, rootCode: `sub-${ts}`})
    await mSub.emit({type: 'task_queued', probe: true})
    await mSub.emit({type: 'subtask_spawned', subtasks: [{agentCode: 'a'}]})
    const t0 = Date.now()
    const s1 = await waitTaskEventLog({getClient: async () => ev, rootCode: `sub-${ts}`, waitMs: 3000, count: 10})
    V['E7 订阅全链：XREAD BLOCK 立刻回两帧、exclusive 游标只回新帧、段界收口 end 不混段'] = await (async () => {
        const okBatch = s1.reason === 'ok' && s1.events.map((e) => e.type).join() === 'task_queued,subtask_spawned'
        const lastId = s1.events[s1.events.length - 1].id
        const m2 = createTaskEventMirror({getClient: async () => ev, rootCode: `sub-${ts}`})
        await m2.emit({type: 'arbitration'})
        await m2.finish({outcome: 'done'})
        const s2 = await waitTaskEventLog({getClient: async () => ev, rootCode: `sub-${ts}`, afterId: lastId, waitMs: 3000})
        const onlyNew = s2.reason === 'ok' && s2.events.map((e) => e.type).join() === 'arbitration'
        const segEnd = s2.end && s2.end.outcome === 'done'
        // 段界后续读：游标停在 __end__ 之后 ⇒ 恒空窗（下一段不混进本段直播）
        const s3 = await waitTaskEventLog({getClient: async () => ev, rootCode: `sub-${ts}`, afterId: s2.end.id, waitMs: 300})
        return okBatch && onlyNew && segEnd && s3.reason === 'timeout'
    })()
    V['E8 空窗挂起守 waitMs：timeout 形且耗时在 waitMs 带内（长轮询节奏真实存在）'] = (() => {
        const dt = Date.now() - t0
        // s1 应几乎即时（有帧），整段到现在远小于一次 3000 的挂起；空窗 s3 应 ≈300ms 级
        return s1.reason === 'ok' && dt < 3000
    })()
    await ev.del(subKey)
    V['E9 订阅键清场'] = (await ev.xrange(subKey, '-', '+')).length === 0
    await ev.quit()

    // 清任务账
    const codes = (await AgentTask.collection.find({agentCodePath: rootCode}).toArray()).map((r) => r.agentCode)
    codes.push(rootCode, finTask.agentCode)
    await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
    await Message.collection.deleteMany({conversationCode: {$in: [conv, `root:${rootCode}`, ...codes.map((c) => `agent:${c}`)]}})
    await Conversation.collection.deleteMany({conversationCode: conv})
    out.清账 = {codes: codes.length}
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    if (relay && !relay.killed) relay.kill()
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '任务事件直播 e2e 通过(回放 6 项+订阅 3 项)' : '未通(见 false 项)'
console.log('\n==== TASK-EVENTS E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
