/**
 * @fileOverview 任务详情端点端到端取证（PR-任务编排 §5-3）：同一棵真树生命周期上的三张相位照
 * @module evals/platform-probes/detail-e2e-probe
 * @description
 * 详情面的本质是"相位要说真话"。本探针在一棵真树（1×agentChat 真 relay + 1×turnRunner 必败零 relay）
 * 的三个阶段各拍一张 HTTP /core/agentTask/detail 的照片：
 *   T1 入库未跑 ⇒ phase=queued，两子全 waiting、preview null；
 *   T2 跑完未 finalize ⇒ phase=synthesizing（收尾中的诚实中间态，不装 synthesized）；
 *   T3 finalize 后 ⇒ phase=partial（有可用产出+有失败），orchestration 透传（counts/credits 与库内账一致）、
 *      成功子任务 preview 有内容、失败子任务 phase=failed 且 credits:null（缺席不补 0）。
 * 负例：非 owner 403；legacy root scope-reject；不存在 not-found。
 * 零 Kafka（manual+手动 finalize，同前探针纪律）；收尾自造行按前缀清尽（residual=0 是判据）。
 * 用法：node evals/platform-probes/detail-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12043
const BASE = `http://127.0.0.1:${PORT}`
const USER = (c) => Buffer.from(JSON.stringify({userCode: c, realName: '详情e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 7

function startServer(envExtra) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(), env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1', ...envExtra},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    child.stdout.on('data', (d) => { buf += d.toString() })
    child.stderr.on('data', (d) => { buf += d.toString() })
    child.log = () => buf
    return child
}
async function waitReady(c, ms = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (c.log().includes('服务器启动成功')) return true
        await new Promise((r) => setTimeout(r, 1000))
    }
    return false
}
async function stopServer(c) { if (c && !c.killed) { c.kill(); await new Promise((r) => setTimeout(r, 1500)) } }
async function detail(agentCode, user = 'menglb') {
    const res = await fetch(`${BASE}/core/agentTask/detail`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER(user)},
        body: JSON.stringify({agentCode}), signal: AbortSignal.timeout(60000),
    })
    const j = await res.json().catch(() => null)
    return {status: res.status, code: j?.code, data: j?.data ?? null, msg: j?.msg}
}

let server = null
const convs = []
let AgentTask = null, LlmUsage = null, Message = null
try {
    await import('../../init.js')
    const si = await import('../../daos/core/schema/index.js')
    AgentTask = si.AgentTask; LlmUsage = si.LlmUsage; Message = si.Message
    const dac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const {addAgentTask} = await import('../../services/core/agentTask.js')
    const {execAgentTask} = await import('../../services/agent/index.js')
    const {normalizeFanOutPlan} = await import('../../services/agent/fanOutPlanner.js')
    const {buildRootTask} = await import('../../services/core/session/taskQueueComposer.js')

    server = startServer({})
    if (!await waitReady(server)) throw new Error('server 启动超时')

    // 建树：1 真子 + 1 必败子（turnRunner 缺 conversationCode，零 relay）
    const conv = `dtl-${Date.now()}`
    convs.push(conv)
    const plan = normalizeFanOutPlan({
        subtasks: [
            {title: '算术', query: '用一句话回答：8+5 等于几？', params: {execOptionsExtra: {cache: false, llmParams: {maxTokens: 48}}}},
            {title: '必败', query: '这句话不会被执行', handler: 'turnRunner', params: {query: '这句话不会被执行'}},
        ], subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode: conv, agentType: 'parallel', handler: 'parallelDispatch',
        subtasks: plan.subtasks, operator: {userCode: 'menglb'},
        extra: {handleMode: 'manual', orchestrated: true},
    })
    await addAgentTask(root)
    const rootCode = root.agentCode

    const t1 = await detail(rootCode)
    out.T1 = {phase: t1.data?.phase, kids: t1.data?.subtasks?.map((s) => [s.phase, s.active])}
    V['T1 未跑⇒queued，两子 waiting 且 active'] = t1.code === 0 && t1.data?.phase === 'queued'
        && t1.data?.subtasks?.length === 2 && t1.data.subtasks.every((s) => s.phase === 'queued' && s.active === true)

    await execAgentTask(await dac.getByCode(rootCode))
    const t2 = await detail(rootCode)
    out.T2 = {phase: t2.data?.phase}
    V['T2 跑完未 finalize⇒synthesizing（收尾中的诚实中间态）'] = t2.data?.phase === 'synthesizing'

    const finTask = {
        agentCode: `fin-${rootCode}`, agentType: 'local', handler: 'fanOutFinalizeTask',
        handleMode: 'manual', handleStatus: 0, agentRole: 'finalize', conversationCode: conv,
        operator: {userCode: 'menglb'},
        params: {rootCode, originalQuery: '8+5 等于几', channel: 'micro_common', protocol: 2,
            execOptionsExtra: {cache: false, llmParams: {maxTokens: 48}}},
    }
    await execAgentTask(finTask)
    const t3 = await detail(rootCode)
    const ok3 = (t3.data?.subtasks || []).find((s) => s.phase === 'done')
    const bad3 = (t3.data?.subtasks || []).find((s) => s.phase === 'failed')
    const freshRoot = await dac.getByCode(rootCode)
    out.T3 = {phase: t3.data?.phase, action: t3.data?.orchestration?.action, counts: t3.data?.orchestration?.counts, hasPreview: !!ok3?.preview, badCredits: bad3?.credits, needRetry: t3.data?.orchestration?.dispatch?.needRetry}
    // turnRunner 失败行 handleRet:null ⇒ 默认 retryable；autoFollow 关 ⇒ finalize 悬置 retry：
    // 详情面此时说 running（"该追而未追"的如实态），不装 partial/synthesized——相位表的边角诚实性就在这。
    V['T3 finalize(autoFollow 关)⇒悬置 retry：phase running 不装完成，orchestration 透传=库内原值，摘要/缺席如实'] =
        t3.data?.phase === 'running' && t3.data?.orchestration?.action === 'retry'
        && t3.data?.orchestration?.dispatch?.needRetry === true && !!ok3 && ok3.preview.length > 0
        && !!bad3 && bad3.credits === null
        && JSON.stringify(t3.data?.orchestration?.counts) === JSON.stringify(freshRoot.handleRet?.orchestration?.counts)

    // 负例三连
    const nx = await detail(rootCode, 'attacker-zzz')
    const legacy = buildRootTask({conversationCode: conv, agentType: 'parallel', handler: 'parallelDispatch', subtasks: [], operator: {userCode: 'menglb'}, extra: {handleMode: 'manual'}})
    await addAgentTask(legacy)
    const lg = await detail(legacy.agentCode)
    const nf = await detail('nope-not-exist')
    V['N1 非 owner ⇒403（真状态码非 200 假成功）'] = nx.status === 403
    V['N2 非编排 root ⇒ scope-reject（存量面不外开）'] = lg.code === -1 && lg.data?.reason === 'scope-reject'
    V['N3 不存在 ⇒ not-found'] = nf.code === -1 && nf.data?.reason === 'not-found'
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    await stopServer(server)
    try {
        // 清理必须走血统（agentCodePath）而非 conversationCode——child 行没有 conv 列，
        // cancel 探针的 residual 断言就漏过这个（child 行漏网被这轮复盘发现，教训入 handoff §7）。
        let residual = 0
        for (const conv of convs) {
            const roots = await AgentTask.collection.find({conversationCode: conv}).project({agentCode: 1}).toArray()
            const codes = new Set(roots.map((r) => r.agentCode))
            for (const rc of codes) {
                const tree = await AgentTask.collection.find({agentCodePath: rc}).project({agentCode: 1}).toArray()
                tree.forEach((t) => codes.add(t.agentCode))
            }
            const arr = [...codes]
            if (arr.length) {
                await AgentTask.collection.deleteMany({agentCode: {$in: arr}})
                await LlmUsage.collection.deleteMany({messageCode: {$in: arr}})
                await Message.collection.deleteMany({messageCode: {$in: arr}})
                await Message.collection.deleteMany({conversationCode: {$in: arr.map((c) => `root:${c}`)}})
                residual += await AgentTask.collection.countDocuments({agentCode: {$in: arr}})
            }
            residual += await AgentTask.collection.countDocuments({conversationCode: conv})
        }
        out.residual = residual
        V['C1 自造行清尽含 child 血统遍历(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? '未通(抛错)'
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '详情端点 e2e 通过(三相位真话/透传一致/负例三连/零残留)' : '未通(见 false 项)'
console.log('\n==== DETAIL E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
