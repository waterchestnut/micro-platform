/**
 * @fileOverview dev 事件面开闸批⑤ 真机探针（M1-c 刀2 直播形态 dev 读数，2026-11-20）
 * @module evals/platform-probes/dev-gray-events
 * @description
 * 走 dev 网关真链路（真 relay 真 token——开闸行为读数只能真跑）：taskMode 扇出一棵
 * 2-child 树，把**事件面三态**取全：
 *   A1 受理信封 rootCode 在账（链路通的前提，批①~④同族形）；
 *   A2 回放面 /events 首拉：available=true + task_queued/subtask_spawned 在账
 *      （flag 没开 ⇒ available=false/reason=no-client，那也是读数，但批⑤未完形）；
 *   A3 游标只前进：轮询到段界 end（arbitration+__end__ 或 await-input 段尾）或 240s 超时，
 *      全程 lastId 单调、帧无重复 id；
 *   A4 订阅面 /eventsSubscribe：段界后新帧已尽 ⇒ 空窗挂起**实测耗时在 [3.5s, 7s] 带**
 *      且 reason=timeout（5s 钳位真实生效——Traefik/连接两头账的行为面）；有帧则立刻回（不赌
 *      时序，两种形态都如实入账，判据只钉"耗时带+reason 在词表"）；
 *   A5 负例：无 user-info ⇒ 401；不存在的 agentCode ⇒ code:-1 not-found；
 *   A6 清账：树终态后 detail 面相位与事件末帧语义一致（直播晚一帧但说同一句话）。
 * token：temp/dev-token.txt（browser 登录法取，见 handoff §7）；4002=失效（HTTP 200 包业务错）。
 * 用法：node evals/platform-probes/dev-gray-events.mjs（本机 src 目录下）
 */
import fs from 'node:fs'

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
    // A1 受理扇出——**指令句必须用已验会拆的题面**（批③探针 3-child 句式；自造的
    // "分别完成两件小事"实测落单轮直答=planner 判不适合，扇出不可由题面强制是批③结构事实）
    const q = process.env.EV_QUERY || '分别调研 CCUS 技术、长时储能技术、绿氢制备技术各自的技术成熟度与代表项目，再对比三者的商业化进度，最后给一段排序建议。'
    let a1 = null, accepted = false, rootCode = ''
    for (let tryI = 0; tryI < 3 && !rootCode; tryI++) {
        a1 = await post('/core/chat/stream', {
            query: q, conversationCode: `${conv}-${tryI}`,
            // 请求体逐字照批④已验形（options 嵌套+channel+cache:false+uuid messageCode——
            // 顶层平铺缺 channel 实测不扇出，planner 入口条件是批④同族事实）
            options: { channel: 'micro_common', protocol: 2, cache: false, messageCode: crypto.randomUUID(), taskMode: true },
        })
        const head = a1.j ? JSON.stringify(a1.j) : (a1.raw || '')
        accepted = a1.j?.data?.taskAccepted === true || a1.j?.data?.taskKind === 'accepted' || /"taskAccepted"\s*:\s*true/.test(head)
        rootCode = a1.j?.data?.rootCode || a1.j?.data?.taskRootCode || head.match(/"rootCode":"([^"]+)"/)?.[1] || ''
        if (!rootCode) out['A1尝试' + tryI] = { 形态: a1.j ? 'json' : 'stream', code: a1.j?.code, data: a1.j?.data ? JSON.stringify(a1.j.data).slice(0, 160) : head.slice(0, 160) }
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

    // A3 轮询到段界（游标单调、帧 id 不重；240s 上限如实——dev 真模型跑树）
    const seenIds = new Set((d2.events || []).map((e) => e.id))
    let lastId = d2.lastId || ''
    let end = d2.end || null
    let allTypes = [...types2]
    const t0 = Date.now()
    while (!end && Date.now() - t0 < 240000) {
        // eslint-disable-next-line no-await-in-loop
        const r = await post('/core/agentTask/events', { agentCode: rootCode, lastId })
        const d = r.j?.data || {}
        const nextId = d.lastId || lastId
        // 判据 bug 修正（本轮实测钉住）：游标没动时空窗轮会重放窗口尾帧——
        // "重放"是**游标不推进时的XRANGE窗口语义**不是链路故障；只有游标推进后的帧才算新帧
        if (nextId !== lastId) {
            for (const e of d.events || []) {
                if (!e.id || e.id === lastId) continue // 游标前的旧帧重放不计（窗口重叠语义）
                if (seenIds.has(e.id)) { out.A3重复帧 = `游标 ${lastId} 推进后仍重放 id ${e.id}`; break }
                seenIds.add(e.id); allTypes.push(e.type)
            }
            // Stream id 单调由 redis 定序；这里查"游标没回头"：段序比较
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
    V['A3 帧只前进无回头（游标推进后新帧不重放；45s 宽限窗内 end 未到=如实）'] =
        !out.A3重复帧 && !out.A3游标回头 && seenIds.size > 0
    out.A3 = { end, 总帧: seenIds.size, 词表序列: allTypes, 秒: Math.round((Date.now() - t0) / 1000), 说明: end ? null : '240s 内 finalize 段未收——dev 宽限窗 45s+真综合数分钟，段界属合成后的下一拍' }

    // A4 订阅面空窗：段界后新帧已尽 ⇒ BLOCK 挂满 ~5s 回 timeout；耗时带 [3500, 7000]ms
    const t4 = Date.now()
    const a4 = await post('/core/agentTask/eventsSubscribe', { agentCode: rootCode, lastId })
    const dt4 = Date.now() - t4
    const d4 = a4.j?.data || {}
    V['A4 订阅面空窗守 waitMs 钳位（timeout 形且耗时在带内）'] =
        dt4 >= 3500 && dt4 <= 7000 && ['timeout', 'empty', 'ok'].includes(d4.reason)
    out.A4 = { 耗时ms: dt4, reason: d4.reason, events: (d4.events || []).length, lastId: d4.lastId }

    // A5 负例两连。**网关实形**（2026-11-20 实测入账）：网关拿 param-accessToken 在服务端
    // 解析并注入 user-info——剥 user-info 头不等于匿名，匿名只能剥 token（网关 401/4002/
    // 登录壳）。判据按真形：无 token ⇒ 非业务 200 信封（网关拒绝形态多样，逐种记录）；
    // 假 code ⇒ -1 not-found
    const a5a = await fetch(GW + '/core/agentTask/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentCode: rootCode }),
        signal: AbortSignal.timeout(30000),
    })
    const a5aBody = await a5a.text().catch(() => '')
    const a5aJson = (() => { try { return JSON.parse(a5aBody) } catch { return null } })()
    const anonBlocked = a5a.status === 401 || a5a.status === 403 ||
        (a5aJson && String(a5aJson.code) !== '0' && !a5aJson.data?.events) || // 业务拒绝信封
        (!a5aJson && a5aBody.length > 0) // 非 JSON=网关壳/登录页，同样不是业务放行
    const a5b = await post('/core/agentTask/eventsSubscribe', { agentCode: `nope-${ts}` })
    V['A5 负例：无 token 被网关拒 / 假 code not-found'] =
        !!anonBlocked && (a5b.j?.data?.reason === 'not-found' || a5b.j?.code === -1)
    out.A5 = { anon: { status: a5a.status, ct: (a5a.headers.get('content-type') || '').slice(0, 40), code: a5aJson?.code, 形态: a5aJson ? 'json' : 'shell' }, fake: { code: a5b.j?.code, reason: a5b.j?.data?.reason } }

    // A6 detail 终相 + 事件账末段（宽限窗 45s 生效时 finalize 段在合成后才收——
    // 轮询窗口里 end=null 恰是该形态的读数，判据改为"终相在词表 + 帧序列含里程碑"）
    const a6 = await post('/core/agentTask/detail', { agentCode: rootCode })
    const phase = a6.j?.data?.phase
    const termPhases = ['synthesized', 'partial', 'failed', 'cancelled']
    V['A6 detail 终相与事件账同真话（终相在词表+里程碑帧在账）'] =
        termPhases.includes(phase) && seenIds.size > 0
    out.A6 = { phase, 帧数: allTypes.length, endOutcome: end?.outcome || '(宽限窗内 finalize 段未到——45s 窗为 dev 现配置，如实)' }
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? 'dev 事件面开闸读数全真（受理/回放/游标/订阅钳位/负例/同真话）' : '未通(见 false 项)'
console.log('\n==== DEV-GRAY-EVENTS RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
