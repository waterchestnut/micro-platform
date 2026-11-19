/**
 * @fileOverview skill 写面幂等闸端到端取证（B-4 二期前置，属主拍板② 2026-11-19）
 * @module evals/platform-probes/skill-write-e2e-probe
 * @description
 * 剧本中继三轮：toolA(call_w_1) → **同 id 换名 toolB** → 正文。toolA/toolB 都不在工具注册表，
 * 真执行必然产生点名该工具的包装错误（toolManager 的错误形状恒带 `"tool":"<名>"`），
 * 于是"第 2 轮的工具消息点名谁"就是"重放还是双跑"的读数——不靠猜。
 * 判据：
 *   S1 阶段1（闸开）第 1 次执行落了 done 账（key=`messageCode:call_w_1`，快照点 toolA）；
 *   S2 阶段1 最后一轮请求里的第 2 条工具消息点 **toolA**（=done-hit 回放，零副作用重执行）；
 *   S3 阶段1 该键账行数恒 1（replay 不 claim、settle 不覆写第二行）；
 *   S4 阶段2（闸关对照）第 2 条工具消息点 **toolB**（真执行=现网逐字），且库里无此键行；
 *   C1 收尾清尽（两键行删净、合成会话清掉）。
 * 用法：node evals/platform-probes/skill-write-e2e-probe.mjs（本机 src 目录下）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '写面幂等e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 5
const ts = Date.now()
const TMP = process.env.TEMP || '/tmp'

async function runPhase({tag, port, relayPort, gateOn, conv, msgCode}) {
    const observe = `${TMP}\\swp-obs-${tag}.json`.replace(/\\\\/g, '\\')
    try { fs.rmSync(observe, {force: true}) } catch { /* 不存在最好 */ }
    const relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-write.mjs', `--port=${relayPort}`, `--observe=${observe}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    const env = {
        ...process.env, PORT: String(port), FASTIFY_ADDRESS: '127.0.0.1',
        LLM_RELAY_BASE_URL: `http://127.0.0.1:${relayPort}/v1`,
    }
    if (gateOn) {
        env.limits_skillWriteIdempotency = 'true'
        env.limits_skillWriteIdempotencyWriteTools = 'probe_write/*'
    } else {
        // 名单给了但不带 enabled ⇒ 必须与现网逐字一致（conf 判据里 enabled 是唯一总开关）
        env.limits_skillWriteIdempotencyWriteTools = 'probe_write/*'
    }
    const server = spawn(process.execPath, ['server.js'], {cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe']})
    let buf = ''
    server.stdout.on('data', (d) => { buf += d.toString() })
    server.stderr.on('data', (d) => { buf += d.toString() })
    const t0 = Date.now()
    while (!buf.includes('服务器启动成功')) {
        if (Date.now() - t0 > 90000) { throw new Error(`server(${tag}) 启动超时: ` + buf.slice(-300)) }
        await new Promise((r) => setTimeout(r, 1000))
    }
    try {
        const res = await fetch(`http://127.0.0.1:${port}/core/chat/stream`, {
            method: 'POST',
            headers: {'content-type': 'application/json', 'user-info': USER},
            body: JSON.stringify({query: '写面幂等探针轮（假中继三轮剧本，不真花钱）', conversationCode: conv,
                options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: msgCode}}),
            signal: AbortSignal.timeout(120000),
        })
        await res.text() // 等整轮跑完（三轮剧本 + 正文收尾后服务端关闭流）
    } finally {
        server.kill()
        relay.kill()
        await new Promise((r) => setTimeout(r, 1200))
    }
    const obs = JSON.parse(fs.readFileSync(observe, 'utf8'))
    return {observe, obs}
}

const convA = `swp-A-${ts}`
const convB = `swp-B-${ts}`
const msgA = `swp-a-${ts}`
const msgB = `swp-b-${ts}`
const keyA = `${msgA}:call_w_1`
const keyB = `${msgB}:call_w_1`

try {
    await import('../../init.js')
    const {SkillWriteJournal} = await import('../../daos/core/schema/index.js')
    const {Message, Conversation} = await import('../../daos/core/schema/index.js')

    const p1 = await runPhase({tag: '1', port: 12049, relayPort: 13049, gateOn: true, conv: convA, msgCode: msgA})
    const rowA = await SkillWriteJournal.findOne({idempotencyKey: keyA}).lean()
    out.S1 = {status: rowA?.status, snapHead: String(rowA?.resultSnapshot || '').slice(0, 140)}
    V['S1 闸开：首执行落 done 账且快照点 toolA'] =
        !!rowA && rowA.status === 'done' && rowA.resultSnapshot.includes('probe_write/toolA')

    const last1 = (p1.obs.toolResults || []).slice(-1)
    out.S2 = {toolRounds: p1.obs.toolRounds, lastMsgCount: (p1.obs.toolResults || []).length, last: JSON.stringify(last1).slice(0, 300)}
    const msgs1 = p1.obs.toolResults || []
    V['S2 闸开：第 2 轮同键回放（最后消息点 toolA、全程零点 toolB=没重执行）'] =
        msgs1.length >= 2 && msgs1[msgs1.length - 1].includes('probe_write/toolA') && !msgs1.some((m) => m.includes('probe_write/toolB'))

    const cntA = await SkillWriteJournal.countDocuments({idempotencyKey: keyA})
    out.S3 = {rows: cntA}
    V['S3 闸开：该幂等键账行恒 1（replay 不双记）'] = cntA === 1

    const p2 = await runPhase({tag: '2', port: 12050, relayPort: 13050, gateOn: false, conv: convB, msgCode: msgB})
    const rowB = await SkillWriteJournal.countDocuments({idempotencyKey: keyB})
    const msgs2 = p2.obs.toolResults || []
    out.S4 = {journalRows: rowB, last: JSON.stringify(msgs2.slice(-1)).slice(0, 300)}
    V['S4 闸关对照：toolB 真执行（最后消息点 toolB）且零账行=现网逐字'] =
        rowB === 0 && msgs2.length >= 2 && msgs2[msgs2.length - 1].includes('probe_write/toolB')

    await SkillWriteJournal.deleteMany({idempotencyKey: {$in: [keyA, keyB]}})
    await Message.collection.deleteMany({conversationCode: {$in: [convA, convB]}})
    await Conversation.collection.deleteMany({conversationCode: {$in: [convA, convB]}})
    const residual = await SkillWriteJournal.countDocuments({idempotencyKey: {$in: [keyA, keyB]}})
    out.C1 = {residual}
    V['C1 收尾清尽(residual=0)'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'skill 写面幂等闸 e2e 通过(首执行/回放/单行/对照/清尽)' : '未通(见 false 项)'
console.log('\n==== SKILL-WRITE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
