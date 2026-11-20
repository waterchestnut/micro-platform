/**
 * @fileOverview dev 事件面开闸批⑤ 真机探针（M1-c 刀2 直播形态 dev 读数，2026-11-20）
 * @module evals/platform-probes/dev-gray-events
 * @description
 * 走 dev 网关真链路（真 relay 真 token——开闸行为读数只能真跑）：taskMode 扇出一棵
 * 真树，把**事件面三态**取全：
 *   A1 受理信封 rootCode 在账（链路通的前提，批①~④同族形）；
 *   A2 回放面 /events 首拉：available=true + task_queued/subtask_spawned 在账；
 *   A3 帧序只前进（游标回头/推进后重放=假；**段界到达归 A6 判**——宽限窗 45s + 真综合
 *      数分钟，轮询窗里 end 后到属 dev 现配置的行为读数，首轮实测即此形）；
 *   A4 订阅面**两态**（首轮实测教训：树已完成时 XREAD 秒回真账是正确行为，判据不分态
 *      就会把对的行为钉成红）：①游标未穷尽 ⇒ 立刻回 available=true+帧；②游标穷尽 ⇒
 *      空窗挂起实测耗时落 [3500,7000]ms 带（5s 钳位行为面，非配置目检）；
 *   A5 负例：网关实形无 token ⇒ code:4002 业务拒（剥 user-info 不等于匿名——网关拿
 *      param-accessToken 注入身份，这是 dev 拓扑的事实，判据按真形）；假 code ⇒ not-found；
 *   A6 detail 终相与事件账同真话（终相在词表 + 里程碑帧在账）。
 * token：temp/dev-token.txt（browser 登录法取，见 handoff §7）；4002=失效（HTTP 200 包业务错）。
 * 用法：node evals/platform-probes/dev-gray-events.mjs（本机 src 目录下）
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const GW = 'https://api.xxzx.paretop.net/llm'
const token = fs.readFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/dev-token.txt', 'utf8').trim()
const ts = Date.now()
const conv = `dev-gray-ev-${ts}`
const V = {}
const out = {}
const EXPECTED = 6

const USER = Buffer.from(JSON.stringify({ userCode: 'menglb', realName: '开闸实测' })).toString('base64')
const H = { 'content-type': 'application/json', 'user-info': USER, 'param-accessToken': token }
const post = async (path, body, withUser = true) => {
    const res = await fetch(GW + path, {
        method: 'POST',
        headers: withUser ? H : { 'content-type': 'application/json', 'param-accessToken': token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
    })
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('json')) {
        const j = await res.json().catch(() => null)
        return { status: res.status, j }
    }
    // 非 JSON=流形态（SSE 直答/信封之外的兜底）：读 12s 头一段供判形，不留悬挂连接
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let acc = ''
    const tEnd = Date.now() + 12000
    while (acc.length < 1200 && Date.now() < tEnd) {
        const { done, value } = await reader.read()
        if (done) break
        acc += dec.decode(value, { stream: true })
    }
    await reader.cancel().catch(() => {})
    return { status: res.status, j: null, raw: acc }
}

try {
    // A1 受理扇出。**指令句必须用已验会拆的题面**（批③ 3-child 句式实测 planner 会扇；
    // 自造"两件小事"实测落单轮直答=planner 判不适合，扇出不可由题面强制是批③结构事实）
    const q = process.env.EV_QUERY || '分别调研 CCUS 技术、长时储能技术、绿氢制备技术各自的技术成熟度与代表项目，再对比三者的商业化进度，最后给一段排序建议。'
    let a1 = null, accepted = false, rootCode = ''
    for (let tryI = 0; tryI < 3 && !rootCode; tryI++) {
        a1 = await post('/core/chat/stream', {
            query: q, conversationCode: `${conv}-${tryI}`,
            // 请求体逐字照批④已验形（options 嵌套+channel+cache:false+uuid messageCode——
            // 顶层平铺缺 channel 实测不扇出）
            options: { channel: 'micro_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(), taskMode: true },
        })
        const head = a1.j ? JSON.stringify(a1.j) : (a1.raw || '')
        accepted = a1.j?.data?.taskAccepted === true || a1.j?.data?.taskKind === 'accepted' || /"taskAccepted"\s*:\s*true/.test(head)
        rootCode = a1.j?.data?.rootCode || a1.j?.data?.taskRootCode || head.match(/"rootCode":"([^"]+)"/)?.[1] || ''
        if (!rootCode) out['A1尝试' + tryI] = { 形态: a1.j ? 'json' : 'stream', code: a1.j?.code, data: (a1.j?.data ? JSON.stringify(a1.j.data).slice(0, 160) : head.slice(0, 160)) }
    }
    V['A1 受理信封 rootCode 在账'] = accepted && !!rootCode
    out.A1 = { status: a1.status, code: a1.j?.code, rootCode, taskAccepted: a1.j?.data?.taskAccepted }
    if (!rootCode) throw new Error('A1 三次未获扇出受理，链路未通：' + JSON.stringify(out).slice(0, 400))

    // A2 回放面首拉（受理段发射在 http 进程——信封返回时 queued/spawned 应已落账）
    await new Promise((r) => setTimeout(r, 4000))
    const a2 = await post('/core/agentTask/events', { agentCode: rootCode, lastId: '' })
    const d2 = a2.j?.data || {}
    const types2 = (d2.events || []).map((e) => e.type)
    V['A2 回放面 available=true 且受理段帧在账'] =
        d2.available === true && types2.includes('task_queued') && types2.includes('subtask_spawned')
    out.A2 = { available: d2.available, reason: d2.reason, types: types2 }

    // A3 轮询 180s 记帧序：游标推进后不许重放/回头；end 到达也记录（后到属如实）
    const seenIds = new Set((d2.events || []).map((e) => e.id))
    let lastId = d2.lastId || ''
    let end = d2.end || null
    let allTypes = [...types2]
    const t0 = Date.now()
    while (Date.now() - t0 < 180000) {
        // eslint-disable-next-line no-await-in-loop
        const r = await post('/core/agentTask/events', { agentCode: rootCode, lastId })
        const d = r.j?.data || {}
        const nextId = d.lastId || lastId
        // 游标不推进时 XRANGE 窗口重叠回旧帧=读面语义不是故障——只在游标推进后判新帧
        if (nextId !== lastId) {
            for (const e of d.events || []) {
                if (!e.id || e.id === lastId) continue
                if (seenIds.has(e.id)) { out.A3重复帧 = `游标 ${lastId} 推进后仍重放 id ${e.id}`; break }
                seenIds.add(e.id); allTypes.push(e.type)
            }
            if (lastId && nextId) {
                const [ams, an] = lastId.split('-').map(Number)
                const [nms, nn] = nextId.split('-').map(Number)
                if (nms < ams || (nms === ams && nn < an)) out.A3游标回头 = `${lastId} -> ${nextId}`
            }
            lastId = nextId
        }
        if (d.end) { end = d.end; allTypes.push('__end__') }
        await new Promise((rr) => setTimeout(rr, 5000))
    }
    V['A3 帧只前进无回头（游标推进后不重放；end 后到属宽限窗现配置，归 A6 判）'] =
        !out.A3重复帧 && !out.A3游标回头 && seenIds.size > 0
    out.A3 = { end, 总帧: seenIds.size, 词表序列: allTypes }

    // A4 订阅面**两态**（判据不分态就会把正确行为钉成红——首轮实测教训）：
    // ①游标空/未穷尽 ⇒ 立刻回真账（available=true+帧，秒级）；
    // ②游标穷尽到末 ⇒ 空窗挂起守钳位：timeout 形且实测耗时落 [3500,7000]ms
    const t4a = Date.now()
    const a4a = await post('/core/agentTask/eventsSubscribe', { agentCode: rootCode, lastId: '' })
    const d4a = a4a.j?.data || {}
    const dt4a = Date.now() - t4a
    const t4b = Date.now()
    const a4b = await post('/core/agentTask/eventsSubscribe', { agentCode: rootCode, lastId })
    const d4b = a4b.j?.data || {}
    const dt4b = Date.now() - t4b
    V['A4 订阅面两态：未穷尽秒回真账 / 穷尽挂起守钳位（timeout 形且耗时带内）'] =
        d4a.available === true && (d4a.events || []).length > 0 && dt4a < 2000 &&
        (d4b.reason === 'timeout' || d4b.reason === 'empty') && dt4b >= 3500 && dt4b <= 7000
    out.A4 = { 未穷尽: { 耗时ms: dt4a, available: d4a.available, events: (d4a.events || []).length }, 穷尽: { 耗时ms: dt4b, reason: d4b.reason } }

    // A5 负例两连。**网关实形**（2026-11-20 实测入账）：网关拿 param-accessToken 在服务端
    // 解析注入 user-info——剥 user-info 头不等于匿名，匿名只能剥 token（实测 code:4002）
    const a5a = await fetch(GW + '/core/agentTask/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentCode: rootCode }),
        signal: AbortSignal.timeout(30000),
    })
    const a5aJson = await a5a.json().catch(() => null)
    const a5b = await post('/core/agentTask/eventsSubscribe', { agentCode: `nope-${ts}` })
    V['A5 负例：无 token 网关拒（4002/401）/ 假 code not-found'] =
        (a5aJson && String(a5aJson.code) !== '0' && !a5aJson.data?.events)
        && (a5b.j?.data?.reason === 'not-found' || a5b.j?.code === -1)
    out.A5 = { anon: { status: a5a.status, code: a5aJson?.code }, fake: { code: a5b.j?.code, reason: a5b.j?.data?.reason } }

    // A6 detail 终相与事件末帧同真话：合成完成时段界应到（宽限窗 45s 后 finalize 收口）；
    // 未合成完时两态对齐（synthesizing+end=null 也是真话）——判"两面对得上"不判"一定完成"
    const a6 = await post('/core/agentTask/detail', { agentCode: rootCode })
    const phase = a6.j?.data?.phase
    const donePhase = ['synthesized', 'partial', 'failed', 'cancelled'].includes(phase)
    V['A6 detail 终相与事件账同真话（完成相⇔段界到；合成中⇔无段界）'] =
        seenIds.size > 0 && (donePhase ? !!end : !end)
    out.A6 = { phase, 帧数: seenIds.size, endOutcome: end?.outcome || null }
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'dev 事件面开闸读数全真（受理/回放/帧序/订阅两态/负例/同真话）' : '未通(见 false 项)'
console.log('\n==== DEV-GRAY-EVENTS RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
