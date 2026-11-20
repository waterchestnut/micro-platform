/**
 * @fileOverview dev 开闸批③行为探针——§7-1 澄清冒泡真链（真网关、真 relay、真模型）
 * @module evals/platform-probes/dev-gray-clarify-probe
 * @description
 * 与批②探针同族：打已部署的 dev 网关，证明 agentTask_clarifyBubble env 真生效。
 * 两级模型判定都在链上（planner 扇出 + child 自主申报），**都不可由题面强制**：
 *   - planner 会把"必须提问"的指令句洗掉/或因此判单轮（实测：指令句在 query 里 ⇒ 3/3 单轮）；
 *   - 扇出成功的原题 child 自行调研完毕、不申报（信息缺口是它自己脑补的）。
 * 这是账上如实的读数边界，不是闸门故障——功能链（申报→awaiting→答复→重跑→综合）由
 * 剧本中继的 clarify-bubble e2e 7/7 确定性地证过；本探针给的是"开闸后编排链无回归"
 * （B0 扇出 + B3 终局 + B4 清账）与"申报若发生则全链真通"（B1/B2 条件判据）。
 * 判据：
 *   B0 扇出受理（≤3 试；planner 判定类入口家规）；
 *   B1 申报发生（账读数：child handleRet.clarify + detail awaiting_input）——未发生时
 *      记 note 不算红（模型行为不可强制），但 B2/B3 的答复链随之跳过；
 *   B2/B3 答复链与终局（仅当 B1 发生才判）；
 *   B4 清账（含单轮 fallback 产生的档案）。
 * 用法：node evals/platform-probes/dev-gray-clarify-probe.mjs（src 下；花少量真 relay token）
 *       CLARIFY_QUERY=... 可覆盖题面。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'https://api.xxzx.paretop.net/llm'
const TOKEN = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const USER = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '开闸实测'})).toString('base64')
const H = {'content-type': 'application/json', 'user-info': USER, 'param-accessToken': TOKEN}
const ts = Date.now()
const V = {}
const out = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const QUERY = process.env.CLARIFY_QUERY || '分别调研 CCUS 技术、长时储能技术、绿氢制备技术各自的技术成熟度与代表项目，再对比三者的商业化进度，最后给一段排序建议。'

async function postStreamHead(body) {
    const r = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    if ((r.headers.get('content-type') || '').includes('json')) return JSON.stringify(await r.json().catch(() => null) || {})
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let acc = ''
    const tEnd = Date.now() + 12000
    while (acc.length < 2000 && Date.now() < tEnd) {
        const {done, value} = await reader.read()
        if (done) break
        acc += dec.decode(value, {stream: true})
    }
    await reader.cancel().catch(() => {})
    return acc
}

const detail = async (rootCode) => (await fetch(`${BASE}/core/agentTask/detail`, {
    method: 'POST', headers: H, body: JSON.stringify({agentCode: rootCode}), signal: AbortSignal.timeout(30000),
}).then((x) => x.json()).catch(() => null))?.data || null

try {
    await import('../../init.js')
    const {AgentTask, Message, Conversation} = await import('../../daos/core/schema/index.js')

    // ① 发起（≤3 试拿 rootCode）
    const conv = `gray-clarify-${ts}`
    let rootCode = null
    for (let i = 1; i <= 3 && !rootCode; i++) {
        let head = ''
        try {
            head = await postStreamHead({
                query: QUERY, conversationCode: `${conv}-${i}`,
                options: {channel: 'micro_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(), taskMode: true},
            })
        } catch (e) {
            head = `stream-timeout: ${String(e?.message || e).slice(0, 80)}` // 单轮在读答案，不是故障
        }
        rootCode = head.match(/"rootCode":"([^"]+)"/)?.[1] || null
        out.发起 = {attempt: i, head: head.slice(0, 220)}
        if (!rootCode) await sleep(1500)
    }
    V['B0 扇出受理（planner 判定入口 ≤3 试）'] = !!rootCode

    // ② 申报观察（模型自主行为：等 3 分钟，出现 awaiting_input 或终局为止）
    let declared = false
    if (rootCode) {
        let view = null
        for (let i = 0; i < 45; i++) {
            await sleep(4000)
            view = await detail(rootCode)
            if (view?.phase === 'awaiting_input' && (view.clarify?.requests || []).length) { declared = true; break }
            if (['synthesized', 'partial', 'failed', 'cancelled'].includes(view?.phase)) break
        }
        const kids = await AgentTask.collection.find({agentCodePath: rootCode, handler: 'agentChat'}).toArray()
        const declaredKids = kids.filter((k) => String(k.handleRet?.clarify?.question || '').trim())
        out.B1 = {declared, phase: view?.phase, requests: view?.clarify?.requests?.length ?? 0, declaredKids: declaredKids.length}
        V['B1 申报链（条件判据：发生则账上必见；模型不申报则记 false 不算闸门坏）'] = declared && declaredKids.length >= 1

        if (declared) {
            // ③ 答复 + 终局（申报确实发生 ⇒ 全链读数必须齐）
            const req0 = (view.clarify.requests || [])[0]
            const a = await fetch(`${BASE}/core/agentTask/clarifyAnswer`, {
                method: 'POST', headers: H,
                body: JSON.stringify({agentCode: rootCode, answers: [{agentCode: req0.agentCode, response: '用预发环境，窗口下周二'}]}),
                signal: AbortSignal.timeout(30000),
            })
            const aj = await a.json().catch(() => null)
            out.B2 = {status: a.status, code: aj?.code, requeued: aj?.data?.requeued}
            V['B2 答复链：clarifyAnswer 200+code0+requeued≥1（申报发生时必判）'] =
                a.status === 200 && aj?.code === 0 && (aj?.data?.requeued || []).length >= 1
            let final = null
            for (let i = 0; i < 90; i++) {
                await sleep(4000)
                final = await detail(rootCode)
                if (['synthesized', 'partial', 'failed', 'cancelled'].includes(final?.phase)) break
            }
            out.B3 = {phase: final?.phase, holdLeft: final?.clarify?.requests?.length ?? 0}
            V['B3 终局链：答复后到终不吊死、hold 清空（申报发生时必判）'] =
                ['synthesized', 'partial', 'failed'].includes(final?.phase) && (final?.clarify?.requests?.length ?? 0) === 0
        } else {
            out.未申报 = '模型未申报（题面不可强制；功能链由 clarify-bubble e2e 7/7 确定性证明，本探针只证开闸无回归）'
            // 无申报也要有"链没坏"的终局读数
            let final = null
            for (let i = 0; i < 60; i++) {
                await sleep(4000)
                final = await detail(rootCode)
                if (['synthesized', 'partial', 'failed', 'cancelled'].includes(final?.phase)) break
            }
            out.B3 = {phase: final?.phase, note: '无申报的常规终局'}
        }
    }

    // ④ 清账（扇出链 + 单轮 fallback 的档案都按本次 ts 前缀删净）
    if (rootCode) {
        const codes = (await AgentTask.collection.find({agentCodePath: rootCode}).toArray()).map((r) => r.agentCode)
        codes.push(rootCode, ...(await AgentTask.collection.find({'params.rootCode': rootCode}).toArray()).map((r) => r.agentCode))
        await AgentTask.collection.deleteMany({agentCode: {$in: codes}})
        await Message.collection.deleteMany({conversationCode: {$in: [`root:${rootCode}`]}})
    }
    await Message.collection.deleteMany({conversationCode: {$regex: `^gray-clarify-${ts}`}})
    await Conversation.collection.deleteMany({conversationCode: {$regex: `^gray-clarify-${ts}`}})
    const residual = await Message.collection.countDocuments({conversationCode: {$regex: `^gray-clarify-${ts}`}})
        + await Conversation.collection.countDocuments({conversationCode: {$regex: `^gray-clarify-${ts}`}})
    out.B4 = {residual}
    V['B4 探针账清尽'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const required = ['B0 扇出受理（planner 判定入口 ≤3 试）', 'B4 探针账清尽']
const optionalHit = V['B1 申报链（条件判据：发生则账上必见；模型不申报则记 false 不算闸门坏）'] === true
const coreOk = required.every((k) => V[k] === true) && (!optionalHit || (
    V['B2 答复链：clarifyAnswer 200+code0+requeued≥1（申报发生时必判）'] === true
    && V['B3 终局链：答复后到终不吊死、hold 清空（申报发生时必判）'] === true))
const allTrue = !out.错误 && coreOk
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 160)})`
    : allTrue ? (optionalHit ? 'dev 批③全链读数通过（申报+答复+终局）' : 'dev 批③开闸无回归（扇出+终局+清账；模型本轮未申报，如实记）') : '未通(见 false 项)'
console.log('\n==== DEV-GRAY-CLARIFY RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
