/**
 * @fileOverview cron firing 记录形状判据的用例（四态语义穷举）
 * @module test/services/core/session/cronRunRecord
 * @description
 * 档案面读数的地基语义："真实执行/叠跑跳过/异常/无结构"必须四态可区分——
 * 尤其"无结构轮不许冒充成功"（读数缺失与读数正常是两个档案态，混了就是假绿曲线）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/cronRunRecord.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {buildRunRecord, isExecutedFiring, ABNORMAL_MAX} =
    await import(pathToFileURL(path.join(SRC, 'services/core/session/cronRunRecord.js')).href)

describe('1 buildRunRecord 四态', () => {
    const at = new Date('2026-11-16T04:45:00Z')
    test('正常轮：ret 原样进 result', () => {
        const r = buildRunRecord({name: 'artifactReconcile', startedAt: at, ms: 1200, ret: {模式: '干跑', 行: 8}})
        assert.deepEqual(r, {task: 'artifactReconcile', at, ms: 1200, result: {模式: '干跑', 行: 8}})
    })
    test('兜底抛错轮：error 编译成 abnormal 且截断', () => {
        const long = 'x'.repeat(ABNORMAL_MAX + 500)
        const r = buildRunRecord({name: 'retention', startedAt: at, error: new Error(long)})
        assert.equal(r.result.abnormal.length, ABNORMAL_MAX)
    })
    test('无结构轮：undefined ⇒ noStructuredResult（不冒充成功）', () => {
        assert.deepEqual(buildRunRecord({name: 'x', startedAt: at}).result, {noStructuredResult: true})
    })
    test('null ret ⇒ abnormal 标注；数字 ret（agentTaskRecover 形态）⇒ value 字符串', () => {
        assert.ok(buildRunRecord({name: 'x', startedAt: at, ret: null}).result.abnormal)
        assert.deepEqual(buildRunRecord({name: 'agentTaskRecover', startedAt: at, ret: 3}).result, {value: '3'})
    })
    test('缺 name/startedAt 兜底不炸', () => {
        const r = buildRunRecord({})
        assert.equal(r.task, '(未名)')
        assert.ok(r.at instanceof Date)
    })
})

describe('2 isExecutedFiring 单源判据', () => {
    test('skipped/abnormal/noStructuredResult 都不算真实执行；结构化摘要算', () => {
        assert.equal(isExecutedFiring({result: {skipped: true}}), false)
        assert.equal(isExecutedFiring({result: {abnormal: 'boom'}}), false)
        assert.equal(isExecutedFiring({result: {noStructuredResult: true}}), false)
        assert.equal(isExecutedFiring({result: {模式: '计划', ns: '20/20'}}), true)
        assert.equal(isExecutedFiring({result: {skipped: false, 动作: 0}}), true)
    })
    test('行残缺（result 缺失/非对象）⇒ false，读数仪不因脏行崩', () => {
        assert.equal(isExecutedFiring({}), false)
        assert.equal(isExecutedFiring({result: 'x'}), false)
        assert.equal(isExecutedFiring(null), false)
    })
})
