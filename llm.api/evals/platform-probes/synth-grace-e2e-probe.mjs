/**
 * @fileOverview 综合宽限窗端到端取证（§7-2，属主拍板 (c)，2026-11-19）
 * @module evals/platform-probes/synth-grace-e2e-probe
 * @description
 * 全链同进程（假中继，零真 token）：种 orchestrated 树 ⇒ 真 finalize（钩子派发，direct 模式）
 * ⇒ synth-timer 等待行 ⇒ pump（force）到期派发 ⇒ 三条分岔全部实测：
 *   G1 首算挂起：等待行落库（dueAt≈树完成+grace、不挂子树 path）、综合**没有**发生；
 *   G2 未到期不派（pump 计数 notDue）；
 *   G3 到期+静默满窗 ⇒ synthesize（root=2、synthesis.usable、等待行终态）；
 *   G4 到期但窗内有用户新消息 ⇒ user-active 重排（round=2 新行、dueAt=消息时刻+grace、还不综合）；
 *   G5 round 到顶 ⇒ postpone-exhausted 综合且 orchestration.synthNote 如实；
 *   G6 cron 注册读数：grace>0 进程打"已注册"，grace=0 进程打"未启用"（两进程实跑）；
 *   C1 清尽。
 * 用法：node evals/platform-probes/synth-grace-e2e-probe.mjs（本机 src 目录下）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const GRACE_MS = 8000
const RELAY_PORT = 13066
const OBS = `${process.env.TEMP}\\grace-obs.json`
const ts = Date.now()
const V = {}
const out = {}
const EXPECTED = 7
let relay = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
    process.env.LLM_RELAY_BASE_URL = `http://127.0.0.1:${RELAY_PORT}/v1`
    process.env.agentTask_fanOutOrchestrationSynthGraceMs = String(GRACE_MS)
    process.env.agentTask_fanOutOrchestration = 'true'
    process.env.agentTask_fanOutOrchestrationDispatch = 'direct'
    try { fs.rmSync(OBS, {force: true}) } catch { /* ok */ }

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-clarify.mjs', `--port=${RELAY_PORT}`, `--observe=${OBS}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    await sleep(1200)

    await import('../../init.js')
    const { execAgentTask } = await import('../../services/agent/index.js')
    const { addAgentTask } = await import('../../services/core/agentTask.js')
    const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
    const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
    const { normalizeFanOutPlan } = await import('../../services/agent/fanOutPlanner.js')
    const { buildRootTask } = await import('../../services/core/session/taskQueueComposer.js')
    const { runSynthTimerPump } = await import('../../tasks/synthTimerPump.js')
    const { SYNTH_TIMER_ROLE } = await import('../../services/core/session/synthScheduling.js')
    const { Message, Conversation, AgentTask } = await import('../../daos/core/schema/index.js')
    /**
     * 预清场：本功能在生产未开闸（grace>0 才有等待行），库里存在的 synth-timer 行
     * 只可能是**既往探针崩溃的残留**——它们会被全局 pump 一起派发，把 dispatched 计数
     * 弄脏（e2e5 实锤）。判据本来就该读"目标行的状态迁移"而非全局计数，两头一起收。
     */
    const preClean = await AgentTask.collection.deleteMany({agentRole: 'synth-timer'})
    out.预清 = {removed: preClean.deletedCount || 0}

    const seedTree = async (tag) => {
        const conv = `grace-${tag}-${ts}`
        await Conversation.collection.insertOne({conversationCode: conv, insertTime: new Date()})
        const plan = normalizeFanOutPlan({
            subtasks: [
                {title: `甲${tag}`, query: `${tag}-A 例行工作`, params: {execOptionsExtra: {cache: false, llmParams: {maxTokens: 32}}}},
                {title: `乙${tag}`, query: `${tag}-B 例行工作`, params: {execOptionsExtra: {cache: false, llmParams: {maxTokens: 32}}}},
            ],
            subtaskCeiling: 4,
        })
        const root = buildRootTask({
            conversationCode: conv, query: `${tag} 宽限窗探针`,
            agentType: 'parallel', handler: 'parallelDispatch', subtasks: plan.subtasks,
            operator: {userCode: 'menglb', realName: '宽限窗e2e'},
            extra: {handleMode: 'manual', orchestrated: true},
        })
        await addAgentTask(root)
        await execAgentTask(await agentTaskDac.getByCode(root.agentCode))
        return {conv, rootCode: root.agentCode}
    }
    const findTimer = async (rootCode) => (await agentTaskDac.getTop(3, {
        complexFilter: {agentRole: 'synth-timer', 'params.rootCode': rootCode},
    }, {insertTime: -1}))[0] || null

    // —— G1/G3：主链（挂起 → 未到期 → 到期静默综合）——
    const t1 = await seedTree('GRACE1')
    // 钩子 direct 派发 finalize 是 fire-and-forget：等等待行出现（≤30s），不是拿 execAgentTask
    // 返回就当全链走完——execAgentTask(root) 返回只代表 children 终局，finalize 在后台跳
    let timer1 = null
    for (let i = 0; i < 60 && !timer1; i++) {
        await sleep(500)
        timer1 = await findTimer(t1.rootCode)
    }
    const root1 = await agentTaskDac.getByCode(t1.rootCode)
    const synthMsg1 = await Message.collection.findOne({conversationCode: `root:${t1.rootCode}`})
    out.G1 = {due: timer1?.params?.dueAt - Date.now(), handled: timer1?.handleStatus, rootHasOrch: !!root1?.handleRet?.orchestration?.action, synthHappened: !!synthMsg1}
    V['G1 首算挂起：等待行在库(dueAt>0)+综合没有发生+root 无 orchestration 定稿'] =
        !!timer1 && timer1.handleStatus === 0 && Number(timer1.params.dueAt) > 0 && !synthMsg1 && !root1?.handleRet?.orchestration?.action

    const early = await runSynthTimerPump({force: true})
    out.G2 = {early, timerStill0: (await findTimer(t1.rootCode))?.handleStatus === 0}
    V['G2 未到期不派：目标等待行纹丝不动（全局计数只作参考，防残留行干扰）'] =
        (await findTimer(t1.rootCode))?.handleStatus === 0

    await sleep(Math.max(1000, (timer1.params.dueAt || Date.now()) - Date.now() + 500))
    const pump2 = await runSynthTimerPump({force: true})
    // 收敛点=**synthesis 落档**（execAgentTask 返回只是裁决完成，综合正文晚 ~1s）——
    // 探针必须等它，不能拿"派发 status=2"当综合的证据（G5 第一轮红就是这么误伤的）
    let root2 = null
    let synthMsg2 = null
    for (let i = 0; i < 40; i++) {
        await sleep(500)
        synthMsg2 = await Message.collection.findOne({conversationCode: `root:${t1.rootCode}`})
        if (synthMsg2) break
    }
    root2 = await agentTaskDac.getByCode(t1.rootCode)
    const timer2 = await findTimer(t1.rootCode)
    out.G3 = {pump2, action: root2?.handleRet?.orchestration?.action, usable: root2?.handleRet?.synthesis?.usable, timerStatus: timer2?.handleStatus, hasMsg: !!synthMsg2}
    V['G3 到期+静默满窗 ⇒ synthesize+synthesis 落 root: 会话+等待行终态'] =
        root2?.handleStatus === 2 && root2?.handleRet?.orchestration?.action === 'synthesize'
        && root2?.handleRet?.synthesis?.usable === true && !!synthMsg2 && [2, 3, -1].includes(timer2?.handleStatus)

    // —— G4：活性顺延（到期时窗内有新消息 ⇒ 重排 round=2 且不综合）——
    const t3 = await seedTree('GRACE4')
    let timer3a = null
    for (let i = 0; i < 60 && !timer3a; i++) {
        await sleep(500)
        timer3a = await findTimer(t3.rootCode)
    }
    // 先把窗等满，**再**临到期种"用户刚说话"——msg+grace 必须在未来，
    // 否则判据按 quiet-since-last 直接综合（那也是对的，但不是 G4 要拍的画面）
    await sleep(Math.max(800, (timer3a.params.dueAt || Date.now()) - Date.now() + 400))
    await Message.collection.insertOne({messageCode: `grace4-user-${ts}`, conversationCode: t3.conv, query: '等等我补一句：预算按 Q3 口径', insertTime: new Date(), updateTime: new Date(), operator: {userCode: 'menglb'}})
    const pump4 = await runSynthTimerPump({force: true})
    // 派发是 fire-and-forget：等"同一行就地重挂"落账（round 进 2、dueAt 在未来、行回 0），
    // 综合没有发生——重挂语义由 G5 修复定版（同表刷 dueAt，不双闹钟），判据跟着行为走
    let rehung = null
    const rows4 = []
    for (let i = 0; i < 20; i++) {
        await sleep(500)
        const found = await agentTaskDac.getTop(3, {complexFilter: {agentRole: SYNTH_TIMER_ROLE, 'params.rootCode': t3.rootCode}}, {insertTime: -1})
        rows4.length = 0; rows4.push(...found)
        if (found.some((r) => Number(r.params?.synthRound) === 2 && r.handleStatus === 0 && r.params.dueAt > Date.now())) { rehung = found; break }
    }
    const root4 = await agentTaskDac.getByCode(t3.rootCode)
    out.G4 = {pump4, rows: rows4.map((r) => ({round: r.params?.synthRound, st: r.handleStatus, dueDelta: (r.params?.dueAt || 0) - Date.now()})), action: root4?.handleRet?.orchestration?.action}
    V['G4 user-active：到期但窗内有话 ⇒ 同表重挂 round=2（dueAt 未来、行回 0）且综合没有发生'] =
        !!rehung && rows4.length === 1 && !root4?.handleRet?.orchestration?.action

    // —— G5：round 到顶 ⇒ exhausted 综合 + synthNote 如实 ——
    const t5 = await seedTree('GRACE5')
    let timer5 = null
    for (let i = 0; i < 60 && !timer5; i++) {
        await sleep(500)
        timer5 = await findTimer(t5.rootCode)
    }
    // 种新消息让"活性"成立；把 round 顶到 cap，并把 dueAt/treeDoneAt 都推到"已满窗"——
    // 重算该走 quiet/exhausted 直综合（window-open 抢先 schedule 的空转形状，e2e9 实锤修正）
    await Message.collection.insertOne({messageCode: `grace5-user-${ts}`, conversationCode: t5.conv, query: '我还是在聊', insertTime: new Date(Date.now() - 1000), updateTime: new Date(), operator: {userCode: 'menglb'}})
    await agentTaskDac.update({'params.synthRound': 3, 'params.dueAt': Date.now() - 1, 'params.treeDoneAt': Date.now() - GRACE_MS - 3000}, {agentCode: timer5.agentCode})
    // 停掉 t3 的重挂行（推远 dueAt），否则全局泵把别家的闹钟一起派了
    await agentTaskDac.update({'params.dueAt': Date.now() + 60000}, {agentCode: (await findTimer(t3.rootCode))?.agentCode || '__none__'})
    const pump5 = await runSynthTimerPump({force: true})
    let root5 = null
    let synthMsg5 = null
    for (let i = 0; i < 40; i++) {
        await sleep(500)
        synthMsg5 = await Message.collection.findOne({conversationCode: `root:${t5.rootCode}`})
        if (synthMsg5) break
    }
    root5 = await agentTaskDac.getByCode(t5.rootCode)
    out.G5 = {pump5, action: root5?.handleRet?.orchestration?.action, note: root5?.handleRet?.orchestration?.synthNote, usable: root5?.handleRet?.synthesis?.usable, synthMsg: !!synthMsg5}
    V['G5 postpone-exhausted：round 到顶 ⇒ 综合不吊死+synthNote 如实'] =
        root5?.handleStatus === 2 && root5?.handleRet?.orchestration?.action === 'synthesize'
        && root5?.handleRet?.orchestration?.synthNote === 'postpone-exhausted' && root5?.handleRet?.synthesis?.usable === true

    // —— G6：cron 注册读数（两进程：开 grace / 关 grace）——
    const bootLine = async (envExtra, want) => {
        const p = spawn(process.execPath, ['cron/retention.js'], {cwd: process.cwd(), env: {...process.env, ...envExtra}, stdio: ['ignore', 'pipe', 'pipe']})
        let buf = ''
        const r = await new Promise((resolve) => {
            const onData = (d) => {
                buf += d.toString()
                if (buf.includes(want)) resolve(true)
            }
            p.stdout.on('data', onData); p.stderr.on('data', onData)
            setTimeout(() => resolve(false), 30000)
        })
        p.kill()
        await sleep(600)
        return r
    }
    const on = await bootLine({agentTask_fanOutOrchestrationSynthGraceMs: String(GRACE_MS)}, 'cron/synthTimerPump 已注册')
    const off = await bootLine({agentTask_fanOutOrchestrationSynthGraceMs: '0'}, 'cron/synthTimerPump 未启用')
    out.G6 = {on, off}
    V['G6 cron 实跑读数：grace>0 注册、grace=0 未启用'] = on === true && off === true

    // —— C1 清账 ——
    const codes = []
    for (const rc of [t1.rootCode, t3.rootCode, t5.rootCode]) {
        codes.push(...(await agentTaskDac.getTop(64, {complexFilter: {agentCodePath: rc}})).map((r) => r.agentCode), rc)
        codes.push(...(await agentTaskDac.getTop(10, {complexFilter: {'params.rootCode': rc, agentRole: 'synth-timer'}})).map((r) => r.agentCode))
        await Message.collection.deleteMany({conversationCode: {$in: [`root:${rc}`]}})
    }
    await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
    await Message.collection.deleteMany({conversationCode: {$in: [t1.conv, t3.conv, t5.conv]}})
    await Conversation.collection.deleteMany({conversationCode: {$in: [t1.conv, t3.conv, t5.conv]}})
    const residual = await AgentTask.collection.countDocuments({agentCode: {$in: codes}})
        + await Message.collection.countDocuments({conversationCode: {$in: [t1.conv, t3.conv, t5.conv, `root:${t1.rootCode}`, `root:${t3.rootCode}`, `root:${t5.rootCode}`]}})
    out.C1 = {residual}
    V['C1 收尾清尽(residual=0)'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 900)
} finally {
    if (relay && !relay.killed) relay.kill()
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '综合宽限窗 e2e 通过(挂起/未到/静默综合/顺延/到顶/注册/清尽)' : '未通(见 false 项)'
console.log('\n==== SYNTH-GRACE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
