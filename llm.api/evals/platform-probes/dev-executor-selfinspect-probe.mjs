/**
 * @fileOverview B3 值班面探针：经 kafka 投递 taskSelfInspect 任务，直读 executor 进程的配置真形
 * @module evals/platform-probes/dev-executor-selfinspect-probe
 * @description
 * 补 runStats 的进程盲区：http 面只报自己，executor（finalize/追活真正落点）此前只能靠
 * 行为树反证。本探针落一行 `{handler:'taskSelfInspect', handleMode:'queue'}` → dev executor
 * 的 agent-task consumer 消费 → 轮询 handleRet 读回**该进程**的编排开关快照（白名单只读，
 * 零副作用零敏感键）。跑完删行清账。EXPECTED=4。
 */
import fs from 'node:fs'
const token = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const GW = 'https://api.xxzx.paretop.net/llm'
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: 'B3自省探针' })).toString('base64')
const H = { 'content-type': 'application/json', 'user-info': USER, 'param-accessToken': token }

await import('../../init.js')
const { addAgentTask } = await import('../../services/core/agentTask.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const { AgentTask } = await import('../../daos/core/schema/index.js')

const out = {}
const V = {}
const ts = Date.now()
const agentCode = `siprobe-${ts}`
const conversationCode = `siprobe-${ts}`
try {
    // 1) 落 queue 行（addAgentTask 自动投 agent-task topic——dev executor 消费）
    await addAgentTask({
        agentCode, agentType: 'local', handler: 'taskSelfInspect',
        handleMode: 'queue', handleStatus: 0, conversationCode,
        operator: { userCode: 'menglb', realName: 'B3自省探针' },
        params: {},
    })
    out.submitted = agentCode
    // 2) 轮询 handleRet（consumer 写回）
    let row = null
    for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        row = await agentTaskDac.getByCode(agentCode)
        if (row && (row.handleStatus === 2 || row.handleStatus === -1)) break
    }
    const si = row?.handleRet?.selfInspect
    out.row = { st: row?.handleStatus, entry: si?.entry, orchestration: si?.orchestration, taskEvents: si?.taskEvents, limits: si?.limits, planner: si?.planner, creditsPriced: si?.creditsPriced, at: si?.at, pid: si?.pid }
    V['X1 executor 消费并回执（终态 2 + selfInspect 在账 + 入口是 executor）'] =
        row?.handleStatus === 2 && !!si && /agentTaskExecutor|consumer/i.test(String(si.entry || ''))
    V['X2 executor 进程 layered+autoFollow+enabled 全 true（批⑦⑧真落 Pod，非 http 面旁证）'] =
        si?.orchestration?.layered === true && si?.orchestration?.autoFollow === true && si?.orchestration?.enabled === true
    V['X3 白名单形状：无敏感键（回显 JSON 里出现不了 key/uri/password/token）'] =
        !/api[_-]?key|password|token|uri["']?\s*:/i.test(JSON.stringify(si || {}))
    out.snapshotFull = JSON.stringify(si || {}).length
} catch (e) {
    out.error = String(e?.message || e).slice(0, 300)
}
// 3) 清账（行 + 会话档案）
try {
    await AgentTask.deleteMany({ agentCode })
    const { Message, Conversation } = await import('../../daos/core/schema/index.js')
    await Message.deleteMany({ conversationCode }).catch(() => {})
    await Conversation.deleteMany({ conversationCode }).catch(() => {})
    out.residual = await AgentTask.countDocuments({ agentCode })
} catch (e) { out.cleanError = String(e?.message || e).slice(0, 150) }
V['X4 自造行清尽 residual=0'] = out.residual === 0
out.verdict = V
const pass = Object.values(V).filter(Boolean).length
out.结论 = pass === 4 ? 'B3 executor 配置直读通道建立（kafka 投递→自省回执→白名单快照）' : `未全真 ${pass}/4——读数见上（X1 失败先查 consumer 是否在跑）`
console.log(JSON.stringify(out, null, 1))
process.exit(pass === 4 ? 0 : 1)
