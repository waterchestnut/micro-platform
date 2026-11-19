/**
 * @fileOverview PR-M 接线端到端取证：让真 execChat 走一遍，验证接线确实发生（不只是源码形状）
 * @module evals/platform-probes/plan-e2e-probe
 * @description
 * 这是本档反复守的纪律的又一次应用：**"接线守卫绿" ≠ "主循环真按这条线走了一遍"**。
 * `planWiring.test.js` 是源码级模式匹配，证不了运行时真的：下发过 update_plan、归一进了 currentPlan、
 * 在发送副本里拼了 recitation、break 后发了完成性反问、并按 CONTINUE 把补充并进了答案+封了段。
 * 本探针用假中继把这条链跑通，再从**档案**（`messageDac` 直读，不是视图——`plan` 刻意不进视图）+
 * **中继观测**两侧对齐取证。全程假中继、零真实 token、不落生产租户（只写一条合成本轮到 dev mongo）。
 *
 * 前置（另起两进程，见 `fake-relay-plan.mjs` 头部）：server.js 要带
 * `plan_enabled=true` 与 `finalize_selfCheck=true`，否则测的就是默认关的"什么都不发生"。
 *
 * 判据（全真才算通过）：
 * - 中继侧：发过 update_plan；某一轮发送副本里出现 recitation 标记；发生过一次无 tools 的完成性反问调用。
 * - 档案侧：`extInfo.plan` 有 2 条且含 pending；`extInfo.segments` 含 `self-check`；
 *   最终答案同时含原答案与"补充"（CONTINUE 分支确实并入了）。
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12031'
const OBSERVE = val('observe', '')
const ui = Buffer.from(JSON.stringify({userCode: 'menglb', realName: 'PR-M 接线取证'})).toString('base64')
const cc = `prme2e-${Date.now()}`

await import('../../init.js')
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default

// 驱动一轮真实对话（走假中继）
const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), 120000)
const st = {帧: 0, done: false, err: null}
try {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
        body: JSON.stringify({
            query: '请按计划分两步完成后给结论。',
            conversationCode: cc,
            options: {channel: 'micro_common', protocol: 2, cache: false},
        }),
        signal: ac.signal,
    })
    const dec = new TextDecoder()
    let buf = ''
    for await (const cv of res.body) {
        buf += dec.decode(cv, {stream: true})
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
            const f = buf.slice(0, i); buf = buf.slice(i + 2)
            st.帧++
            if (/event:done/.test(f)) st.done = true
        }
    }
} catch (e) {
    st.err = String((e && e.message) || e).slice(0, 80)
} finally {
    clearTimeout(timer)
}
console.log(JSON.stringify({客户端: st, conversationCode: cc}))

// 中继观测
let obs = {}
try {
    obs = JSON.parse(fs.readFileSync(OBSERVE, 'utf8'))
} catch (e) {
    obs = {读取失败: String(e?.message).slice(0, 60)}
}

// 档案回读（直读 mongo，plan 不在视图里）
const doc = await messageDac.getOneByFilter({conversationCode: cc}, null, {sort: {insertTime: -1}})
const ext = doc?.extInfo || {}
const plan = ext.plan || null
const segKinds = Array.isArray(ext.segments) ? ext.segments.map((s) => s.kind) : []
const answer = String(doc?.answer || '')

const checks = {
    '中继:发过update_plan': obs.updatePlanToolCallSent === true,
    '中继:发送副本含recitation': obs.recitationInSendCopy === true,
    '中继:发生过完成性反问调用': obs.selfCallCheckHappened === true,
    '档案:extInfo.plan有2条': !!plan && Array.isArray(plan.items) && plan.items.length === 2,
    '档案:计划仍有pending项': !!plan && plan.openRemaining === true,
    '档案:段含self-check': segKinds.includes('self-check'),
    '档案:答案并入了补充': answer.includes('补充：我确实漏了步骤B'),
    '档案:保留了原答案': answer.includes('这是基于计划的最终回答'),
}
const allPass = Object.values(checks).every(Boolean)
console.log(JSON.stringify({
    中继观测: obs,
    档案: {progress: doc?.progress, planItems: plan?.items || null, planOpen: plan?.openRemaining ?? null, segKinds, answerChars: answer.length},
    判定项: checks,
    结论: allPass
        ? '通过：PR-M 接线端到端确实发生（下发→归一→recitation→完成性反问→并入补充+封段），非仅源码形状'
        : '未通过：见上表中 false 项——某段接线没在真循环里走到，需回查（不要把源码守卫绿当成运行时已验证）',
}, null, 1))
process.exit(allPass ? 0 : 3)
