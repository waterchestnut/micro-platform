/**
 * @fileOverview golden 用例集的离线自测（判分器不是空转仪器的机器证明）
 * @module test/evals/goldenCases
 * @description
 * 每条用例的合成样本对（probe.pass / probe.fail）在这里逐条判分：
 * pass 样本必须真、fail 样本必须假。**没有这层自测，"跑批全绿"证明的可能只是判分器什么都不测**
 * （§25 的"Space 仍在导入里数错对象"教训倒过来用：仪器验证要在拿它测现实之前）。
 * 另有套件级纪律：id 唯一、adversarial 配比 ≥40%、闭卷用例的 gold 不得出现在题面、
 * 判分引用的危害形状必须存在、`error ⇒ null` 的流水线不足口径。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'evals/golden/cases.mjs'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {CASES, SHAPES, runChecks} = await import(pathToFileURL(path.join(SRC, 'evals/golden/cases.mjs')).href)

describe('1 逐例判分自测（仪器先于现实）', () => {
    for (const c of CASES) {
        test(`${c.caseId}：pass 样本判真、fail 样本判假`, () => {
            const p = runChecks(c.check, {answer: c.probe.pass, progress: 'finish'})
            assert.equal(p, true, `probePass 没过判据，判据或样本必有一处失真：${JSON.stringify(c.check)}`)
            const f = runChecks(c.check, {answer: c.probe.fail, progress: 'finish'})
            assert.equal(f, false, 'probeFail 竟被放行——这条判据对失败形态免疫，等于没测')
        })
    }
})

describe('2 判分器口径', () => {
    test('error ⇒ null（流水线坏不当被测的错，passK 家规 2 的入口）', () => {
        assert.equal(runChecks({contains: ['x'], finish: true}, {error: 'HTTP 500', answer: '', progress: ''}), null)
    })
    test('progress 非 finish 且要求 finish ⇒ false；不要求 finish 时不查 progress', () => {
        assert.equal(runChecks({finish: true}, {answer: 'x', progress: 'error'}), false)
        assert.equal(runChecks({contains: ['x']}, {answer: 'x', progress: 'error'}), true)
    })
    test('未知危害形状名 ⇒ 直接炸（拼错的判据比没判据危险）', () => {
        assert.throws(() => runChecks({notShape: ['secretLeek']}, {answer: 'x'}), /未知危害形状/)
    })
    test('空 check 恒真（默认无约束）；字符串 regex 兼容（JSON 化用例集可携带）', () => {
        assert.equal(runChecks({}, {answer: '', progress: ''}), true)
        assert.equal(runChecks({regex: ['^ab']}, {answer: 'abc'}), true)
    })
})

describe('3 套件级纪律', () => {
    test('id 唯一且前缀语义（adv- 与 adversarial 标记一致）', () => {
        const seen = new Set()
        for (const c of CASES) {
            assert.ok(!seen.has(c.caseId), `重复 caseId: ${c.caseId}`)
            seen.add(c.caseId)
            assert.equal(c.caseId.startsWith('adv-'), c.adversarial === true, `前缀与标记不一致: ${c.caseId}`)
        }
    })
    test('adversarial 配比 ≥ 0.4（§26.2 的 60/40，reportUsable 会在运行时二次把关）', () => {
        const share = CASES.filter((c) => c.adversarial).length / CASES.length
        assert.ok(share >= 0.4, `当前配比 ${(share * 100).toFixed(0)}% 不足 40%`)
    })
    test('闭卷用例的 gold 不得出现在题面（gold 在题里 = 判分测的是复读不是知识）', () => {
        for (const c of CASES) {
            if (c.openBook) continue
            for (const g of c.golds) {
                for (const s of c.steps) {
                    assert.ok(!s.query.includes(g), `${c.caseId}（闭卷）的题面含 gold "${g}"——要么改题要么标 openBook`)
                }
            }
        }
    })
    test('每条 notShape 引用的形状都在库里；库里每条都至少被一例引用（死形状同样要红）', () => {
        const used = new Set()
        for (const c of CASES) {
            for (const k of c.check.notShape || []) {
                assert.ok(SHAPES[k], `${c.caseId} 引用了不存在的危害形状 ${k}`)
                used.add(k)
            }
        }
        const dead = Object.keys(SHAPES).filter((k) => !used.has(k))
        assert.deepEqual(dead, [], `有危害形状定义了却没用例引用（没被证明能拦东西的形状不该留着占位）：${dead.join(',')}`)
    })
    test('每条用例都有 probe（无样本的判据不许进集）', () => {
        for (const c of CASES) {
            assert.ok(c.probe && typeof c.probe.pass === 'string' && typeof c.probe.fail === 'string', `${c.caseId} 缺 probe`)
        }
    })
})
