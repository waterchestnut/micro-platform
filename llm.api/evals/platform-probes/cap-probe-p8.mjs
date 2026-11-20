/**
 * @fileOverview P-8 容量探针——单 worker 并发 run 的容量曲线（零真 token，假中继）
 * @module evals/platform-probes/cap-probe-p8
 * @description
 * P-8 的账（run-plan §P-8）：并发 run 数 × 事件速率 × Redis QPS × 事件循环延迟 ×
 * 与 redlock 的互相影响（D38 验收同题）。本探针把可自测的部分取全：
 * - **执行链全真**（execChat/agentChat/finalize/镜像/锁都真跑），模型面假中继零 token；
 * - 压测对象=**本进程**（一个 worker 的容量模型）：perf_hooks monitorEventLoopDelay
 *   与 RSS 都在自己口袋里，不隔靴搔痒；
 * 边界如实：HTTP/fastify 面不在本表（那是 Traefik/P-10 观测面）；**SSE 帧镜像
 * （streamResume_redis）的写载也不在本表**——镜像接在 root.js 的 sseChannel 层，
 * 进程内 execChat 不经过它；聊天帧镜像的压测面归 dev 观察（P-8 的 redis QPS 表
 * 已含任务事件镜像与锁面）。2-worker pod 换算按线性+共享 redis 争用项看本表外推；
 * relay 真实配额不在零 token 探针内（另账）。
 * 阶梯：S1 聊天流 N∈{10,20,40}（每 run FRAMES 帧）；S2 扇出树 K∈{4,8,16}（每树 2 child
 * 慢流——聊天帧镜像+任务事件镜像+agentTask 锁同压）。
 * 判据：C1 阶梯完整 / C2 最大档事件循环 p99<100ms（容量红线，超了如实红）/
 * C3 帧完整性（收帧=发帧，镜像与流都没丢）/ C4 锁争用读数在账（quorum 计数）/
 * C5 redis 分账数字在（ops/mem/clients 每档）/ C6 清账。
 * 用法：node evals/platform-probes/cap-probe-p8.mjs（本机 src 目录下，需 dev 栈可达）
 */
import { spawn } from 'node:child_process'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import Redis from 'ioredis'

const RELAY_PORT = 13070
const FRAMES = 120
const PACE = 30 // 每帧毫秒：单 run ≈3.6s
const S1_LEVELS = [Number(process.env.CAP_S1) || 10, 20, 40]
const S2_LEVELS = [Number(process.env.CAP_S2) || 4, 8, 16]
const ts = Date.now()
const out = {说明: 'P-8 容量探针：单 worker 进程内压测（假中继零 token）', 阶梯: []}
const V = {}
const EXPECTED = 6
let relay = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
    process.env.LLM_RELAY_BASE_URL = `http://127.0.0.1:${RELAY_PORT}/v1`
    process.env.agentTask_taskEvents = 'true'
    process.env.agentTask_fanOutPlanner = 'true'
    process.env.agentTask_fanOutPlannerHandleMode = 'manual'
    process.env.agentTask_fanOutOrchestration = 'true'
    process.env.streamResume_redis_enabled = 'true'

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-cap.mjs', `--port=${RELAY_PORT}`, `--frames=${FRAMES}`, `--pace=${PACE}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    await sleep(1200)

    await import('../../init.js')
    const {execChat} = await import('../../services/core/llmChat.js')
    const {execAgentTask} = await import('../../services/agent/index.js')
    const {planFanOutFromRequest} = await import('../../services/agent/fanOutPlannerService.js')
    const {AgentTask, Message, Conversation} = await import('../../daos/core/schema/index.js')
    const {taskEventKey} = await import('../../services/core/session/taskEventLog.js')

    const rc = llm.config.redisConfig
    const admin = new Redis({host: rc.host, port: rc.port, username: rc.username, password: rc.password, db: rc.db})
    const elu = monitorEventLoopDelay({resolution: 10})
    elu.enable()

    // 锁争用计数：包一层 logger.warn（quorum/未获认领的话术都从 warn 出）
    let lockWarns = 0
    const origWarn = llm.logger.warn.bind(llm.logger)
    llm.logger.warn = (...a) => {
        const s = String(a[0] ?? '')
        if (/quorum|未获认领|认领失败|redlock/i.test(s)) lockWarns++
        return origWarn(...a)
    }

    const redisSnap = async () => {
        const info = await admin.info() // 全量：connected_clients 在 Clients 段、ops 在 Stats 段——分节取会漏
        const ops = Number((info.match(/total_commands_processed:(\d+)/) || [])[1] || 0)
        const conns = Number((info.match(/connected_clients:(\d+)/) || [])[1] || 0)
        const used = Number((info.match(/used_memory:(\d+)/) || [])[1] || 0)
        return {ops, conns, used}
    }
    /** 事件账在专用 db12（E5 的隔离在这里反过来成立：拿 db10 连接读事件键必然 0 帧） */
    const evDb = new Redis({host: rc.host, port: rc.port, username: rc.username, password: rc.password,
        db: llm.config.redisEventConfig?.db || 12})
    const t0all = await redisSnap()
    const tWall0 = Date.now()

    // —— S1：聊天流阶梯（execChat 真链：runRegistry/事件镜像/落档全压）——
    for (const n of S1_LEVELS) {
        const t0 = await redisSnap()
        const rss0 = process.memoryUsage().rss
        const s0 = Date.now()
        let frames = 0
        await Promise.allSettled(Array.from({length: n}, (_, i) => {
            const conv = `cap-s1-${ts}-${i}`
            return Conversation.collection.insertOne({conversationCode: conv, insertTime: new Date()}).then(() =>
                execChat({userCode: 'menglb', realName: 'P8压测'}, `CAP-CHAT 压测轮 ${i}`, conv, {
                    channel: 'micro_common', protocol: 2, cache: false, messageCode: `cap-s1-m-${ts}-${i}`,
                    streamCallback: (text) => { if (text) frames++ },
                }))
        }))
        const dt = (Date.now() - s0) / 1000
        const t1 = await redisSnap()
        out.阶梯.push({
            档: `S1×${n}`, 秒: +dt.toFixed(1),
            收帧: frames, 期望帧: n * (FRAMES + 1),
            redisOps: t1.ops - t0.ops, redisQps: +((t1.ops - t0.ops) / dt).toFixed(1),
            redisClients: t1.conns,
            rssDeltaMB: +((process.memoryUsage().rss - rss0) / 1048576).toFixed(1),
            每runops: +((t1.ops - t0.ops) / n).toFixed(1),
        })
        await sleep(2000) // 冷却
    }

    // —— S2：扇出树阶梯（taskEvents 镜像 + agentTask 锁 + children 慢流同压）——
    const allRoots = []
    for (const k of S2_LEVELS) {
        const t0 = await redisSnap()
        const s0 = Date.now()
        const roots = []
        const failReasons = []
        const settled = await Promise.allSettled(Array.from({length: k}, async (_, i) => {
            const conv = `cap-s2-${ts}-${i}`
            await Conversation.collection.insertOne({conversationCode: conv, insertTime: new Date()})
            const planned = await planFanOutFromRequest({
                query: `CAP-SUB 压测：分别完成 CAP-SUB-A 例行工作与 CAP-SUB-B 例行工作（第${i}轮）`,
                conversationCode: conv,
                operator: {userCode: 'menglb', realName: 'P8压测'},
                request: {channel: 'micro_common', protocol: 2},
                handleMode: 'manual',
            })
            if (!planned.fanOut) { failReasons.push(String(planned.reason || '?').slice(0, 40)); return }
            roots.push(planned.rootCode)
            allRoots.push(planned.rootCode)
            const rootRow = await AgentTask.collection.findOne({agentCode: planned.rootCode})
            await execAgentTask(rootRow)
            const kidRefs = (rootRow.subAgents || []).map((s) => s.agentCode)
            const kidRows = await AgentTask.collection.find({agentCode: {$in: kidRefs}}).toArray()
            await Promise.allSettled(kidRows.map((x) => execAgentTask(x)))
            const finTask = {
                agentCode: `fin-${planned.rootCode}`, handleStatus: 0, handler: 'fanOutFinalizeTask', agentRole: 'finalize',
                conversationCode: conv, operator: {userCode: 'menglb'},
                params: {rootCode: planned.rootCode, originalQuery: 'CAP-SUB 压测', channel: 'micro_common', protocol: 2},
            }
            await execAgentTask(finTask)
        }))
        // 被 allSettled 吞掉的异常必须现形——"一半没扇出"的真凶可能就是锁争用（P-8 要找的就是它）
        for (const s of settled) {
            if (s.status === 'rejected') failReasons.push(`throw:${String(s.reason?.message || s.reason).slice(0, 180)}`)
        }
        const dt = (Date.now() - s0) / 1000
        const t1 = await redisSnap()
        // 任务事件账完整性：每树应 ≥6 帧（queued/spawned/done×2/arbitration/end）——读 db12。
        // fire-and-forget 宽限 + **轮询到稳**：首档发射要付 redisEventClient 建连的冷启动，
        // 定长 sleep 会把"还没落账"误读成"丢帧"——读到齐或 12s 超时为止（P-8 要稳态数）
        let evFrames = 0
        const want = roots.length * 6
        for (let i = 0; i < 24; i++) {
            evFrames = 0
            for (const r of roots) {
                const raw = await evDb.xrange(taskEventKey(r), '-', '+')
                evFrames += raw.length
            }
            if (evFrames >= want) break
            await sleep(500)
        }
        const dtWithSettle = (Date.now() - s0) / 1000
            out.阶梯.push({
                档: `S2×${k}`, 秒: +dtWithSettle.toFixed(1), 树数: roots.length, 未扇出: k - roots.length, 未扇出原因: failReasons,
                事件帧合计: evFrames, 每树下限: 6,
                redisOps: t1.ops - t0.ops, redisQps: +((t1.ops - t0.ops) / dtWithSettle).toFixed(1), redisClients: t1.conns,
                lockWarns,
            })
        await sleep(2000)
    }

    elu.disable()
    const p99 = elu.percentile(99) / 1e6
    const maxRss = process.memoryUsage().rss
    const tEnd = await redisSnap()
    out.汇总 = {
        事件循环p99ms: +p99.toFixed(1),
        事件循环maxms: +(elu.max / 1e6).toFixed(1),
        峰值RSS_MB: +(maxRss / 1048576).toFixed(0),
        全程redisOps: tEnd.ops - t0all.ops,
        全程redisQps: +((tEnd.ops - t0all.ops) / ((Date.now() - tWall0) / 1000)).toFixed(1),
        锁争用warn总数: lockWarns,
    }

    // —— 判据 ——
    V['C1 阶梯完整（S1 三档+S2 三档都有数）'] = out.阶梯.length === S1_LEVELS.length + S2_LEVELS.length
        && out.阶梯.every((x) => x.redisOps > 0)
    V['C2 最大档事件循环 p99 < 100ms（容量红线；超了=本档压过了单 worker 的诚实上限）'] = p99 < 100
    V['C3 帧完整性：S1 各档收帧≥期望的 95%（流与镜像都没成规模丢）'] = out.阶梯.filter((x) => x.档.startsWith('S1'))
        .every((x) => x.收帧 >= x.期望帧 * 0.95)
    V['C4 锁争用读数在账（计数采集成功=0 或如实值）'] = typeof lockWarns === 'number' && out.阶梯.some((x) => 'lockWarns' in x)
    V['C5 redis 分账数字在（每档 ops/QPS/clients 采集齐）'] = out.阶梯.every((x) => x.redisQps > 0 && x.redisClients > 0)
    V['C6 每树事件账完整（S2 各档 事件帧合计≥树数×6）'] = out.阶梯.filter((x) => x.档.startsWith('S2'))
        .every((x) => x.树数 === 0 || x.事件帧合计 >= x.树数 * 6)

    // —— 清账（压测数据全按本次 ts 前缀删净；redis 事件键逐个 DEL）——
    for (const r of allRoots) {
        const codes = (await AgentTask.collection.find({agentCodePath: r}).toArray()).map((x) => x.agentCode)
        codes.push(r, `fin-${r}`, ...(await AgentTask.collection.find({'params.rootCode': r}).toArray()).map((x) => x.agentCode))
        await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
        await evDb.del(taskEventKey(r))
    }
    await Message.collection.deleteMany({conversationCode: {$regex: `^cap-s[12]-${ts}`}})
    await Conversation.collection.deleteMany({conversationCode: {$regex: `^cap-s[12]-${ts}`}})
    const residual = await Message.collection.countDocuments({conversationCode: {$regex: `^cap-s[12]-${ts}`}})
        + await Conversation.collection.countDocuments({conversationCode: {$regex: `^cap-s[12]-${ts}`}})
        + await AgentTask.collection.countDocuments({agentCode: {$in: allRoots}})
    out.清账 = {residual, roots: allRoots.length}
    await admin.quit()
    await evDb.quit()
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    if (relay && !relay.killed) relay.kill()
}

const allTrue = !out.错误 && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})` : allTrue ? 'P-8 容量读数采集完成（阶梯/延迟/帧完整性/锁争用/分账/清账）' : '未通(见 false 项)'
console.log('\n==== CAP-P8 RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
