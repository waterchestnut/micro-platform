/**
 * @fileOverview 澄清冒泡端到端取证（§7-1，属主拍板③，2026-11-19）
 * @module evals/platform-probes/clarify-bubble-e2e-probe
 * @description
 * 链路：种真树（addAgentTask 全形状）→ 探针进程跑 child+finalize（假中继剧本）→
 * **HTTP 真打 /core/agentTask/clarifyAnswer**（spawn 的 server 里重派 child+finalize）→
 * root 走到 synthesize。判据全部是账读数与中继观测，零真 token：
 *   K0 child 首跑：request_clarification 在 tools 声明面（中继读数）；
 *   K1 child A 终局行带 handleRet.clarify（问题+选项原样）；child B 无申报照常 2；
 *   K2 finalize 截胡：root handleStatus=1（非终态）+ orchestration.action='await-input'
 *      + params.clarifyHold.requests 恰 1 条；**synthesis 没有发生**（没有 root: 档案）；
 *   K3 /clarifyAnswer HTTP 200 code:0，requeued=[childA]、stillWaiting=[]；
 *   K4 child A 重跑：params.clarifyRound=1、query 带【澄清补充】段、终局正文是 R2 剧本
 *      （中继没再发申报=不二次挂树的直接证据）；root.clarifyAnswered 含 childA；
 *   K5 finalize 重算（server 里）：root=2、action synthesize、synthesis.usable、hold 清空；
 *   C1 全账清尽。
 * 用法：node evals/platform-probes/clarify-bubble-e2e-probe.mjs（本机 src 目录下，需 dev 栈可达）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

const PORT = 12051
const RELAY_PORT = 13064
const BASE = `http://127.0.0.1:${PORT}`
const OBS = `${process.env.TEMP || '/tmp'}\\clarify-obs.json`
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '澄清冒泡e2e'})).toString('base64')
const ts = Date.now()
const conv = `clarify-probe-${ts}`
const V = {}
const out = {}
const EXPECTED = 7
let relay = null
let server = null

// env 必须先于 init（探针进程的 relay 指向与开关）
process.env.LLM_RELAY_BASE_URL = `http://127.0.0.1:${RELAY_PORT}/v1`
process.env.agentTask_clarifyBubble = 'true'
try { fs.rmSync(OBS, {force: true}) } catch { /* 不存在最好 */ }

try {
    await import('../../init.js')
    const { execAgentTask } = await import('../../services/agent/index.js')
    const { addAgentTask } = await import('../../services/core/agentTask.js')
    const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const { Message } = await import('../../daos/core/schema/index.js')
    const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
    const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-clarify.mjs', `--port=${RELAY_PORT}`, `--observe=${OBS}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1',
            LLM_RELAY_BASE_URL: `http://127.0.0.1:${RELAY_PORT}/v1`,
            agentTask_clarifyBubble: 'true', cron_pumpEnabled: 'false',
            // 答复后的收尾重算走聚合钩子（await-input 例外放行）——钩子与派发模式必须在本环境成立
            agentTask_fanOutOrchestration: 'true', agentTask_fanOutOrchestrationDispatch: 'direct' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    server.stdout.on('data', (d) => { buf += d.toString() })
    server.stderr.on('data', (d) => { buf += d.toString() })
    const t0 = Date.now()
    while (!buf.includes('服务器启动成功')) {
        if (Date.now() - t0 > 90000) throw new Error('server 启动超时: ' + buf.slice(-300))
        await new Promise((r) => setTimeout(r, 1000))
    }

    // ① 种真树并跑（CHATA 申报、CHATB 正常）
    const plan = normalizeFanOutPlan({
        subtasks: [
            { title: '甲', query: 'CLARIFY-TREE-CHATA 部署方案调研', params: { execOptionsExtra: { cache: false, llmParams: { maxTokens: 64 } } } },
            { title: '乙', query: 'CLARIFY-TREE-CHATB 例行检查', params: { execOptionsExtra: { cache: false, llmParams: { maxTokens: 64 } } } },
        ],
        subtaskCeiling: 4,
    })
    const root = buildRootTask({
        conversationCode: conv,
        query: 'CLARIFY-TREE 澄清冒泡探针',
        agentType: 'parallel', handler: 'parallelDispatch', subtasks: plan.subtasks,
        operator: { userCode: 'menglb', realName: '澄清冒泡e2e' },
        // orchestrated:true 是编排面（detail/cancel/clarifyAnswer）的收窄门，fanOutPlannerService 同形
        extra: { handleMode: 'manual', orchestrated: true },
    })
    await addAgentTask(root)
    const rootCode = root.agentCode
    await execAgentTask(await agentTaskDac.getByCode(rootCode))
    const tree = await agentTaskDac.getByCode(rootCode)
    const kids = await Promise.all((tree.subAgents || []).map((s) => agentTaskDac.getByCode(s.agentCode)))
    const kidA = kids.find((c) => (c.params?.query || '').includes('CHATA'))
    const kidB = kids.find((c) => (c.params?.query || '').includes('CHATB'))

    const obs1 = JSON.parse(fs.readFileSync(OBS, 'utf8'))
    out.K0 = {declared: obs1.childAToolDeclared}
    V['K0 child 首跑：request_clarification 在 tools 声明面'] = obs1.childAToolDeclared === true

    out.K1 = {
        a: {s: kidA?.handleStatus, q: kidA?.handleRet?.clarify?.question, opts: kidA?.handleRet?.clarify?.options, n: kidA?.handleRet?.clarify?.count},
        b: {s: kidB?.handleStatus, hasClarify: !!kidB?.handleRet?.clarify},
    }
    V['K1 A 终局带申报(2+question+options)；B 无申报照常 2'] =
        kidA?.handleStatus === 2 && kidA?.handleRet?.clarify?.question === '部署到哪个环境？'
        && kidA?.handleRet?.clarify?.options?.length === 2 && String(kidA?.handleRet?.content || '').includes('CHATA-R1-')
        && kidB?.handleStatus === 2 && !kidB?.handleRet?.clarify

    // ② finalize 截胡（探针进程直接派发，与 fanout-finalize-e2e 同法）
    const finTask = {
        agentCode: `fin-${rootCode}`, handleStatus: 0, handler: 'fanOutFinalizeTask', agentRole: 'finalize',
        conversationCode: conv, operator: { userCode: 'menglb' },
        params: { rootCode, originalQuery: 'CLARIFY-TREE 澄清冒泡探针', channel: 'micro_common', protocol: 2 },
    }
    const finRet = await execAgentTask(finTask)
    const held = await agentTaskDac.getByCode(rootCode)
    const synthAny = await Message.collection.findOne({ conversationCode: `root:${rootCode}` })
    out.K2 = { fin: {s: finRet.handleStatus, awaited: finRet.handleRet?.awaited, note: String(finRet.errorMsg || '').slice(0, 120)}, rootStatus: held.handleStatus, action: held.handleRet?.orchestration?.action, holdN: held.params?.clarifyHold?.requests?.length, synthArchived: !!synthAny }
    V['K2 await 截胡：root=1 非终态 + await-input + hold=1 + 综合没有发生'] =
        held.handleStatus === 1 && held.handleRet?.orchestration?.action === 'await-input'
        && held.params?.clarifyHold?.requests?.length === 1 && !synthAny

    // ③ HTTP 真打答复端点
    const ansRes = await fetch(`${BASE}/core/agentTask/clarifyAnswer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-info': USER },
        body: JSON.stringify({ agentCode: rootCode, answers: [{ agentCode: kidA.agentCode, response: '用生产环境，窗口周五' }] }),
        signal: AbortSignal.timeout(30000),
    })
    const ansJson = await ansRes.json()
    out.K3 = { status: ansRes.status, body: JSON.stringify(ansJson).slice(0, 220) }
    V['K3 /clarifyAnswer 200+code0+requeued=[A]+stillWaiting 空'] =
        ansRes.status === 200 && ansJson.code === 0 && ansJson.data?.requeued?.length === 1
        && ansJson.data.requeued[0] === kidA.agentCode && (ansJson.data?.stillWaiting || []).length === 0

    // ④⑤ 重跑与 finalize 重算都在 server 进程 fire-and-forget——轮询账等到终态
    let done = null
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        done = await agentTaskDac.getByCode(rootCode)
        if (done.handleStatus === 2 && done.handleRet?.orchestration?.action === 'synthesize') break
    }
    const kidA2 = await agentTaskDac.getByCode(kidA.agentCode)
    out.K4 = {
        round: kidA2.params?.clarifyRound, s: kidA2.handleStatus,
        queryHasSupplement: String(kidA2.params?.query || '').includes('澄清补充'),
        content: String(kidA2.handleRet?.content || '').slice(0, 60),
        answered: (done.params?.clarifyAnswered || []).includes(kidA.agentCode),
    }
    V['K4 重跑带补充(轮1+注入段+R2 正文+answered 在账)'] =
        kidA2.params?.clarifyRound === 1 && kidA2.handleStatus === 2 && out.K4.queryHasSupplement
        && String(kidA2.handleRet?.content || '').includes('CHATA-R2-') && out.K4.answered === true

    out.K5 = {
        rootStatus: done.handleStatus, action: done.handleRet?.orchestration?.action,
        usable: done.handleRet?.synthesis?.usable, holdLeft: done.params?.clarifyHold?.requests?.length ?? 0,
    }
    V['K5 finalize 重算走综合：root=2 synthesize usable hold 清空'] =
        done.handleStatus === 2 && done.handleRet?.orchestration?.action === 'synthesize'
        && done.handleRet?.synthesis?.usable === true && out.K5.holdLeft === 0

    // C1 清账
    const codes = (await agentTaskDac.getTop(64, { complexFilter: { agentCodePath: rootCode } })).map((r) => r.agentCode)
    codes.push(rootCode, finTask.agentCode)
    await Message.collection.deleteMany({ conversationCode: { $in: [conv, `root:${rootCode}`, ...(kids.map((k) => `agent:${k.agentCode}`))] } })
    await (await import('../../daos/core/schema/index.js')).Conversation.collection.deleteMany({ conversationCode: conv }).catch(() => {})
    const { AgentTask } = await import('../../daos/core/schema/index.js')
    await AgentTask.collection.deleteMany({ agentCode: { $in: codes } })
    const residual = await AgentTask.collection.countDocuments({ agentCode: { $in: codes } })
        + await Message.collection.countDocuments({ conversationCode: { $in: [conv, `root:${rootCode}`] } })
    out.C1 = { residual }
    V['C1 收尾清尽(residual=0)'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    if (server && !server.killed) server.kill()
    if (relay && !relay.killed) relay.kill()
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '澄清冒泡 e2e 通过(声明/截胡/答复/重跑/综合/清尽)' : '未通(见 false 项)'
console.log('\n==== CLARIFY-BUBBLE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
