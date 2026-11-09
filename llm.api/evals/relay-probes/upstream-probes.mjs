/**
 * @fileOverview 上游（relay）能力探针：usage / 隐式缓存 / 槽序 / thinking 与 effort
 * @module evals/relay-probes/upstream-probes
 * @description
 * 对应 `docs/session-run-plan.md` §16.3 的 P-0/P-1/P-2/P-2b/P-3/P-3b，以及 §16.4 的数据来源。
 * 凭据**不写在本文件里**：从 `conf/system.config.js` 的 `relayBase` 默认值就地解析，
 * 与线上取配置的方式一致，因此也能验证"配置里写的东西上游到底认不认"。
 *
 * 三条硬约束：
 * 1. **只读探针，不写库**：不产生 message/conversation/artifact，随便在生产环境跑（会产生真实 token 费用，见下）。
 * 2. **不接受"200 即成功"**：所有参数类结论都必须落到可观测字段（`reasoning_tokens`/`cached_tokens`/响应 `model`），
 *    因为实测 relay 对未知参数一律静默接受（§16.4 P-3）。
 * 3. **成本可控**：`--quick` 只跑最小集合（约 20 次调用、max_tokens ≤ 32）；全量 effort 表是 n×模型×变体，费用自估。
 *
 * 用法（在 `src/` 下）：
 *   node evals/relay-probes/upstream-probes.mjs                 # 全量
 *   node evals/relay-probes/upstream-probes.mjs --quick         # 最小集：P-0/P-1/P-2/P-2b
 *   node evals/relay-probes/upstream-probes.mjs --models=common-pro,deepseek-pro
 *   node evals/relay-probes/upstream-probes.mjs --effort-only   # 只出 PR-N 需要的能力表
 * @author menglb 2026-11-08
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CFG_PATH = path.join(__dirname, '../../conf/system.config.js')

/* ---------- 配置解析：只读默认值，不打印密钥 ---------- */
function readRelayTarget() {
    const src = fs.readFileSync(CFG_PATH, 'utf8')
    const pick = (re, label) => {
        const m = src.match(re)
        if (!m) throw new Error(`未能从 ${CFG_PATH} 解析出 ${label}；若 relayBase 的写法变了，请同步本探针`)
        return m[1]
    }
    return {
        base: pick(/baseURL: process\.env\[`\$\{key\}_baseURL`\] \|\| '([^']+)'/, 'baseURL 默认值').replace(/\/$/, ''),
        key: pick(/apiKey: process\.env\[`\$\{key\}_apiKey`\] \|\| '([^']+)'/, 'apiKey 默认值'),
    }
}

const {base: BASE, key: KEY} = readRelayTarget()
const CHAT_URL = `${BASE}/chat/completions`
const MODELS_URL = `${BASE}/models`

const argv = process.argv.slice(2)
const has = (f) => argv.includes(`--${f}`)
const valOf = (name, dflt) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`))
    return hit ? hit.split('=')[1] : dflt
}
const QUICK = has('quick')
const EFFORT_ONLY = has('effort-only')
const MODELS = valOf('models', 'common-pro,common-flash,common-low,qwen-pro,qwen-flash,deepseek-pro,deepseek-flash').split(',')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const emit = (obj) => console.log(JSON.stringify(obj))
const median = (arr) => {
    const s = arr.filter(x => typeof x === 'number' && x >= 0).sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : null
}

/**
 * @description 发一次流式请求，收集探针需要的四类可观测证据
 * @param {Object[]} messages 消息数组
 * @param {Object} [extra] 附加到请求体的参数（thinking/effort 等）
 * @returns {Promise<Object>} {http, model, usage, reasoningSeen, chunks, ms, error}
 */
async function probeCall(messages, extra = {}) {
    const t0 = Date.now()
    const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`},
        body: JSON.stringify({model: extra.model || 'common-pro', max_tokens: extra.maxTokens ?? 32, messages, stream: true, ...extra.body}),
        signal: AbortSignal.timeout(90000),
    })
    if (!res.ok) {
        return {http: res.status, error: (await res.text().catch(() => '')).slice(0, 300), ms: Date.now() - t0}
    }
    const dec = new TextDecoder()
    let buf = '', usage = null, model = null, reasoningSeen = false, chunks = 0, usageChunks = 0
    for await (const cv of res.body) {
        buf += dec.decode(cv, {stream: true})
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            let j
            try { j = JSON.parse(data) } catch { continue }
            chunks++
            if (j.model) model = j.model
            if (j.usage) { usage = j.usage; usageChunks++ }
            if (j.choices?.[0]?.delta?.reasoning_content) reasoningSeen = true
        }
    }
    return {http: res.status, model, usage, reasoningSeen, chunks, usageChunks, ms: Date.now() - t0}
}

/* ---------- P-0 上游指纹 ---------- */
async function p0() {
    try {
        const r = await fetch(MODELS_URL, {headers: {Authorization: `Bearer ${KEY}`}, signal: AbortSignal.timeout(15000)})
        const j = await r.json().catch(() => null)
        emit({probe: 'P-0 models', http: r.status, count: j?.data?.length, ids: (j?.data || []).map(m => m.id)})
    } catch (e) {
        emit({probe: 'P-0 models', error: String(e.message || e)})
    }
}

/* ---------- P-1 usage 可用性（带/不带 stream_options） ---------- */
async function p1() {
    const msgs = [{role: 'user', content: '用一个词回答：1+1等于几？'}]
    const withOpt = await probeCall(msgs, {body: {stream_options: {include_usage: true}}})
    const without = await probeCall(msgs, {body: {}})
    emit({
        probe: 'P-1 usage',
        with_stream_options: {usage: withOpt.usage, usageChunks: withOpt.usageChunks, model: withOpt.model},
        without_stream_options: {usage: without.usage, usageChunks: without.usageChunks, model: without.model},
        结论: without.usage ? '不带 stream_options 也有 usage → PR-0.2 无上游依赖' : '必须带 stream_options.include_usage',
    })
}

/* ---------- P-2 隐式前缀缓存 ---------- */
const LONG_PREFIX = '你是一名高校师生教、学助手。以下是稳定背景资料：\n' +
    Array.from({length: 40}, (_, k) =>
        `条目${k + 1}：教学设计需覆盖目标、学情、活动、评价四要素；${'活动设计应体现以学生为中心的参与式学习，评价应体现目标达成度与证据链。'.repeat(3)}`).join('\n')

async function p2() {
    const runs = []
    for (let n = 1; n <= 3; n++) {
        const r = await probeCall([
            {role: 'system', content: LONG_PREFIX},
            {role: 'user', content: `第${n}次提问：只回答数字 7。`},
        ], {body: {enable_thinking: false, stream_options: {include_usage: true}}})
        runs.push({n, prompt: r.usage?.prompt_tokens, cached: r.usage?.prompt_tokens_details?.cached_tokens, ms: r.ms})
        await sleep(2500)
    }
    emit({probe: 'P-2 隐式缓存', runs, 结论: runs.slice(1).some(r => r.cached > 0) ? '上游确有前缀缓存，第二次起命中' : '未观测到命中'})
}

/* ---------- P-2b 槽序实验（v3：布局各自独立前缀，避免跨布局预热污染） ---------- */
/**
 * 为什么 v2 的结论不可信：A/B 共用同一个 system 前缀，先跑的那一轮会把这段缓存"喂"给后跑的那一轮，
 * 于是 cached 数值受**执行顺序**支配而不是布局本身（实测两次跑出相反结论）。
 * v3 的做法：① 每个布局用**各自唯一的 system 盐**，缓存互不共享；② 布局顺序可交替；
 * ③ 只统计稳态（跳过前 2 轮预热）；④ 同时报告"理论上限"= 该布局下可缓存前缀的字节长度。
 */
const stableSystem = (salt) => `你是一名高校师生教、学助手。[布局标识 ${salt}]` + Array.from({length: 60}, () =>
    '规范：回答须给出依据；不确定时明确说明不确定；引用需标注来源编号；步骤化解释优先于结论堆砌；避免虚构数据与夸大表述。').join('')
const VOLATILE = (n) => `【检索片段·第${n}轮】\n` + Array.from({length: 10}, (_, k) =>
    `r${n}-${k}: 本轮命中的教学资料片段，内容随问题变化，长度约 ${120 + ((n * 7 + k) % 40)} 字。`).join('\n')
const historyUpTo = (turns) => {
    const h = []
    for (let t = 1; t <= turns; t++) {
        h.push({role: 'user', content: `历史第${t}轮提问：请解释教学要素${t}。`})
        h.push({role: 'assistant', content: `历史第${t}轮回答：要素${t}指` + '目标、学情、活动、评价四者之间的对齐关系与证据链要求。'.repeat(4) + '。'})
    }
    return h
}

async function p2b() {
    const layouts = {
        'A_现状_system_fixed_history': (n, t) => [{role: 'system', content: stableSystem('A')}, {role: 'user', content: VOLATILE(n)}, ...historyUpTo(t), {role: 'user', content: `第${n}问：只回答数字。`}],
        'B_改后_system_history_fixed': (n, t) => [{role: 'system', content: stableSystem('B')}, ...historyUpTo(t), {role: 'user', content: VOLATILE(n)}, {role: 'user', content: `第${n}问：只回答数字。`}],
    }
    const rounds = QUICK ? 4 : 8
    const warmup = 2
    const results = {}
    for (const [name, build] of Object.entries(layouts)) {
        const runs = []
        for (let n = 1; n <= rounds; n++) {
            const r = await probeCall(build(n, n), {body: {enable_thinking: false, stream_options: {include_usage: true}}})
            const prompt = r.usage?.prompt_tokens, cached = r.usage?.prompt_tokens_details?.cached_tokens
            runs.push({turn: n, prompt, cached, nonCached: prompt != null && cached != null ? prompt - cached : null, ms: r.ms})
            await sleep(2500)
        }
        const steady = runs.slice(warmup).filter(r => r.nonCached != null)
        results[name] = {
            runs,
            steadyAvgNonCached: Math.round(steady.reduce((s, r) => s + r.nonCached, 0) / (steady.length || 1)),
            steadyAvgCached: Math.round(steady.reduce((s, r) => s + r.cached, 0) / (steady.length || 1)),
            steadyAvgPrompt: Math.round(steady.reduce((s, r) => s + r.prompt, 0) / (steady.length || 1)),
        }
    }
    const a = results['A_现状_system_fixed_history'], b = results['B_改后_system_history_fixed']
    const delta = a.steadyAvgNonCached - b.steadyAvgNonCached
    emit({
        probe: 'P-2b 槽序 v3（独立前缀 + 稳态）',
        A: {steadyAvgPrompt: a.steadyAvgPrompt, steadyAvgCached: a.steadyAvgCached, steadyAvgNonCached: a.steadyAvgNonCached},
        B: {steadyAvgPrompt: b.steadyAvgPrompt, steadyAvgCached: b.steadyAvgCached, steadyAvgNonCached: b.steadyAvgNonCached},
        每轮节省非缓存token: delta,
        判定: delta <= 0
            ? 'B 不比 A 省 → 上游只缓存 system 段，槽序无缓存收益（D22 的缓存理由不成立）'
            : (delta < 200 ? `B 略省（约 ${delta} token/轮，量级≈1 个缓存块）→ 收益存在但很小，不足以支撑单独排期`
                : `B 显著省（${delta} token/轮）→ PR-T0 的缓存收益成立`),
    })
}

/* ---------- P-3/P-3b 真实模型映射 + thinking/effort 能力表 ---------- */
const VARIANTS = {
    thinking_off: {enable_thinking: false},
    thinking_on: {enable_thinking: true},
    effort_low: {enable_thinking: true, reasoning_effort: 'low'},
    effort_medium: {enable_thinking: true, reasoning_effort: 'medium'},
    effort_high: {enable_thinking: true, reasoning_effort: 'high'},
    claude_style_budget: {thinking: {type: 'enabled', budget_tokens: 1024}},
}

async function p3() {
    const n = QUICK ? 2 : 5
    const Q = '简述牛顿第二定律，一句话。'
    for (const model of MODELS) {
        /*真实模型 + 参数是否被静默接受*/
        for (const thinking of [false, true]) {
            const r = await probeCall([{role: 'user', content: Q}], {model, body: {enable_thinking: thinking, stream_options: {include_usage: true}}})
            emit({probe: 'P-3b model', model, enable_thinking: thinking, realModel: r.model, reasoningSeen: r.reasoningSeen, reasoning: r.usage?.completion_tokens_details?.reasoning_tokens, prompt: r.usage?.prompt_tokens, cached: r.usage?.prompt_tokens_details?.cached_tokens, http: r.http, error: r.error})
        }
        /*effort 能力表：中位数 + 是否单调*/
        const table = {}
        for (const [vname, extra] of Object.entries(VARIANTS)) {
            const samples = []
            for (let k = 0; k < n; k++) {
                const r = await probeCall([{role: 'user', content: Q}], {model, maxTokens: 128, body: {...extra, stream_options: {include_usage: true}}})
                samples.push(r.usage?.completion_tokens_details?.reasoning_tokens ?? -1)
            }
            table[vname] = {samples, median: median(samples)}
        }
        const levels = [table.effort_low.median, table.effort_medium.median, table.effort_high.median]
        /** 单调 = low ≤ medium ≤ high（逐级不减少）；与 thinking_on 的比较单独用 lowSaves 表达 */
        const monotonic = levels.every((v, i) => i === 0 || v == null || levels[i - 1] == null || v >= levels[i - 1])
        const lowSaves = table.effort_low.median != null && table.thinking_on.median != null && table.effort_low.median < table.thinking_on.median
        emit({
            probe: 'P-3b effort 能力表', model, table, monotonic, lowSaves,
            判定: table.effort_low.median == null
                ? '未观测到 reasoning_tokens，无法判定（该模型可能不返回该字段）'
                : (lowSaves && monotonic ? 'effort 有效且单调 → 可入路由表'
                    : (!lowSaves ? 'effort 无效或反向 → 该模型禁止发 reasoning_effort（D43）'
                        : 'low 省但非单调 → 样本不足，加大 n 再判')),
        })
    }
}

/* ---------- 入口 ---------- */
console.log(`# relay=${BASE} keyLen=${KEY.length} quick=${QUICK} models=${MODELS.join(',')}`)
if (has('p2b-only')) {
    await p2b()
} else if (EFFORT_ONLY) {
    await p3()
} else {
    await p0()
    await p1()
    await p2()
    await p2b()
    await p3()
}
console.log('# 完成。把结论回填 docs/session-run-plan.md §16.4')
