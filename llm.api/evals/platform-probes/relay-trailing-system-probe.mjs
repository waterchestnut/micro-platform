/**
 * @fileOverview relay 是否接受并遵守"末尾 system 消息"（PR-M recitation 注入位的能力前置）
 * @module evals/platform-probes/relay-trailing-system-probe
 * @description
 * PR-M 的 recitation 是把计划重述作为**最后一条消息（role=system）追加到发送副本尾部**（见 planAssembly.withRecitation）。
 * §10.1 明确写了这条的**未验假设**：很多 OpenAI 兼容上游只认第一条 system，中途/末尾的 system 可能被忽略或直接报错。
 * **没有这条读数之前，不能声称 recitation 真的影响模型行为**——它可能只是白占 token。
 *
 * 本探针就用一次最小、可控、合成的往返把这件事量出来，不涉及任何真实用户数据、不打印任何凭据：
 * 给 relay 发三条消息——
 *   1) system：`The secret color is BLUE. Answer with exactly one word.`
 *   2) user ：`What is the secret color?`
 *   3) system（**末尾追加**，模拟 recitation 位置）：`The secret color is RED.`
 * 末尾这条 system 与第一条矛盾。模型答 RED ⇒ 末尾 system **被遵守**；答 BLUE ⇒ 末尾 system **被无视**；
 * 请求直接报错 ⇒ 末尾 system **不被接受**。三种结果对应 recitation 要不要换角色/换位置。
 *
 * 模型有随机性，默认跑 N=3 次（上限 8），逐次给归类，只有出现"遵守"才算 recitation 这条路可行。
 * 成本很小（几条短补全），且用的是 relay 默认档、不是任何生产租户的用户流量。
 *
 * 用法（在 pod 里跑，relay 连接与 model 由环境给）：
 *   node /app/evals/platform-probes/relay-trailing-system-probe.mjs [--n=3] [--model=relay_common_pro] [--out=/tmp/rts.json]
 */
import fs from 'node:fs'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const val = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const N = Math.min(8, Math.max(1, Number(val('n', '3'))))
const MODEL_OVERRIDE = val('model', '')
const OUT = val('out', '')
// 注入位用的角色：system（recitation 原设计）还是 user（备选）。本探针就是用来量哪个真被遵守
const INJECT_ROLE = val('injectRole', 'system')

// 只输出 ASCII 结果码，中文注释不进 JSON，避免 PowerShell 重定向把中文弄乱
const CODE = {HONORED: 'tail-read-and-used', BLIND: 'tail-not-adopted-answered-NONE', OTHER: 'other', ERROR: 'error'}

await import('../../init.js')
const {OpenAI} = await import('openai')

const models = (llm.config && llm.config.models) || {}
const keys = Object.keys(models)
if (keys.length === 0) {
    console.log(JSON.stringify({probe: 'relay-trailing-system', fatal: 'no-models-in-config'}))
    process.exit(2)
}
const pickKey = MODEL_OVERRIDE && models[MODEL_OVERRIDE] ? MODEL_OVERRIDE
    : (models.relay_common_pro ? 'relay_common_pro' : keys.find((k) => models[k]?.apiKey && models[k]?.baseURL && models[k]?.model) || keys[0])
const cfg = models[pickKey] || {}
if (!cfg.apiKey || !cfg.baseURL) {
    // 绝不打印 apiKey / baseURL 的 host 之外的信息；这里连 key 是否存在都不打印值
    console.log(JSON.stringify({probe: 'relay-trailing-system', fatal: 'picked-model-missing-credentials', modelKey: pickKey}))
    process.exit(2)
}

const client = new OpenAI({apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: 60000, maxRetries: 0})

// 判别设计（去掉"首条 vs 末条谁优先"的混淆）：
// 只有**末尾那条注入消息**里带颜色；首条 system 不给任何颜色，只规定"从消息里找出那个颜色词，找不到就答 NONE"。
// 于是：答出 RED ⇒ 末尾消息**被读到并采用**；答 NONE ⇒ 末尾消息**根本没被采纳**。
// 这才真正回答 recitation 的问题："我在尾部加一段，模型到底看不看"，而不是"两个指令打架时听谁的"。
const messages = [
    {role: 'system', content: 'Some message below states a color as "The color is X". Reply with only the single word X. If no message states a color, reply NONE.'},
    {role: 'user', content: 'What is the color?'},
    {role: INJECT_ROLE, content: 'The color is RED.'},
]

function classify(text) {
    const t = String(text || '').toLowerCase()
    if (/\bred\b/.test(t)) return CODE.HONORED
    if (/\bnone\b/.test(t)) return CODE.BLIND
    return CODE.OTHER
}

const samples = []
for (let i = 0; i < N; i++) {
    try {
        const resp = await client.chat.completions.create({model: cfg.model, messages, max_tokens: 8, temperature: 0})
        const content = resp?.choices?.[0]?.message?.content ?? ''
        samples.push({i, verdict: classify(content), replyChars: String(content).length, finish: resp?.choices?.[0]?.finish_reason ?? null})
    } catch (e) {
        // 只取错误类别与状态码，绝不打印响应正文（上游报错可能回显请求片段）
        const status = e?.status || e?.response?.status || null
        samples.push({i, verdict: CODE.ERROR, status, errName: e?.name || null})
    }
}

const tally = samples.reduce((a, s) => (a[s.verdict] = (a[s.verdict] || 0) + 1, a), {})
// 只要出现过一次"读到并采用末尾消息"，就说明这个注入位对模型可见、recitation 有作用空间
const verdict = tally[CODE.HONORED] ? `recitation-${INJECT_ROLE}-injection-IS-read`
    : (tally[CODE.ERROR] && !tally[CODE.BLIND] && !tally[CODE.OTHER] ? `relay-REJECTS-trailing-${INJECT_ROLE}`
        : `trailing-${INJECT_ROLE}-NOT-read(model answered NONE/other)`)

const result = {
    probe: 'relay-trailing-system',
    modelKey: pickKey,
    injectRole: INJECT_ROLE,
    n: N,
    samples,
    tally,
    verdict,
    note: 'tail-read-and-used=模型读到并采用了末尾注入消息；tail-not-adopted-answered-NONE=没采纳；error=上游拒绝该形状。injectRole 两值都测过，是 PR-M recitation 注入位的可行性前置。',
}
const line = JSON.stringify(result)
console.log(line)
if (OUT) {
    fs.writeFileSync(OUT, line + '\n')
}
process.exit(0)
