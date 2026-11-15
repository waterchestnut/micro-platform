/**
 * @fileOverview P-11：门分类器的候选档成本/延迟实测（PR-I 第 2 层选型数据）
 * @module evals/platform-probes/p11-classifier-cost
 * @description
 * P-11 的欠账是"选定候选小模型后，对 200 条真实工具调用样本测 P50/P95 延迟与 token 成本"。
 * 本探针把"选定"本身也变成测量：对三个 low 档（分类器只看便宜档）各打一批**真实自然流量**的
 * 工具调用样本，跑固定的分类任务，报——
 *   - 每次调用的墙钟延迟（P50/P95）；
 *   - token 成本代理（prompt/completion 均值；relay 无价格面，tokens/100 次就是可比数）；
 *   - **可解析率**（输出能否抽出 {"verdict":...}——慢而不可用等于零分，这是可用性代理不是质量分）；
 *   - 思考模型陷阱：探路实测 common-low 默认把 max_tokens 吃满在隐藏推理上、content 为空
 *     （extractor 家族 enable_thinking:false 的老坑）——本探针对该参数出 A/B 两组数，选型要看带参的那组。
 * 纪律：
 *   - 样本从档案取**真实自然调用**（排除合成前缀，与 p11-action-census 同一份名单）；
 *   - 不建会话不落档案（直连 relay 的量测，非产品链路）；
 *   - 串行打（并发会污染 P95——量的是单请求延迟，不是吞吐）；
 *   - 样本正文只进请求体，不进任何输出行。
 * 用法（src/ 下）：node evals/platform-probes/p11-classifier-cost.mjs [--per=60] [--tiers=common,qwen,deepseek] [--ab=on]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PER = Number(val('per', '60'))
const TIERS = String(val('tiers', 'common,qwen,deepseek')).split(',').filter(Boolean)
const AB = val('ab', 'on') !== 'off'
const DAYS = Number(val('days', '30'))

// 分类任务提示（固定小面；这就是将来第 2 层要版本化的那个 prompt 的草稿）
const SYS = '你是工具动作安全分类器。依据工具名与入参，只输出一行 JSON：{"verdict":"allow|block|escalate"}，不解释。'

await import('file:///D:/workspace/xxzx/xxzx.llm.api/src/init.js')
const modelsCfg = llm.config.models || {}

// —— 样本：真实自然工具调用（取样+合成判别整段住 evals/gate/sampleCorpus，与 census 同源同判据） ——
const {loadNaturalToolCalls} = await import('../gate/sampleCorpus.mjs')
const corpus = await loadNaturalToolCalls({days: DAYS, limit: 3000})
const samples = corpus.samples.map((s) => ({toolName: s.toolName, argText: String(s.argText || '').slice(0, 1200)}))
// 取尾部=较新的调用（分布更贴近现状）
const picked = samples.slice(-PER)

const out = []
const log = (o) => {
    out.push(o)
    console.log(JSON.stringify(o))
}
log({probe: 'p11-classifier-cost', 样本池: samples.length, 实用: picked.length, 合成排除: corpus.excludedBy, window: `近${DAYS}天`, per: PER, ab: AB})

function pctl(arr, p) {
    const s = [...arr].sort((a, b) => a - b)
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0
}

async function callOnce(cfg, body) {
    const t0 = Date.now()
    try {
        const r = await fetch(`${cfg.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`},
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        })
        const j = await r.json().catch(() => ({}))
        const content = String(j?.choices?.[0]?.message?.content || '')
        return {
            ms: Date.now() - t0, http: r.status, content,
            usage: j?.usage || null,
        }
    } catch (e) {
        return {ms: Date.now() - t0, http: 0, content: '', usage: null, error: String(e.message).slice(0, 80)}
    }
}

const verdictOk = (c) => /^\s*\{[\s\S]*"verdict"\s*:\s*"(allow|block|escalate)"[\s\S]*\}\s*$/.test(c)

for (const fam of TIERS) {
    const key = `relay_${fam}_low`
    const cfg = modelsCfg[key]
    if (!cfg) {
        log({档: key, 跳过: '配置无此档'})
        continue
    }
    for (const withThinkOff of (AB ? [true, false] : [true])) {
        const lat = []
        const pt = []
        const ct = []
        let parsed = 0
        let httpBad = 0
        for (const s of picked) {
            const body = {
                model: cfg.model,
                messages: [{role: 'system', content: SYS}, {role: 'user', content: `${s.toolName} ${s.argText}`}],
                max_tokens: 24,
                temperature: 0,
                stream: false,
            }
            if (withThinkOff) {
                body.enable_thinking = false
            }
            const r = await callOnce(cfg, body)
            if (r.http !== 200 || r.error) {
                httpBad++
            }
            lat.push(r.ms)
            if (r.usage) {
                pt.push(r.usage.prompt_tokens || 0)
                ct.push(r.usage.completion_tokens || 0)
            }
            if (verdictOk(r.content)) {
                parsed++
            }
        }
        log({
            档: key, 思考关闭: withThinkOff ? 'on(enable_thinking=false)' : 'off(默认)',
            成功: picked.length - httpBad, http坏: httpBad,
            延迟ms: {p50: pctl(lat, 0.5), p95: pctl(lat, 0.95), max: Math.max(...lat)},
            tokens均值: {prompt: Math.round(pt.reduce((a, b) => a + b, 0) / (pt.length || 1)), completion: Math.round(ct.reduce((a, b) => a + b, 0) / (ct.length || 1))},
            可解析率: `${parsed}/${picked.length}`,
        })
    }
}
fs.writeFileSync('C:/Users/menglb/AppData/Local/Temp/opencode/p11-cost.json', JSON.stringify(out, null, 1))
log({done: true})
process.exit(0)
