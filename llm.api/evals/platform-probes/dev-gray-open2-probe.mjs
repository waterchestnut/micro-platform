/**
 * @fileOverview dev 开闸批②行为探针——附件前门真读回 + 综合宽限窗真时序（真 relay、真 doc.api、真 pod）
 * @module evals/platform-probes/dev-gray-open2-probe
 * @description
 * 打**已部署的 dev 网关**（jenkins `6800993` 的三容器 env 是否真生效），判据锚全部取
 * **账上的时刻**（timer 行 insert→dueAt→root 写回链），不取轮询观察时刻——第一版拿
 * "探针第一次看到全终"当树完成锚，被轮询粒度骗出 16s 假读数（真窗 45s 在 timer 行上
 * 分毫不差）；观察只能证伪，不能定案。
 * 判据：
 *   A1 附件前门真链：taskMode+attachment 扇出 ⇒ child 正文含 CAPSTONE（特征码只存在于
 *      上传的文件里——出现在 child handleRet.content=doc.api extract→child 上下文→成品 全链真走）；
 *   A2 宽限窗账锚：synth-timer 行 dueAt-insertTime ∈ [44s, 60s]（45s 窗 + 泵 tick 容差）；
 *   A3 到点综合：root orchestration.action=synthesize 且 synthesis.usable=true，
 *      root 写回时刻 - timer.dueAt ≤ 90s（pump+重算+综合的正常带）；
 *   A4 扇出受理：taskAccepted+rootCode（planner 判定类入口 ⇒ 最多 3 试，每次新幂等键）；
 *   C1 探针账清尽（任务行/档案/会话按本次 ts 前缀删净）。
 * 凭据：dev-token.txt（param-accessToken 解码形，golden 同法）；会花少量真 relay token。
 * 用法：node evals/platform-probes/dev-gray-open2-probe.mjs（本机 src 目录下）
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'https://api.xxzx.paretop.net/llm'
const DOC = 'https://api.xxzx.paretop.net/doc'
const TOKEN = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: '开闸实测' })).toString('base64')
const H = { 'content-type': 'application/json', 'user-info': USER, 'param-accessToken': TOKEN }
const ts = Date.now()
const MARK = `灰度探针附件-${ts}`
const V = {}
const out = {}
const EXPECTED = 5
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, body, timeoutMs = 60000) {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const ct = r.headers.get('content-type') || ''
    return { status: r.status, ct, json: ct.includes('json') ? await r.json().catch(() => null) : null, raw: ct.includes('json') ? '' : '' }
}

try {
    await import('../../init.js')
    const { AgentTask } = await import('../../daos/core/schema/index.js')

    // ① 真上传（doc.api dev）
    const form = new FormData()
    form.append('file', new Blob([`【${MARK}】\n本文是 dev 开闸行为探针的假附件。特征码：CAPSTONE-${ts}\n`], { type: 'text/plain' }), `gray-probe-${ts}.txt`)
    // multipart 不能带 content-type:application/json（fetch 要自己生成 boundary）——H 复用踩坑修正
    const up = await fetch(`${DOC}/file/upload/simple`, { method: 'POST', headers: { 'user-info': USER, 'param-accessToken': TOKEN }, body: form, signal: AbortSignal.timeout(30000) })
    const upJson = await up.json().catch(() => null)
    const fileCode = upJson?.data?.fileCode || upJson?.fileCode
    out.upload = { status: up.status, fileCode: String(fileCode || '').slice(0, 12) }
    if (!fileCode) throw new Error('doc.api 上传没回 fileCode')

    // ② taskMode 扇出（planner 判定类 ⇒ 重试 ×3 新幂等键；SSE=判了单轮，读头即断）
    const conv = `gray-open2-${ts}`
    const QUERY = '分别调研 CCUS 技术、长时储能技术、绿氢制备技术各自的技术成熟度与代表项目，再对比三者的商业化进度，最后给一段排序建议。第一个子任务请读取附件并引用其中的特征码。'
    let rootCode = null
    let attemptUsed = 0
    for (let attempt = 1; attempt <= 3 && !rootCode; attempt++) {
        attemptUsed = attempt
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST', headers: H,
            body: JSON.stringify({
                query: QUERY, conversationCode: `${conv}-${attempt}`,
                options: { channel: 'micro_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(),
                    taskMode: true, attachments: [{ fileCode, name: `gray-probe-${ts}.txt` }] },
            }),
            signal: AbortSignal.timeout(60000),
        })
        let bodyText = ''
        if ((r.headers.get('content-type') || '').includes('json')) {
            bodyText = JSON.stringify(await r.json().catch(() => null) || {})
        } else {
            const reader = r.body.getReader()
            const dec = new TextDecoder()
            let acc = ''
            const tEnd = Date.now() + 12000
            while (acc.length < 2000 && Date.now() < tEnd) {
                const { done, value } = await reader.read()
                if (done) break
                acc += dec.decode(value, { stream: true })
            }
            await reader.cancel().catch(() => {})
            bodyText = acc
        }
        rootCode = bodyText.match(/"rootCode":"([^"]+)"/)?.[1] || bodyText.match(/"taskCode":"([^"]+)"/)?.[1] || null
        out.发起 = { attempt, head: bodyText.slice(0, 200) }
        if (!rootCode) await sleep(1500)
    }
    V['A4 扇出受理（planner 判定入口，≤3 试拿到 rootCode）'] = !!rootCode
    if (!rootCode) throw new Error('三轮没扇出（planner 三次判单轮）')

    // ③ 等终局（宽限窗 45s + children 真调研 + 综合；预算 12 分钟）
    let view = null
    for (let i = 0; i < 140; i++) {
        await sleep(5000)
        const d = await api('/core/agentTask/detail', { agentCode: rootCode })
        view = d.json?.data
        if (['synthesized', 'partial', 'failed', 'cancelled'].includes(view?.phase)) break
    }
    out.终局 = { phase: view?.phase, attempts: attemptUsed, orchAction: view?.orchestration?.action, synthUsable: view?.synthesis?.usable }

    // ④ 账锚读数（DB 直读 dev 库——时刻以账为准，不以观察为准）
    const root = await AgentTask.collection.findOne({ agentCode: rootCode })
    const timer = await AgentTask.collection.findOne({ agentRole: 'synth-timer', 'params.rootCode': rootCode })
    const kids = await AgentTask.collection.find({ agentCodePath: rootCode, handler: 'agentChat' }).toArray()
    const capKid = kids.find((k) => String(k.handleRet?.content || '').includes(`CAPSTONE-${ts}`))
    const winMs = timer ? (new Date(timer.params.dueAt) - new Date(timer.insertTime)) : -1
    const settleMs = timer ? (new Date(root?.updateTime) - new Date(timer.params.dueAt)) : -1
    out.账锚 = {
        timerRound: timer?.params?.synthRound, winMs, settleMs,
        timerStatus: timer?.handleStatus, rootAction: root?.handleRet?.orchestration?.action,
        capKid: capKid?.agentCode?.slice(0, 8), kids: kids.length,
    }

    V['A1 附件前门：CAPSTONE 经 doc.api 提取出现在 child 成品正文（全链真走）'] = !!capKid
    V['A2 宽限窗账锚：timer 行 dueAt-insertTime ∈ [44s,60s]（45s 窗+泵容差）'] = winMs >= 44000 && winMs <= 60000
    V['A3 到点综合：root synthesize 落账、synthesis.usable、写回距 dueAt ≤90s'] =
        root?.handleRet?.orchestration?.action === 'synthesize' && root?.handleRet?.synthesis?.usable === true
        && settleMs >= -5000 && settleMs <= 90000

    // 收尾：删探针任务行与档案（会话前缀带 ts，只认本次）
    const codes = (await AgentTask.collection.find({ agentCodePath: rootCode }).toArray()).map((r) => r.agentCode)
    codes.push(rootCode, ...(await AgentTask.collection.find({ 'params.rootCode': rootCode }).toArray()).map((r) => r.agentCode))
    await AgentTask.collection.deleteMany({ agentCode: { $in: codes } })
    const { Message, Conversation } = await import('../../daos/core/schema/index.js')
    await Message.collection.deleteMany({ conversationCode: { $in: [`${conv}-1`, `${conv}-2`, `${conv}-3`, `root:${rootCode}`, ...kids.map((k) => `agent:${k.agentCode}`)] } })
    await Conversation.collection.deleteMany({ conversationCode: { $regex: `^gray-open2-${ts}` } })
    const residual = await AgentTask.collection.countDocuments({ agentCode: { $in: codes } })
    out.清账 = { residual }
    V['C1 探针账清尽'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 160)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'dev 开闸批②行为读数通过（附件真读回+45s 窗账锚+到点综合+清账）' : '未通(见 false 项)'
console.log('\n==== DEV-GRAY-OPEN2 RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
