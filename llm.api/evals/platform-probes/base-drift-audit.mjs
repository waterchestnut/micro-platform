/**
 * @fileOverview 源仓 ↔ 底座（micro-platform/llm.api）的**漂移对照**探针
 * @module evals/platform-probes/base-drift-audit
 * @description
 * 为什么要做成常备工具：v1.75 那次是**偶然看到**底座缺 `if (finalizeInterrupted)` 落库块——
 * 靠偶然发现的落后，下一次还是会靠偶然发现。
 *
 * v2 的关键改动：**文件清单改为自动遍历两边目录树**。
 * 第一版用手写清单，于是"源仓新增了一个文件而底座没有"这种情况**它看不见**
 * ——v1.78 的 `runEventLogStore.js` 就是这么漏出探测范围的：一个只比清单内文件的工具，
 * 会把"整个文件缺失"读成"没有差异"，那是最危险的假阴性。
 *
 * 两层实体：
 * 1. **导出符号 / 配置键**（跨目录都成立）；
 * 2. **代码 marker**（`persistTurn(...)` 形状、`PERSIST_VIA.X`、`scheduleCp('phase')`）——
 *    只适合 llmChat 这类"注释里带修法编号"的文件。
 *
 * **两条解读规则**（都曾被我用错，所以写在这里而不是散在聊天记录里）：
 * - 底座会**改写注释措辞**：某段中文注释不见了 ≠ 那段行为没搬，必须回落到代码实体核查；
 * - **底座独有可能是刻意的**（不同部署形态、旧键名仍被自己的代码使用），不要顺手"修平"。
 *
 * 用法：`node src/evals/platform-probes/base-drift-audit.mjs [源仓src目录] [底座目录]`
 * 默认路径为本机布局，**可参数覆盖**——写死绝对路径的探针换台机器就恒绿，那是最坏的假阳性。
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.argv[2] || 'D:/workspace/xxzx/xxzx.llm.api/src')
const BASE = path.resolve(process.argv[3] || 'D:/workspace/github/micro-platform/llm.api')

/** 不参与对照的目录（依赖、日志、评测产物、运行时数据） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'log', 'logs', 'skill', 'public', 'dist', 'tmp'])

/**
 * @description 递归收集 .js/.mjs 文件的相对路径
 * @param {String} root 根目录
 * @returns {Set<String>} 相对路径集合
 */
function walk(root) {
    const out = new Set()
    const stack = ['']
    while (stack.length) {
        const rel = stack.pop()
        let entries
        try {
            entries = fs.readdirSync(path.join(root, rel), {withFileTypes: true})
        } catch (e) {
            continue
        }
        for (const ent of entries) {
            const r = rel ? `${rel}/${ent.name}` : ent.name
            if (ent.isDirectory()) {
                if (!SKIP_DIRS.has(ent.name)) {
                    stack.push(r)
                }
                continue
            }
            if (/\.(js|mjs)$/.test(ent.name)) {
                out.add(r)
            }
        }
    }
    return out
}

/**
 * @description 取导出实体
 * @param {String} text 源码
 * @returns {Set<String>} 符号
 */
function exportsOf(text) {
    const s = new Set()
    for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
        s.add('fn:' + m[1])
    }
    for (const m of text.matchAll(/export\s+(?:const|let|class)\s+([A-Za-z0-9_]+)/g)) {
        s.add('val:' + m[1])
    }
    for (const m of text.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9_]*):\s/gm)) {
        s.add('key:' + m[1])
    }
    return s
}

/**
 * @description 取代码形状 marker
 * @param {String} text 源码
 * @returns {Set<String>} marker
 */
function markersOf(text) {
    const s = new Set()
    for (const m of text.matchAll(/persistTurn\([^)\n]{0,90}\)/g)) {
        s.add(m[0].replace(/\s+/g, ' ').trim())
    }
    for (const m of text.matchAll(/\b(PERSIST_VIA\.[A-Z_]+|scheduleCp\('[a-zA-Z]+')/g)) {
        s.add(m[0])
    }
    for (const m of text.matchAll(/\b(exitReasonForPersist|interruptedBy|writtenBy|finalizeInterrupted|loopExitReason|createRunEventMirror|readRunEventLog|gapBodyOf|needsCancelledSegment)\b/g)) {
        s.add('id:' + m[0])
    }
    return s
}

/**
 * @description 读文件（LF 归一）或 null
 * @param {String} p 路径
 * @returns {String|null} 内容
 */
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null)

const srcFiles = walk(SRC)
const baseFiles = walk(BASE)
const 报告 = []

const onlySrc = [...srcFiles].filter(f => !baseFiles.has(f))
const onlyBase = [...baseFiles].filter(f => !srcFiles.has(f))

/**
 * **已判定不搬的文件**（这是判定记录，不是发现的事实）：列在这里是为了让报表保持"有新差异就是信号"。
 * 每条都要写清依据；依据是"我没查过"的东西**不许放进这里**——那等于把盲点写进白名单。
 */
const ACCEPTED = new Set([
    // 面向 423pc dev 集群与本仓流水线的采数工具，模板不带这套运维上下文（2026-11-11 判定）
    'evals/platform-probes/env-inventory.mjs',
    'evals/platform-probes/kafka-consumer-baseline-probe.mjs',
    'evals/platform-probes/relay-failure-profile.mjs',
])

const unacceptedSrc = onlySrc.filter(f => !ACCEPTED.has(f))
if (unacceptedSrc.length) {
    报告.push({
        范围: '文件级',
        结论: `源仓有而底座没有（${unacceptedSrc.length} 个，未判定）`,
        清单: unacceptedSrc,
        备注: '其中 agentTask/agentLog/agentTaskRecover 属模板范围差异：已核实"底座没有"，**没核实"为什么没有"**；'
            + 'store 三件与 base-drift-audit 属于本轮搬运范围，若仍出现在此说明搬运未完成',
    })
}
const acceptedHit = onlySrc.filter(f => ACCEPTED.has(f))
if (acceptedHit.length) {
    报告.push({范围: '文件级', 结论: `已判定不搬（${acceptedHit.length} 个）`, 清单: acceptedHit})
}
if (onlyBase.length) {
    报告.push({范围: '文件级', 结论: `底座有而源仓没有（${onlyBase.length} 个，可能是模板差异，别自动删）`, 清单: onlyBase})
}

let compared = 0
for (const rel of [...srcFiles].filter(f => baseFiles.has(f)).sort()) {
    const a = read(path.join(SRC, rel))
    const b = read(path.join(BASE, rel))
    const ea = exportsOf(a)
    const eb = exportsOf(b)
    const ma = markersOf(a)
    const mb = markersOf(b)
    const d = {
        文件: rel,
        底座缺导出: [...ea].filter(x => !eb.has(x)),
        底座独有导出: [...eb].filter(x => !ea.has(x)),
        底座缺marker: [...ma].filter(x => !mb.has(x)),
    }
    compared++
    if (d.底座缺导出.length || d.底座独有导出.length || d.底座缺marker.length) {
        报告.push(d)
    }
}

console.log(JSON.stringify({
    源仓: SRC,
    底座: BASE,
    源仓文件数: srcFiles.size,
    底座文件数: baseFiles.size,
    逐个比对了: compared,
    有差异的条目: 报告.length,
    解读规则: ['注释措辞差不等于行为差：必须回落到代码实体核查', '底座独有可能是刻意的，别顺手修平'],
    报告,
}, null, 1))
process.exit(0)
