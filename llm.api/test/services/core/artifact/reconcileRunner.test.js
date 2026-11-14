/**
 * @fileOverview 对账执行核的用例（PR-H2 最后一块离线件）
 * @module test/services/core/artifact/reconcileRunner
 * @description
 * 最值钱的三条：①**默认干跑一个外部动作都不做**（扳机必须显式踩）；②**带 `?` 的判断类动作即便 enforce 也永不自动执行**
 * （注销悬空记录属产品决定）；③核验失败的兜底方向是"更保守"而非"更激进"——引用核验不了按已引用保护、
 * 存在性核验不了按未知（交 classifyArtifact 的"未知不武断"判据），绝不当"没有"去回收。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/reconcileRunner.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/reconcileRunner.js')).href)
const {AUTO_ACTIONS, rowToClassifyInput, runReconcilePass} = M
const {RECONCILE_CLASS} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/artifactReconcile.js')).href)

const NOW = 1000 * 60 * 60 // 固定时钟
const oldInsert = new Date(NOW - 10 * 60 * 1000).toISOString() // 超 10min 宽限
const mkDeps = (over = {}) => {
    const log = {mark: [], del: [], drop: [], notify: [], verify: [], ref: []}
    return {log, deps: {
        verifyDocFile: async (fc) => { log.verify.push(fc); return true },
        isReferenced: async (row) => { log.ref.push(row.artifactCode); return false },
        markIntegrity: async (c, m) => { log.mark.push([c, m]) },
        deleteDocFile: async (c, fc) => { log.del.push([c, fc]) },
        dropAllocation: async (c) => { log.drop.push(c) },
        notify: async (p) => { log.notify.push(p) },
        ...over,
    }}
}

describe('1 rowToClassifyInput：账行 → 判据输入', () => {
    test('registered/allocated/age 折算正确', () => {
        const i = rowToClassifyInput({state: 'ready', fileCode: 'fc', insertTime: oldInsert}, {now: NOW, graceMs: 1000}, {docFilePresent: true, referencedByMessage: false})
        assert.equal(i.registered, true)
        assert.equal(i.allocated, true)
        assert.ok(i.ageMs > 1000, 'insertTime 老于 now ⇒ age 正数')
        assert.equal(i.docFilePresent, true)
    })
    test('缺 fileCode ⇒ allocated=false；缺 insertTime ⇒ age=0（在途）', () => {
        const i = rowToClassifyInput({state: 'started'}, {now: NOW}, {})
        assert.equal(i.allocated, false)
        assert.equal(i.ageMs, 0)
    })
})

describe('2 默认干跑：分类照跑、动作一个不做', () => {
    test('孤儿行 dry-run ⇒ delete 进 deferred(dry-run) 不入 executed，log 全空', async () => {
        const {log, deps} = mkDeps()
        const rows = [{artifactCode: 'a1', state: 'uploaded', fileCode: 'fc-1', insertTime: oldInsert}]
        const r = await runReconcilePass({rows, opts: {now: NOW, graceMs: 1000}, deps})
        assert.equal(r.dryRun, true)
        assert.equal(r.executedAll, 0)
        const p = r.plans[0]
        assert.equal(p.klass, RECONCILE_CLASS.ORPHAN_FILE)
        assert.ok(p.deferred.some((x) => /dry-run/.test(x)), '干跑要如实标出"若开闸会做"')
        assert.deepEqual(log.del, [], '干跑绝不能真删')
        assert.deepEqual(log.mark, [])
    })
    test('核验仍会做（分类需要事实），只是不执行动作', async () => {
        const {log, deps} = mkDeps()
        await runReconcilePass({rows: [{artifactCode: 'a', state: 'ready', fileCode: 'fc', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000}, deps})
        assert.deepEqual(log.verify, ['fc'], '干跑≠不核验：不动手的是"写"，读是为了分类')
    })
})

describe('3 enforce：白名单动作执行，判断类永不自动', () => {
    test('孤儿开闸 ⇒ 真调 deleteDocFile(fileCode) + dropAllocation', async () => {
        const {log, deps} = mkDeps()
        const r = await runReconcilePass({rows: [{artifactCode: 'a1', state: 'uploaded', fileCode: 'fc-1', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        assert.equal(r.dryRun, false)
        assert.deepEqual(log.del, [['a1', 'fc-1']])
        assert.ok(log.drop.includes('a1'))
        assert.equal(r.plans[0].executed.length, 2)
    })
    test('悬空记录 ⇒ unregister-artifact? 永不自动执行（进 deferred），但 mark-dangling 会', async () => {
        const {log, deps} = mkDeps()
        const r = await runReconcilePass({
            rows: [{artifactCode: 'a2', state: 'registered', fileCode: 'fc-2', insertTime: oldInsert}],
            opts: {now: NOW, graceMs: 1000, enforce: true},
            deps: {...deps, verifyDocFile: async () => false},
        })
        const p = r.plans[0]
        assert.equal(p.klass, RECONCILE_CLASS.DANGLING_RECORD)
        assert.ok(p.deferred.includes('unregister-artifact?'), '带 ? 的判断类必须交人工')
        assert.ok(!AUTO_ACTIONS.includes('unregister-artifact?'), '白名单里就不该有带 ? 的动作')
        assert.ok(p.executed.includes('mark-dangling'), '标记类是可逆的，能自动')
        assert.deepEqual(log.mark, [['a2', 'dangling']])
        assert.deepEqual(log.del, [], '悬空记录不该自动删 doc.api（文件已不在，删也是徒劳且掩盖问题）')
    })
    test('PROTECTED+缺文件 ⇒ mark-broken 自动、notify 自动，且绝不 delete', async () => {
        const {log, deps} = mkDeps({isReferenced: async () => true, verifyDocFile: async () => false})
        const r = await runReconcilePass({rows: [{artifactCode: 'a3', state: 'ready', fileCode: 'fc-3', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        assert.equal(r.plans[0].klass, RECONCILE_CLASS.PROTECTED)
        assert.ok(r.plans[0].executed.includes('mark-broken'))
        assert.equal(log.mark[0][1], 'broken')
        assert.deepEqual(log.del, [], '被引用的产物永不因缺文件被删')
        assert.equal(log.notify.length, 1, '缺文件的被引用产物要通报')
    })
})

describe('4 核验失败 = 更保守，不是更激进', () => {
    test('存在性核验抛 ⇒ docFilePresent 未知 ⇒ 按"待核验"而非"缺文件"判，不回收', async () => {
        const {log, deps} = mkDeps({verifyDocFile: async () => { throw new Error('doc.api 500') }})
        const r = await runReconcilePass({rows: [{artifactCode: 'a4', state: 'registered', fileCode: 'fc-4', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        const p = r.plans[0]
        assert.equal(p.klass, RECONCILE_CLASS.CONSISTENT, '核验失败不该被当成"文件没了"')
        assert.ok(p.deferred.includes('verify-doc-api'), '交下轮再验，不自我循环')
        assert.deepEqual(log.del, [])
        assert.ok(p.errors.some((e) => /verifyDocFile/.test(e)), '核验错误要如实记录在行上')
    })
    test('存在性核验返回 null/非布尔（不抛）⇒ 同样按未知，绝不落到"缺文件"分支', async () => {
        // 这条专补 G3 覆盖缺口：verifyDocFile 不抛但给出非 true/false 时，必须仍是"未知"而非"没了"
        for (const ret of [null, undefined, 'yes', 0]) {
            const {log, deps} = mkDeps({verifyDocFile: async () => ret})
            const r = await runReconcilePass({rows: [{artifactCode: 'an', state: 'registered', fileCode: 'fc', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
            assert.equal(r.plans[0].klass, RECONCILE_CLASS.CONSISTENT, `返回 ${JSON.stringify(ret)} 不该被判成缺文件`)
            assert.ok(r.plans[0].deferred.includes('verify-doc-api'))
            assert.deepEqual(log.del, [], '未知不武断删')
        }
    })
    test('引用核验抛 ⇒ 按 referenced=true 保守保护（误延回收可逆，误删不可逆）', async () => {
        const {deps} = mkDeps({isReferenced: async () => { throw new Error('mongo timeout') }})
        const r = await runReconcilePass({rows: [{artifactCode: 'a5', state: 'ready', fileCode: 'fc-5', insertTime: oldInsert}], opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        const p = r.plans[0]
        assert.equal(p.klass, RECONCILE_CLASS.PROTECTED, '引用查不了就当可能被引用，保护优先')
        assert.ok(p.errors.some((e) => /referenced=true/.test(e)))
    })
})

describe('5 批次卫生：跳过已终结 + 行级故障隔离', () => {
    test('rolled-back / status=-1 的行不对账', async () => {
        const {deps} = mkDeps()
        const rows = [
            {artifactCode: 'x', state: 'rolled-back', fileCode: 'fc', insertTime: oldInsert},
            {artifactCode: 'y', state: 'ready', fileCode: 'fc', insertTime: oldInsert, status: -1},
            {artifactCode: 'z', state: 'uploaded', fileCode: 'fc-z', insertTime: oldInsert},
        ]
        const r = await runReconcilePass({rows, opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        assert.equal(r.skippedSettled, 2)
        assert.equal(r.plans.length, 1)
        assert.equal(r.plans[0].artifactCode, 'z')
    })
    test('一行动作抛错不拖垮整批（后续行继续）', async () => {
        const {log, deps} = mkDeps({deleteDocFile: async (c) => { if (c === 'b1') throw new Error('403') }})
        const rows = [
            {artifactCode: 'b1', state: 'uploaded', fileCode: 'f1', insertTime: oldInsert},
            {artifactCode: 'b2', state: 'uploaded', fileCode: 'f2', insertTime: oldInsert},
        ]
        const r = await runReconcilePass({rows, opts: {now: NOW, graceMs: 1000, enforce: true}, deps})
        assert.equal(r.plans.length, 2)
        assert.ok(r.plans[0].errors.some((e) => /delete-doc-api-file.*403/.test(e)), 'b1 的失败记在 b1 行上')
        assert.deepEqual(r.plans[1].executed, ['delete-doc-api-file', 'drop-allocation-ledger'], 'b2 不受 b1 影响')
    })
    test('空/非数组 rows ⇒ 安全返回全零，不抛', async () => {
        const {deps} = mkDeps()
        for (const bad of [undefined, null, 'nope', []]) {
            const r = await runReconcilePass({rows: bad, opts: {now: NOW}, deps})
            assert.equal(r.plans.length, 0)
            assert.equal(r.executedAll, 0)
        }
    })
    test('counts 覆盖 RECONCILE_CLASS 全集（分类不许漏桶）', async () => {
        const {deps} = mkDeps()
        const r = await runReconcilePass({rows: [], opts: {now: NOW}, deps})
        for (const k of Object.values(RECONCILE_CLASS)) {
            assert.ok(k in r.counts, `counts 缺桶 ${k}`)
        }
    })
})

describe('6 纯件纪律', () => {
    test('只依赖 artifactReconcile 判据，无网络/库/全局', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/artifact/reconcileRunner.js'), 'utf8')
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
        assert.deepEqual(imports, ['./artifactReconcile.js'], `执行核只准依赖判据：${JSON.stringify(imports)}`)
        assert.ok(!/fetch\(|mongoose|dac|llm\.config|await import/.test(code), 'dac/核验/动作全走注入，本模块不碰网络库')
        assert.ok(!/\bllm\s*\./.test(code), '不读 llm 全局')
    })
})
