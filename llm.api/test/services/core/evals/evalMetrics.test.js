/**
 * @fileOverview 评测判据三件套的用例（PR-J 首块，D32/§15）
 * @module test/services/core/evals/evalMetrics
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/evals/passK.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const P = await import(pathToFileURL(path.join(SRC, 'services/core/evals/passK.js')).href)
const T = await import(pathToFileURL(path.join(SRC, 'services/core/evals/trajectory.js')).href)
const G = await import(pathToFileURL(path.join(SRC, 'services/core/evals/goldLeak.js')).href)

describe('1 passK：主口径是"全对"，数据不足不站队', () => {
    test('4 全对 ⇒ pass；4 中 1 错 ⇒ fail 但 pass@k 仍真（gap 的来源）', () => {
        const all = P.caseMetrics([true, true, true, true])
        assert.equal(all.verdict, 'pass')
        assert.equal(all.passPowK, true)
        const one = P.caseMetrics([true, true, false, true])
        assert.equal(one.verdict, 'fail')
        assert.equal(one.passAtK, true)
    })
    test('跑不满 k：2/2 也**不许**报 pass^4=true；缺失 run 同样判不足（不当错、更不当对）', () => {
        const short = P.caseMetrics([true, true])
        assert.equal(short.verdict, 'insufficient-runs')
        assert.equal(short.passPowK, null)
        const holes = P.caseMetrics([true, true, null, undefined])
        assert.equal(holes.verdict, 'insufficient-runs')
        assert.equal(holes.nInsufficient, 2)
    })
    test('suiteReport：通过率只在跑满的用例上算；gap=同批 pass@k 减 pass^k', () => {
        const rep = P.suiteReport([
            {caseId: 'a', runs: [true, true, true, true]},            // ^k pass
            {caseId: 'b', runs: [true, false, false, false]},          // @k pass, ^k fail
            {caseId: 'c', runs: [false, false, false, false]},          // 双 fail
            {caseId: 'd', runs: [true]},                                 // insufficient
        ])
        assert.equal(rep.totals.cases, 4)
        assert.equal(rep.totals.insufficient, 1)
        assert.equal(rep.totals.sufficient, 3)
        assert.ok(Math.abs(rep.totals.passPowKRate - 1 / 3) < 1e-9)
        assert.ok(Math.abs(rep.gap.reliabilityGap - (2 / 3 - 1 / 3)) < 1e-9, 'b 贡献了 gap')
        assert.equal(rep.totals.k, P.DEFAULT_K)
    })
    test('reportUsable：配比不足/有不足用例/空套件，都是"不可比"而不是"差"', () => {
        const okRep = P.suiteReport(Array.from({length: 5}, (_, i) => ({caseId: `x${i}`, adversarial: i < 2, runs: [true, true, true, true]})))
        assert.equal(P.reportUsable(okRep).usable, true, '40% adversarial 达标（60/40 的下限）')
        const thin = P.suiteReport([{caseId: 'x', adversarial: true, runs: [true]}, {caseId: 'y', adversarial: true, runs: [true, true, true, true]}])
        const r1 = P.reportUsable(thin)
        assert.equal(r1.usable, false)
        assert.ok(r1.reasons.some((x) => /未跑满/.test(x)))
        const nonAdv = P.suiteReport(Array.from({length: 4}, (_, i) => ({caseId: `t${i}`, runs: [true, true, true, true]})))
        const r2 = P.reportUsable(nonAdv)
        assert.equal(r2.usable, false)
        assert.ok(r2.reasons.some((x) => /adversarial 配比/.test(x)), '§26.2 的 60/40 门槛没达就是不可作数')
        assert.equal(P.reportUsable(P.suiteReport([])).usable, false)
    })
    test('脏输入不炸（runs 非数组/用例缺字段）', () => {
        assert.equal(P.caseMetrics('x').verdict, 'insufficient-runs')
        const rep = P.suiteReport([null, {}, {caseId: 'z', runs: [true, true, true, true]}])
        assert.equal(rep.totals.sufficient, 1)
    })
})

describe('2 trajectory：吃 segments 真形状，轨迹残缺必须带 caveat', () => {
    const seg = (kind, chars = 50, over = {}) => ({kind, metrics: {chars}, ...over})
    test('步效率：产出正文的步占比；chars 是截断前真值所以可信', () => {
        const r = T.stepEfficiency([seg('tool-round'), seg('tool-round', 0), seg('self-check'), seg('answer')])
        assert.equal(r.steps, 4)
        assert.equal(r.productive, 2)
        assert.ok(Math.abs(r.ratio - 0.5) < 1e-9)
        assert.ok(!r.caveat)
    })
    test('dropped>0 ⇒ caveat 如实声明（在幸存段上算的数不许冒充全轨迹）', () => {
        const r = T.stepEfficiency([seg('answer')], {dropped: {count: 3, chars: 900}})
        assert.match(r.caveat, /丢弃过 3 段/)
    })
    test('planAdherence：无档案 ⇒ null 不猜；有未结项且没 self-check ⇒ 不依从', () => {
        const answerOnly = [seg('answer')]
        assert.equal(T.planAdherence(answerOnly, null).adherent, null)
        const open = {items: [{status: 'done'}, {status: 'pending'}]}
        const noCheck = T.planAdherence(answerOnly, open)
        assert.equal(noCheck.adherent, false)
        assert.match(noCheck.reason, /未结项/)
        const checked = T.planAdherence([seg('self-check', 40), seg('answer')], open)
        assert.equal(checked.adherent, true, '被追问后仍然确认完成（self-check 段在场）算依从')
        assert.equal(T.planAdherence(answerOnly, {items: [{status: 'done'}]}).adherent, true)
    })
    test('taskCompletion：forcedFinal 单独标注（被迫收尾≠正常做完，但都算有答案）', () => {
        const ok = T.taskCompletion([seg('answer', 200)])
        assert.deepEqual([ok.complete, ok.answerChars], [true, 200])
        assert.ok(!ok.forcedFinal)
        const ff = T.taskCompletion([seg('finalize', 180), seg('answer', 180)], {})
        assert.equal(ff.complete, true)
        assert.equal(ff.forcedFinal, true)
        assert.match(ff.caveat, /人工抽检/)
        const nothing = T.taskCompletion([seg('tool-round', 30)], {answerChars: 0})
        assert.equal(nothing.complete, false)
    })
    test('脏输入不炸', () => {
        for (const bad of [undefined, null, 'x', [null, {}]]) {
            assert.ok(T.stepEfficiency(bad))
            assert.ok(T.taskCompletion(bad))
            assert.ok(T.planAdherence(bad, undefined).adherent === null)
        }
    })
})

describe('3 goldLeak：归一化堵廉价绕过；报告自身不许变成新泄漏面', () => {
    // 刻意 >minExactLen(24)：第一版探针串只有 23 字，被自家短路闸拦下——短路闸有力气的直接证据
    const GOLD = '馆藏预算的审批人是分管副馆长，材料须附近三年执行率对照表，每季度首月第一个工作日之前提交。'
    test('大小写/空白/插零宽都躲不过（廉价绕过先堵上）', () => {
        const surfaces = [
            {surface: 'rag', ref: 'mat-1', text: `……${GOLD.toUpperCase()}……`},
            {surface: 'artifact', ref: 'art-2', text: GOLD.replace('提交。', '提\u200B交。')},
        ]
        const r = G.scanGoldLeak({golds: [{caseId: 'c1', answer: GOLD}], surfaces})
        assert.equal(r.clean, false)
        assert.equal(r.counts.hits, 2)
        assert.ok(r.hits.every((h) => h.goldHash && h.at >= 0 && !JSON.stringify(h).includes(GOLD)), 'hit 只留指纹不留原文')
    })
    test('不存在 ⇒ clean；短 gold ⇒ skipped-short 计入报告（没扫过要看得见）', () => {
        const r1 = G.scanGoldLeak({golds: [{caseId: 'c', answer: GOLD}], surfaces: [{surface: 's', ref: 'r', text: '完全无关的一段材料文字，不含答案。'}]})
        assert.equal(r1.clean, true)
        const r2 = G.scanGoldLeak({golds: [{caseId: 's', answer: '是的'}], surfaces: [{surface: 's', ref: 'r', text: '是的，确实如此，是的。'}]})
        assert.equal(r2.hits.length, 0)
        assert.equal(r2.counts.skippedShort, 1)
        assert.match(r2.skippedShort[0].reason, /误报/)
    })
    test('同面多次出现 ⇒ 全部列出（漏报一处=假装干净）', () => {
        const r = G.scanGoldLeak({golds: [{caseId: 'm', answer: GOLD}], surfaces: [{surface: 'doc', ref: 'd1', text: GOLD + '中间隔了一些别的字' + GOLD}]})
        assert.equal(r.counts.hits, 2)
        assert.ok(r.hits[1].at > r.hits[0].at)
    })
    test('reportIsSelfClean：谁往报告里塞原文，这条回归门先红', () => {
        const r = G.scanGoldLeak({golds: [{caseId: 'c', answer: GOLD}], surfaces: [{surface: 's', ref: 'r', text: '前缀' + GOLD + '后缀'}]})
        assert.equal(G.reportIsSelfClean(r, [{answer: GOLD}]), true)
        assert.equal(G.reportIsSelfClean({hits: [{...r.hits[0], context: GOLD}]}, [{answer: GOLD}]), false)
    })
    test('归一化性质 + 不可见表与 skillScan 同一份（防"两份表漏过另一份"）', () => {
        assert.equal(G.normalizeForScan('A\u200B \u202E  B'), 'a b')
        const scanSrc = fs.readFileSync(path.join(SRC, 'services/core/skill/skillScan.js'), 'utf8')
        assert.match(scanSrc, /export const INVISIBLE_CODEPOINTS/, '共享表必须保持单一来源')
    })
})

describe('4 纯件纪律', () => {
    test('三件只准依赖：segments / skillScan / node:crypto', () => {
        const allow = {'passK.js': [], 'trajectory.js': ['../segments.js'], 'goldLeak.js': ['node:crypto', '../skill/skillScan.js']}
        for (const [f, want] of Object.entries(allow)) {
            const code = fs.readFileSync(path.join(SRC, 'services/core/evals', f), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
            const got = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort()
            assert.deepEqual(got, [...want].sort(), `${f} 依赖面漂移`)
        }
    })
})
