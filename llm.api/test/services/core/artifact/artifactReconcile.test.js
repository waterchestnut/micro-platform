/**
 * @fileOverview artifact intake 状态机/回滚/孤儿对账的用例（PR-H2 D17 前置）
 * @module test/services/core/artifact/artifactReconcile
 * @description
 * 钉的是 §9.5 已定死的顺序与"双向对账"，尤其几条**必须成立否则会把活物当孤儿删**的硬约束：
 * 未过宽限期≠孤儿、被 message 引用绝不删文件、回滚必须逆序、文件存在性未知不许武断当"缺"。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/artifactReconcile.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/artifactReconcile.js')).href)
const {
    INTAKE_STATE, validateTransition, planRollback, RECONCILE_CLASS, classifyArtifact, reconcileArtifacts,
} = M

const S = INTAKE_STATE
const R = RECONCILE_CLASS

describe('1 状态机：只能沿 forward 前进一步，不许跳步、不许从终态复出', () => {
    test('合法前进一步', () => {
        assert.equal(validateTransition(S.STARTED, S.PULLED), true)
        assert.equal(validateTransition(S.PULLED, S.UPLOADED), true)
        assert.equal(validateTransition(S.UPLOADED, S.REGISTERED), true)
        assert.equal(validateTransition(S.REGISTERED, S.READY), true)
    })
    test('跳步被拒（STARTED→READY 会凭空登记没上传的文件 = 悬空记录制造路径）', () => {
        assert.equal(validateTransition(S.STARTED, S.READY), false)
        assert.equal(validateTransition(S.STARTED, S.REGISTERED), false)
        assert.equal(validateTransition(S.PULLED, S.READY), false)
    })
    test('倒退被拒', () => {
        assert.equal(validateTransition(S.UPLOADED, S.PULLED), false)
    })
    test('任意非终态可进 rolled-back/failed，但终态不能再跳出', () => {
        assert.equal(validateTransition(S.PULLED, S.ROLLED_BACK), true)
        assert.equal(validateTransition(S.UPLOADED, S.FAILED), true)
        assert.equal(validateTransition(S.READY, S.FAILED), false)
        assert.equal(validateTransition(S.ROLLED_BACK, S.STARTED), false)
    })
    test('未知状态 ⇒ 非法（不是静默放行）', () => {
        assert.equal(validateTransition('weird', S.PULLED), false)
        assert.equal(validateTransition(S.STARTED, 'weird'), false)
    })
})

describe('2 planRollback：严格按 §9.5 逆序，且只补偿确实发生过的事', () => {
    test('STARTED/PULLED 失败：无外部持久副作用 ⇒ 空补偿（不假装要"回滚字节"）', () => {
        assert.deepEqual(planRollback(S.STARTED), [])
        assert.deepEqual(planRollback(S.PULLED), [])
    })
    test('UPLOADED 失败（还没登记）：只删 doc.api 文件，不注销（没登记可注销）', () => {
        assert.deepEqual(planRollback(S.UPLOADED), ['delete-doc-api-file'])
    })
    test('REGISTERED/READY 失败：必须先 unregister 再删文件（逆序，避免先删文件制造悬空窗口）', () => {
        assert.deepEqual(planRollback(S.REGISTERED), ['unregister-artifact', 'delete-doc-api-file'])
        assert.deepEqual(planRollback(S.READY), ['unregister-artifact', 'delete-doc-api-file'])
        // 顺序断言：unregister 必须排在 delete 之前
        const rb = planRollback(S.REGISTERED)
        assert.ok(rb.indexOf('unregister-artifact') < rb.indexOf('delete-doc-api-file'), '回滚顺序错了会先制造悬空')
    })
    test('终态/未知 ⇒ 不产补偿计划（交给已定终态，别乱补偿）', () => {
        assert.deepEqual(planRollback(S.ROLLED_BACK), [])
        assert.deepEqual(planRollback(S.FAILED), [])
        assert.deepEqual(planRollback('nope'), [])
    })
})

describe('3 classifyArtifact：硬约束优先——宽限期内、被引用者，绝不当孤儿', () => {
    test('未过宽限期 ⇒ IN_FLIGHT，哪怕看起来"有分配没登记"也不回收', () => {
        const c = classifyArtifact({allocated: true, registered: false, docFilePresent: false, ageMs: 10, graceMs: 60000})
        assert.equal(c.klass, R.IN_FLIGHT)
        assert.deepEqual(c.actions, [])
    })
    test('graceMs 缺省 0 时 ageMs=0 仍算在途（0>0 为假）——防止把刚建的误判孤儿', () => {
        assert.equal(classifyArtifact({allocated: true}).klass, R.IN_FLIGHT)
    })
    test('被 message 引用 + 文件缺失 ⇒ PROTECTED + mark-broken，绝不 delete-doc-api-file', () => {
        const c = classifyArtifact({registered: true, referencedByMessage: true, docFilePresent: false, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.PROTECTED)
        assert.ok(c.actions.includes('mark-broken'))
        assert.ok(!c.actions.some((a) => /delete/.test(a)), '被引用的绝不能删文件')
    })
    test('被 message 引用 + 文件在 ⇒ PROTECTED 无动作（自洽保留）', () => {
        const c = classifyArtifact({registered: true, referencedByMessage: true, docFilePresent: true, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.PROTECTED)
        assert.deepEqual(c.actions, [])
    })
    test('登记了但核验文件不在、无引用 ⇒ DANGLING_RECORD（标记/注销，不静默删引用）', () => {
        const c = classifyArtifact({registered: true, docFilePresent: false, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.DANGLING_RECORD)
        assert.ok(c.actions.includes('mark-dangling'))
    })
    test('登记了、文件存在性未知 ⇒ CONSISTENT + verify（不武断当"缺"判悬空）', () => {
        const c = classifyArtifact({registered: true, docFilePresent: undefined, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.CONSISTENT)
        assert.ok(c.actions.includes('verify-doc-api'))
    })
    test('有分配无登记无引用、文件在 ⇒ ORPHAN_FILE（回收候选，含删文件+清账）', () => {
        const c = classifyArtifact({allocated: true, registered: false, referencedByMessage: false, docFilePresent: true, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.ORPHAN_FILE)
        assert.deepEqual(c.actions, ['delete-doc-api-file', 'drop-allocation-ledger'])
    })
    test('有分配无登记、文件也不在 ⇒ ALLOC_WITHOUT_RECORD（只清账，无外部残留）', () => {
        const c = classifyArtifact({allocated: true, registered: false, docFilePresent: false, ageMs: 999, graceMs: 1})
        assert.equal(c.klass, R.ALLOC_WITHOUT_RECORD)
        assert.deepEqual(c.actions, ['drop-allocation-ledger'])
    })
})

describe('4 reconcileArtifacts：双向汇总，各归各类不误删', () => {
    test('混批分类计数正确 + 成员带 index', () => {
        const items = [
            {allocated: true, registered: false, ageMs: 5, graceMs: 1000},                       // IN_FLIGHT
            {allocated: true, registered: false, docFilePresent: true, referencedByMessage: false, ageMs: 9999}, // ORPHAN_FILE
            {allocated: true, registered: false, docFilePresent: false, ageMs: 9999},            // ALLOC_WITHOUT_RECORD
            {registered: true, docFilePresent: false, ageMs: 9999},                              // DANGLING_RECORD
            {registered: true, referencedByMessage: true, docFilePresent: false, ageMs: 9999},   // PROTECTED
        ]
        const out = reconcileArtifacts(items, 1000)
        assert.equal(out.counts[R.IN_FLIGHT], 1)
        assert.equal(out.counts[R.ORPHAN_FILE], 1)
        assert.equal(out.counts[R.ALLOC_WITHOUT_RECORD], 1)
        assert.equal(out.counts[R.DANGLING_RECORD], 1)
        assert.equal(out.counts[R.PROTECTED], 1)
        assert.equal(out.buckets[R.ORPHAN_FILE][0].index, 1)
        // 汇总里被引用的绝不能带删文件动作（引用保护的底线，逐条真查、不搞恒真断言）
        for (const m of out.buckets[R.PROTECTED]) {
            assert.ok(!m.actions.some((a) => /delete/.test(a)), `index=${m.index} 被引用条目不应有删文件动作：${JSON.stringify(m.actions)}`)
        }
    })
    test('空/非数组输入 ⇒ 不抛，全空桶', () => {
        assert.deepEqual(reconcileArtifacts(undefined).counts[R.CONSISTENT], 0)
        for (const k of Object.values(R)) assert.equal(reconcileArtifacts([]).counts[k], 0)
    })
})

describe('5 不碰网络、不执行删除：纯判据纪律', () => {
    test('artifactReconcile.js 执行代码里没有 fetch/http/await 网络/删除调用', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/artifact/artifactReconcile.js'), 'utf8')
        // 剥块注释 + 行尾注释（只剥整行会漏 `code, // 注释里有 llm.api` 这种，纪律测试反复栽过）
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        assert.ok(!/\bawait\b/.test(code), '全同步，不该有 await（判据不碰网络）')
        assert.ok(!/fetch\(|http\.|\.delete\(|unlink|rimraf/.test(code), '判据不执行删除/网络')
        assert.ok(!/\bllm\s*\./.test(code), '不读 llm 全局')
    })
})
