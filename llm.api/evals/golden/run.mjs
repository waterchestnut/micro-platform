/**
 * @fileOverview golden 跑批器（PR-J 跑批设施·执行面）
 * @module evals/golden/run
 * @description
 * 每例 k 次打真 relay（网关 token），判分只信**档案**不信流（流的终点只用于拿 messageCode 与终态，
 * answer/progress 从库里读——请求形态先读了 abort-archive-probe 的现文再抄形，不凭记忆）。
 *
 * 四条影响数字有效性的决定，都在代码里可指认：
 * 1. **memory 强制关、cache 强制 false**：k 次重复是独立采样；上一 attempt 的问答被 capture 进
 *    同一 token 用户的记忆再被 recall 回来，测的就不是"同一条件下重复答"而是"背过题之后答"。
 *    数字要能横比，条件必须钉住（policy 层 options.memory.enabled=false 是现成入口）。
 * 2. **conversationCode 每 attempt 全新**（eval-golden-<case>-a<n>）：题内多步的会话历史是
 *    用例自带的需求，跨 attempt 的历史不是。
 * 3. **流水线故障 ⇒ run=null（insufficient），不是 false**：HTTP 挂了、读库挂了、超时——
 *    是仪器掉链子，不该记在被测系统头上（passK 家规，判分入口 runChecks 的 error 分支）。
 * 4. **泄漏扫描如实报告"跳过了多少"**：短 gold（<24 字符）模糊匹配必误报，判据层把它们跳过并
 *    计数——跑批器把 skippedShort 原样上报，绝不把"跳过了"印成"扫过了"（D32 的诚实半边）。
 *
 * 用法（在 `src/` 下）：
 *   DEV_TOKEN=<urlencoded token> node evals/golden/run.mjs [--k=2] [--smoke] [--only=id1,id2]
 *     [--base=https://api.xxzx.paretop.net/llm] [--channel=xxzx_common] [--out=result.json]
 *     [--baseline=prev.json]
 * 凭据只走 env 或 --token，**不落默认值**（探针里的历史默认值是本仓要还的债，不是可复制的模式）。
 * 台账：eval 在 dev 库留下 conversationCode 前缀 eval-golden- 的档案与账本行，由现存的
 * abandoned/backfill 家族自然可见，不做删除（"残留要记账"纪律，doc.api 探针同款先例）。
 * 时长预算：真 relay 一次问答 5–20s 是物理下限——`--smoke`（8 例 k=1 ≈ 1–2min）是 PR 级门禁位，
 * 全量 k=2 约 15–30min 归 nightly；§15 的 "<5min" 目标按实测拆成两档执行，不假装单档达标。
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || val('base', 'https://api.xxzx.paretop.net/llm')
const TOKEN = process.env.DEV_TOKEN || val('token', '')
const USER_INFO = {userCode: val('user', 'menglb'), realName: 'golden-runner'}
const AUTH = val('auth', TOKEN ? 'gateway' : 'userinfo')
if (AUTH === 'userinfo' && val('base', '') === '') {
    // 直连模式的 BASE 不该是公网网关（网关会把伪造的 user-info 换掉/拒绝），提示改参数而不是静默
    console.log(JSON.stringify({note: 'userinfo 直连模式请用 --base 指到 pod/隧道地址（网关侧只认活 accessToken）'}))
}
const CHANNEL = val('channel', 'xxzx_common')
const K = Number(val('k', '2'))
const SMOKE = argv.includes('--smoke')
const ONLY = val('only', '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = val('out', '')
const BASELINE = val('baseline', '')
const STEP_TIMEOUT_MS = Number(val('stepTimeoutMs', '120000'))

const {CASES, runChecks} = await import('./cases.mjs')
const {suiteReport, reportUsable} = await import('../../services/core/evals/passK.js')
const {scanGoldLeak, reportIsSelfClean} = await import('../../services/core/evals/goldLeak.js')

if (AUTH === 'gateway' && !TOKEN) {
    console.log(JSON.stringify({fatal: 'gateway 模式缺 DEV_TOKEN/--token：跑批必须有网关身份，不猜也不留默认值（探针源码里的历史默认 token 已化石，见 §25）'}))
    process.exit(3)
}

/** smoke 集：5 个最便宜且判据最硬的 happy + 3 个形状型 adversarial（PR 级 <2min 档） */
const SMOKE_IDS = ['zh-capital', 'zh-multiply', 'zh-weekdays', 'zh-summarize-then-answer', 'zh-json-shape',
    'adv-fake-admin-approval', 'adv-api-key-request', 'adv-phone-pii']

/**
 * @description 打一步流，返回终态与 messageCode（正文不采信流——判分从档案读）
 * @param {Object} p {query, conversationCode}
 * @returns {Promise<{messageCode:String, terminal:String, error:String|null}>} 结果
 */
async function streamStep({query, conversationCode}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
    // 鉴权两模式：gateway=param-accessToken（外部入口，要**活** token）；userinfo=直连 pod/隧道时
    // 用网关同款的 user-info 头（loop-regression 在 pod 里的形态）。默认按给了哪个走哪个。
    const headers = {'Content-Type': 'application/json', Accept: 'text/event-stream'}
    if (AUTH === 'userinfo') {
        headers['user-info'] = Buffer.from(JSON.stringify(USER_INFO)).toString('base64')
    } else {
        headers['param-accessToken'] = TOKEN
    }
    try {
        const r = await fetch(`${BASE}/core/chat/stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query,
                conversationCode,
                options: {
                    channel: CHANNEL,
                    protocol: 2,
                    cache: false,
                    /** 独立采样纪律（头注 1）：k 次重复不许被记忆互相污染 */
                    memory: {enabled: false},
                },
            }),
            signal: controller.signal,
        })
        if (!r.ok) {
            return {messageCode: '', terminal: 'http-' + r.status, error: `HTTP ${r.status}`}
        }
        // 网关把 4002（token 无效）包成 HTTP 200 + application/json——这不是流，也不是被测系统的错，
        // 是仪器没接电：如实带出业务码，别让"closed-without-terminal"把鉴权问题伪装成网络问题
        if (!(r.headers.get('content-type') || '').includes('text/event-stream')) {
            const body = await r.text().catch(() => '')
            const code = (/code[":]+(\d+)/.exec(body) || [])[1] || '?'
            return {messageCode: '', terminal: 'not-sse', error: `响应不是 SSE（业务码 ${code}，多半是鉴权/入口问题）`}
        }
        const dec = new TextDecoder()
        let buf = ''
        let messageCode = ''
        let terminal = 'closed-without-terminal'
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let k
            while ((k = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, k)
                buf = buf.slice(k + 2)
                const t = f.trim()
                if (!t || t.startsWith(':')) continue
                const ev = /event:(\S+)/.exec(t)?.[1] || 'delta'
                const raw = (/data:([\s\S]+)/.exec(t)?.[1] || '').replace(/\n/g, '')
                if (ev === 'delta' || ev === 'meta') {
                    try {
                        const mc = JSON.parse(raw)?.messageCode
                        if (mc && !messageCode) messageCode = mc
                    } catch { /* 形状外的帧跳过：判分不信流 */ }
                }
                if (ev === 'done' || ev === 'abort' || ev === 'error') terminal = ev
            }
        }
        return {messageCode, terminal, error: terminal === 'done' ? null : `terminal=${terminal}`}
    } catch (e) {
        return {messageCode: '', terminal: 'exception', error: String(e?.message || e).slice(0, 120)}
    } finally {
        clearTimeout(timer)
    }
}

// 档案直读 dev mongo（backfill 家族先例：init.js 读配置与凭据，不落本文件）
await import('../../init.js')
const {default: messageDac} = await import('../../daos/core/dac/messageDac.js')

/**
 * @description 从档案读判分观测（answer/progress/system 面）
 * @param {String} messageCode 本轮号
 * @returns {Promise<Object>} 观测
 */
async function observe(messageCode) {
    if (!messageCode) {
        return {answer: '', progress: '', error: '流里没拿到 messageCode（流水线故障）', systemText: ''}
    }
    const doc = await messageDac.getByCode(messageCode).catch(() => null)
    if (!doc) {
        return {answer: '', progress: '', error: '档案读不到（流水线故障）', systemText: ''}
    }
    const sysMsg = (Array.isArray(doc.messages) ? doc.messages : []).find((m) => m?.role === 'system')
    return {answer: doc.answer || '', progress: doc.progress || '', error: null, systemText: typeof sysMsg?.content === 'string' ? sysMsg.content : ''}
}

/**
 * @description 跑一个 attempt：全部 steps 发完，判最后一步
 * @param {Object} c 用例
 * @param {Number} attempt 第几次
 * @returns {Promise<{verdict:Boolean|null, systemText:String}|null>} null=流水线故障
 */
async function runAttempt(c, attempt) {
    const conversationCode = `eval-golden-${c.caseId}-a${attempt}-${Date.now().toString(36)}`
    let last = null
    for (const step of c.steps) {
        const s = await streamStep({query: step.query, conversationCode})
        if (s.error) {
            // 仪器故障要当场可见（错误里只有状态与业务码，无凭据无正文）——吞掉它，下一位只能猜
            process.stderr.write(`(仪器:${s.error}) `)
            return null
        }
        last = s
        // 中间步骤（judgeStep:false）只要求正常完成——它坏了整个前提，判流水线故障不判行为失败
        if (step.judgeStep === false) {
            const obs = await observe(s.messageCode)
            if (obs.error || obs.progress !== 'finish') {
                if (obs.error) process.stderr.write(`(仪器:${obs.error}) `)
                return null
            }
        }
    }
    const obs = await observe(last.messageCode)
    if (obs.error) {
        return null
    }
    return {verdict: runChecks(c.check, {answer: obs.answer, progress: obs.progress}), systemText: obs.systemText}
}

const cases = SMOKE ? CASES.filter((c) => SMOKE_IDS.includes(c.caseId)) : (ONLY.length ? CASES.filter((c) => ONLY.includes(c.caseId)) : CASES)
if (!cases.length) {
    console.log(JSON.stringify({fatal: '空用例集跑批没有意义（--only 拼错了？）'}))
    process.exit(3)
}

/** golds/surfaces 按 goldLeak 判据的入参形状给（{caseId,answer} 与 {surface,ref,text}——契约不是我的想象） */
const goldPairs = CASES.flatMap((c) => c.golds.map((g) => ({caseId: c.caseId, answer: g})))
const results = []
const surfaceRows = []
let pipelineFailed = 0
for (const c of cases) {
    const runs = []
    for (let i = 1; i <= K; i++) {
        process.stderr.write(`… ${c.caseId} attempt ${i}/${K} `)
        const r = await runAttempt(c, i)
        if (r === null) {
            runs.push(null)
            pipelineFailed++
            process.stderr.write('×(流水线)\n')
        } else {
            runs.push(r.verdict)
            if (r.systemText) surfaceRows.push({surface: `system:${c.caseId}`, ref: `attempt-${i}`, text: r.systemText})
            process.stderr.write(r.verdict === true ? '✓\n' : r.verdict === false ? '✗\n' : '?\n')
        }
    }
    results.push({caseId: c.caseId, adversarial: c.adversarial, runs})
}

const report = suiteReport(results, {k: K})
const usable = reportUsable(report)
const leak = scanGoldLeak({golds: goldPairs, surfaces: surfaceRows})
const selfClean = reportIsSelfClean(leak, goldPairs)

// 基线回归对比：只有"上次 pass 这次 fail"算回归（verdict 波动不足时不参与比较）
let regressions = []
if (BASELINE && fs.existsSync(BASELINE)) {
    const prev = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    const prevMap = new Map((prev.perCase || []).map((p) => [p.caseId, p.verdict]))
    regressions = report.perCase
        .filter((p) => prevMap.get(p.caseId) === 'pass' && p.verdict === 'fail')
        .map((p) => p.caseId)
}

const summary = {
    meta: {base: BASE, channel: CHANNEL, k: K, smoke: SMOKE, cases: cases.length, attempts: cases.length * K, pipelineFailed, at: new Date().toISOString()},
    totals: report.totals,
    mix: report.mix,
    gap: report.gap,
    usable,
    /** 泄漏扫描报告原样内嵌（判据自净纪律保证它不含 gold 原文），另附跳过计数——没扫的必须可见 */
    leak,
    selfClean,
    regressions,
    perCase: report.perCase,
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 1), 'utf8')
console.log(JSON.stringify({
    totals: summary.totals,
    mix: summary.mix,
    usable: summary.usable,
    leak: {clean: leak.clean, hits: leak.counts.hits, skippedShort: leak.counts.skippedShort},
    selfClean,
    regressions,
    pipelineFailed,
    out: OUT || '(--out 未给，明细不落盘)',
}, null, 1))

/**
 * 退出码：1=报告不可比（配比/不足/泄漏命中/报告带毒），2=基线回归（block merge 的实体），
 * 3=流水线坏过半（这次跑批本身没有证据价值）。
 */
process.exit(
    (!usable.usable || !leak.clean || !selfClean) ? 1
        : regressions.length ? 2
            : pipelineFailed >= (cases.length * K) / 2 ? 3
                : 0
)
