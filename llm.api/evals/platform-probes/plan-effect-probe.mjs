/**
 * @fileOverview PR-M 真中继效果探针：本地起服务带 plan_enabled/finalize_selfCheck，跑真实 relay，读档案看效果
 * @module evals/platform-probes/plan-effect-probe
 * @description
 * §10.3 诚实边界说"真实模型下 update_plan 会不会被用、recitation/self-check/跨轮 seed 有没有用，是开起来才能答的"。
 * 本探针就把这三件事在真 relay 上量一次：**只打印元数据（有没有计划、几个未结、段类型、是否并入补充、答案字数），
 * 绝不打印模型正文/入参/任何凭据**。用合成会话码 + 本地进程开开关（不动共享 dev 部署 env）。
 *
 * 设计：同一个 conversationCode 连跑 2 轮——
 *   轮1：让模型"先建计划(3步)再逐步做，最后总结全部三步"。这类任务模型常只做细第1步就宣布完成，
 *        于是**自然**触发完成性反问（如果它真在用 update_plan）。测：会不会用 update_plan / self-check 有没有并回补充。
 *   轮2：一句"把上面计划里没做完的继续做完"。测 B1 跨轮 seed：本轮计划是否从轮1档案捡回（recitation 里带着它）。
 * 效果读数（不看内容看形状）：
 *   - 每轮 `extInfo.plan` 是否存在 ⇒ 模型真的调了 update_plan；
 *   - `plan.openRemaining` ⇒ 结束时仍有未结（self-check 该触发的形状）；
 *   - `segments` 是否含 `self-check` ⇒ self-check 触发**且**模型认了要补（append 路径）；
 *   - 轮2 有 plan 但本轮不重发 update_plan 也能"接着做" ⇒ 跨轮 seed 生效。
 * 用法（本地 server 带 plan_enabled/finalize_selfCheck 起来后）：
 *   $env:PROBE_BASE='http://127.0.0.1:12033'; node evals/platform-probes/plan-effect-probe.mjs [--turns=2]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12033'
const OUT = val('out', '')

await import('../../init.js')
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default

const ui = Buffer.from(JSON.stringify({userCode: 'menglb', realName: 'PR-M 效果探针'})).toString('base64')
const cc = `prmeffect-${Date.now()}`

async function oneTurn(query) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 180000)
    let frames = 0
    let done = false
    let err = null
    try {
        const res = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
            body: JSON.stringify({query, conversationCode: cc, options: {channel: 'micro_common', protocol: 2, cache: false}}),
            signal: ac.signal,
        })
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of res.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                frames++
                if (/event:done/.test(f)) done = true
            }
        }
    } catch (e) {
        err = String(e?.message || e).slice(0, 60)
    } finally {
        clearTimeout(timer)
    }
    return {frames, done, err}
}

// 读最新一条档案，只看形状（不取正文文本，只取长度/有无）
async function readLatestShape() {
    const doc = await messageDac.getOneByFilter({conversationCode: cc}, null, {sort: {insertTime: -1}})
    const ext = doc?.extInfo || {}
    const plan = ext.plan || null
    const segKinds = Array.isArray(ext.segments) ? ext.segments.map((s) => s.kind) : []
    // 本轮有没有真的调 update_plan：看 tool 调用轨迹里有没有这个名字（不取参数正文）
    const tc = Array.isArray(ext.toolCalls) ? ext.toolCalls.map((t) => t.name) : []
    const calledUpdatePlanThisTurn = tc.includes('update_plan')
    return {
        progress: doc?.progress,
        answerChars: String(doc?.answer || '').length,
        hasPlan: !!plan && Array.isArray(plan.items) && plan.items.length > 0,
        planItems: plan?.items?.length ?? 0,
        planOpen: plan?.openRemaining ?? null,
        planStatuses: plan?.items?.map((it) => it.status) ?? [],
        segKinds,
        selfCheckSealed: segKinds.includes('self-check'),
        toolNamesThisTurn: tc,
        calledUpdatePlanThisTurn,
        loopExit: ext.loopExit,
        iterationCount: ext.iterationCount,
        modelCalls: ext.usage?.modelCalls ?? null,
    }
}

const t1 = '我要你处理一个分三步的任务，并且**必须先用 update_plan 建立这三步的计划**（每步一条 pending），再逐步执行：' +
    '第1步 用一句话说明"会话执行体"是什么；第2步 用一句话说明"完成性反问"防的是什么错；第3步 用一句话给出你对此前两步关系的判断。' +
    '每做完一步把对应计划项改成 done。做完三步后，把三步各自的那句话汇总给我。'
const t2 = '如果上面还有计划项没做完，请把它做完并更新计划；若都已 done，只回一句"已全部完成"即可。'

const turns = Number(val('turns', 2))
const report = {conversationCode: cc, at: new Date().toISOString(), rounds: []}

const r1 = await oneTurn(t1)
const s1 = await readLatestShape()
report.rounds.push({轮: 1, 客户端: r1, 档案: s1})

if (turns >= 2) {
    const r2 = await oneTurn(t2)
    const s2 = await readLatestShape()
    report.rounds.push({轮: 2, 客户端: r2, 档案: s2})
}

// 效果判定（只看形状）
const rounds = report.rounds
const usedPlan = rounds.some((r) => r.档案.calledUpdatePlanThisTurn)
const selfCheckSealed = rounds.some((r) => r.档案.selfCheckSealed)
// 跨轮 seed：某一轮档案里有计划，但**本轮并没有调 update_plan** ⇒ 计划只能是从上一轮 extInfo.plan 捡回来的
const seedCarried = rounds.some((r) => r.档案.hasPlan && !r.档案.calledUpdatePlanThisTurn)
report.判定 = {
    '模型真用了 update_plan（本轮自己调的）': usedPlan,
    '完成性反问触发且并回补充（self-check 段存在）': selfCheckSealed,
    '跨轮 seed 生效（某轮有计划但本轮没重发 update_plan ⇒ 从上轮档案捡回）': seedCarried,
    说明: '本探针只量形状不评内容。self-check 未触发时不代表没接线，而是这轮模型把计划都做完了（openRemaining=false ⇒ 按设计不该 nag）；'
        + 'fake-relay 那刀（1c59b90）已证 CONTINUE 分支会封 self-check 段并并入补充，两把合起来才完整。',
}
const line = JSON.stringify(report, null, 1)
console.log(line)
if (OUT) fs.writeFileSync(OUT, line, 'utf8')
process.exit(0)
