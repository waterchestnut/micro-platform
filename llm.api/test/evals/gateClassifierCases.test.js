/**
 * @fileOverview 门评测集 v1 的套件闸（curated 用例 + decideLayer2 + prompt 单源）
 * @module test/evals/gateClassifierCases
 * @description
 * 五组钉：①用例形状（expect 合法、id 唯一、note 必给——出处是 curated 集的户口）；
 * ②**种子全对齐**（政策回归：seedLabel 在每例上必须给 expect，改动任何立场都要么用例过、要么逼你改用例留话）；
 * ③decideLayer2 单元（unknown/malformed/unparsable 三触发与 overrode 归因）；
 * ④覆盖完整性（每个 surface 值与每个动词族至少一例——面扩张不许无样本通过）；
 * ⑤**prompt 单源计数**（分类器那句话全 src 只许出现在 execGate——两份拷贝的病，第三份出生前上闸）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'evals/gate/classifierCases.mjs'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {GATE_CASES} = await import(pathToFileURL(path.join(SRC, 'evals/gate/classifierCases.mjs')).href)
const {classifyAction, decideLayer2, GATE_SURFACES, GATE_LAYER2_VERDICTS, GATE_CLASSIFIER_PROMPT, VERB_FAMILIES} =
    await import(pathToFileURL(path.join(SRC, 'services/core/session/execGate.js')).href)
const {seedLabel} = await import(pathToFileURL(path.join(SRC, 'evals/gate/classifierEvalset.mjs')).href)
const {runSeedBench} = await import(pathToFileURL(path.join(SRC, 'evals/gate/classifierBench.mjs')).href)

describe('1 用例形状', () => {
    test('id 唯一、expect∈判定集、note 必给（出处是用例的户口）', () => {
        const seen = new Set()
        for (const c of GATE_CASES) {
            assert.ok(!seen.has(c.id), `id 重复: ${c.id}`)
            seen.add(c.id)
            assert.ok(['allow', 'block', 'escalate'].includes(c.expect), `${c.id} expect 非法`)
            assert.ok(typeof c.note === 'string' && c.note.length > 4, `${c.id} 缺政策出处`)
        }
    })
})

describe('2 种子全对齐（政策回归闸）', () => {
    test('seedLabel 在每一例上必须给出 expect——分歧=政策回归，必须显式改用例留话才能通过', () => {
        const rows = runSeedBench(GATE_CASES)
        const bad = rows.filter((r) => !r.ok)
        assert.deepEqual(bad, [], `种子政策与 curated 期望分歧：${JSON.stringify(bad)}`)
    })
})

describe('3 decideLayer2 外包硬规', () => {
    const unk = {toolName: 'x_new', surface: 'unknown', families: [], malformed: false}
    test('unknown 面：allow 被纠正为 escalate 且 overrode 归因显式', () => {
        const r = decideLayer2(unk, 'allow')
        assert.equal(r.verdict, 'escalate')
        assert.equal(r.overrode, true, '纠正次数要可计数——这是 3/3 自然样本的回归位')
    })
    test('unknown 面 block 也 escalate 但不算纠正（分类器没放行，只是不该由它终局）', () => {
        const r = decideLayer2(unk, 'block')
        assert.equal(r.verdict, 'escalate')
        assert.equal(r.overrode, false)
    })
    test('malformed ⇒ escalate（allow 视为被纠正）', () => {
        const r = decideLayer2({toolName: 'run_code', surface: 'shell', families: [], malformed: true}, 'allow')
        assert.equal(r.verdict, 'escalate')
        assert.equal(r.overrode, true)
    })
    test('unparsable ⇒ escalate：拿不到判定绝不默认放行', () => {
        const r = decideLayer2({toolName: 'get_website', surface: 'network-fetch', families: [], malformed: false}, 'unparsable')
        assert.equal(r.verdict, 'escalate')
        assert.match(r.reason, /unparsable/)
    })
    test('已知面上的三个合法判定原样通过', () => {
        const a = {toolName: 'run_code', surface: 'shell', families: [], malformed: false}
        for (const v of GATE_LAYER2_VERDICTS) {
            assert.deepEqual(decideLayer2(a, v), {verdict: v, overrode: false, reason: 'classifier'})
        }
    })
})

describe('4 覆盖完整性（面/族扩张必须有样本）', () => {
    test('层 1 归属逐例点名：只有读-only 策展面在层 1 终局，写面必须 continue 到层 2（X3 变异存活逼出的离线闸——职责分界不许只有 live 才检验）', async () => {
        const {decideLayer1, SEED_GATE_RULES} = await import('../../services/core/session/execGate.js')
        const LAYER1_FINAL_IDS = new Set(['web-search', 'web-get-website', 'mem-search', 'mem-get', 'art-read', 'meta-dt', 'meta-read-tr'])
        const bad = []
        for (const c of GATE_CASES) {
            const action = classifyAction({toolName: c.toolName, argsText: c.argsText})
            const l1 = decideLayer1(action, SEED_GATE_RULES)
            const shouldFinal = LAYER1_FINAL_IDS.has(c.id)
            if (l1.final !== shouldFinal) {
                bad.push({id: c.id, final: l1.final, 应然: shouldFinal, rule: l1.matchedRule})
            }
            if (l1.final && l1.verdict === 'deny') {
                bad.push({id: c.id, note: '种子表不该有任何 deny 命中——内容风险归层 2，deny 只留运维通道'})
            }
        }
        assert.deepEqual(bad, [], `层 1/层 2 归属分歧：${JSON.stringify(bad)}`)
    })
    test('每个 surface 值（含 unknown）至少一例', () => {
        const covered = new Set(GATE_CASES.map((c) => classifyAction({toolName: c.toolName, argsText: c.argsText}).surface))
        for (const s of [...new Set(Object.values(GATE_SURFACES)), 'unknown']) {
            assert.ok(covered.has(s), `surface ${s} 没有 curated 用例`)
        }
    })
    test('每个动词族至少被一例的真实动作命中', () => {
        const hits = new Set()
        for (const c of GATE_CASES) {
            for (const f of classifyAction({toolName: c.toolName, argsText: c.argsText}).families) {
                hits.add(f)
            }
        }
        for (const [name] of VERB_FAMILIES) {
            assert.ok(hits.has(name), `动词族 ${name} 无样本`)
        }
    })
    test('GATE_CLASSIFIER_PROMPT 非空且 GATE_LAYER2_VERDICTS 三值', () => {
        assert.ok(GATE_CLASSIFIER_PROMPT.length > 10)
        assert.deepEqual(GATE_LAYER2_VERDICTS, ['allow', 'block', 'escalate'])
    })
})

describe('5 prompt 单源计数', () => {
    test('分类器那句话全 src 只许出现在 execGate.js（拷贝第三次出生前上闸）', () => {
        const marker = '你是工具动作安全' + '分类器' // 拼接防本用例文件自己成为第 N 份拷贝（守卫审的是生产件，扫描要避开审视者）
        const hits = []
        function walk(dir) {
            for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
                const p = path.join(dir, e.name)
                if (e.isDirectory()) {
                    if (e.name !== 'node_modules') walk(p)
                    continue
                }
                if (!/\.(mjs|js)$/.test(e.name)) continue
                if (fs.readFileSync(p, 'utf8').includes(marker)) hits.push(path.relative(SRC, p))
            }
        }
        walk(SRC)
        assert.deepEqual(hits.map((h) => h.replace(/\\/g, '/')), ['services/core/session/execGate.js'], `prompt 拷贝扩散到: ${JSON.stringify(hits)}`)
    })
})
