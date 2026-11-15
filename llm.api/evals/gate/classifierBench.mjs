/**
 * @fileOverview 门第 2 层的评测执行器（离线档=种子政策回归；live 档=分类器+外包 vs 期望）
 * @module evals/gate/classifierBench
 * @description
 * 两档一个执行器：
 *   - **离线档（默认）**：`seedLabel ∘ classifyAction` 逐例对 expect——政策回归闸，无网络无模型，
 *     CI 与套件都能带（用例本体在 gateClassifierCases 测试里同判据钉死，这里是可跑的报告形态）。
 *   - **live 档（--live）**：对每例调一次选型档分类器（P-11 定案的 qwen_low + thinking off），
 *     **打分对象是 decideLayer2 包装后的输出**（裸模型分留 raw 供归因——unknown 面那 3 条
 *     "模型放行、外包纠正"必须计入通过而不是被裸分掩盖）。
 * 纪律：正文只进请求体；报告只带 id/expect/got/raw/overrode。
 * 用法（src/ 下）：node evals/gate/classifierBench.mjs [--live]
 */
import {GATE_CASES} from './classifierCases.mjs'
import {classifyAction, decideLayer2, GATE_CLASSIFIER_PROMPT} from '../../services/core/session/execGate.js'
import {seedLabel} from './classifierEvalset.mjs'

const LIVE = process.argv.includes('--live')

/** 离线档：种子政策逐例对齐 */
export function runSeedBench(cases = GATE_CASES) {
    const rows = []
    for (const c of cases) {
        const action = classifyAction({toolName: c.toolName, argsText: c.argsText})
        const got = seedLabel(action, c.argsText)
        rows.push({id: c.id, expect: c.expect, got: got.label, policy: got.policy, ok: got.label === c.expect})
    }
    return rows
}

async function runLiveBench() {
    await import(new URL('../../init.js', import.meta.url).href)
    const {SEED_GATE_RULES, decideLayer1} = await import('../../services/core/session/execGate.js')
    const cfg = llm.config.models?.relay_qwen_low
    if (!cfg) {
        console.log(JSON.stringify({fatal: '无 relay_qwen_low 配置（live 档需 dev 凭据面）'}))
        process.exit(1)
    }
    const rows = []
    for (const c of GATE_CASES) {
        const action = classifyAction({toolName: c.toolName, argsText: c.argsText})
        // 生产管线序：层 1 命中即终局（模型都不必问），continue 才进层 2——评测必须量管线，
        // 单独量模型会把"本该被层 1 短路"的动作算成模型的锅（v2 迭代②的教训）
        const l1 = decideLayer1(action, SEED_GATE_RULES)
        if (l1.final) {
            rows.push({id: c.id, expect: c.expect, got: l1.verdict === 'allow' ? 'allow' : 'block',
                raw: '(layer1:' + (l1.matchedRule || '') + ')', overrode: false, reason: l1.reason,
                ok: (l1.verdict === 'allow' ? 'allow' : 'block') === c.expect})
            continue
        }
        let raw = 'unparsable'
        try {
            const r = await fetch(`${cfg.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`},
                body: JSON.stringify({
                    model: cfg.model,
                    messages: [{role: 'system', content: GATE_CLASSIFIER_PROMPT},
                        {role: 'user', content: `${c.toolName} ${c.argsText}`}],
                    max_tokens: 24, temperature: 0, stream: false, enable_thinking: false,
                }),
                signal: AbortSignal.timeout(30000),
            })
            const j = await r.json().catch(() => ({}))
            const m = /"verdict"\s*:\s*"(allow|block|escalate)"/.exec(String(j?.choices?.[0]?.message?.content || ''))
            if (m) raw = m[1]
        } catch { /* 网络失败=unparsable，计入分歧不崩溃 */ }
        const l2 = decideLayer2(action, raw)
        rows.push({id: c.id, expect: c.expect, got: l2.verdict, raw, overrode: l2.overrode, reason: l2.reason, ok: l2.verdict === c.expect})
    }
    return rows
}

/** 直接执行才跑批（import 不触发——同 goldenCases 的家规：可测件与执行体分离） */
if (process.argv[1] && process.argv[1].endsWith('classifierBench.mjs')) {
    const rows = LIVE ? await runLiveBench() : runSeedBench()
    const okN = rows.filter((r) => r.ok).length
    const report = {
        bench: LIVE ? 'classifierBench.live（打分=decideLayer2 包装后）' : 'classifierBench.seed（政策回归）',
        n: rows.length, agree: okN, rate: Number((okN / (rows.length || 1)).toFixed(3)),
        分歧: rows.filter((r) => !r.ok),
        外包纠正数: LIVE ? rows.filter((r) => r.overrode).length : undefined,
    }
    console.log(JSON.stringify(report, null, 1))
    // 语义分工：seed 档=CI 红线（政策回归，分歧即红）；live 档=测量报告（质量不是闸门，
    // 0.667 的首跑与任何分数都不该阻塞套件——它阻塞的是"带着未知上线"这件事，而那靠的是有人读它）
    process.exit(!LIVE && report.agree !== report.n ? 1 : 0)
}

export default {runSeedBench}
