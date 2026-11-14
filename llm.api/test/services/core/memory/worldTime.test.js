/**
 * @fileOverview world-time 判据与 schema 的用例（D31）
 * @module test/services/core/memory/worldTime
 * @description
 * 钉四条：①边界口径 **validFrom 含、invalidAt 不含**（同一时刻新旧事实必须一真一假）；
 * ②`asOfFilter` 与 `isValidAt` **逐条件对映**（用微型 mongo 语义求值器离线验一致性——
 * 线上真库行为在读数窗口复核，但"两边说的不是同一件事"这类错必须在 CI 红）；
 * ③失效动作守卫（倒序/未来/缺时刻都拒）；④词表跨层对账（schema ↔ worldTime，同 artifactSchema 先例）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/memory/worldTime.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const WT = await import(pathToFileURL(path.join(SRC, 'services/core/memory/worldTime.js')).href)
const {WORLD_INVALID_REASONS, isValidAt, asOfFilter, assertValidTransition} = WT

// schema 顶层读 llm.tools ⇒ 动态 import 前垫最小全局（只为取到 schema 对象）
globalThis.llm = {...(globalThis.llm || {}), tools: {...(globalThis.llm?.tools || {}), getUUID: () => 'test-uuid'}}
const schemaMod = await import(pathToFileURL(path.join(SRC, 'daos/core/schema/memoryAtomSchema.js')).href)
const atomSchema = schemaMod.default
const paths = atomSchema.paths || {}

const T = (s) => new Date(s).getTime()
const D = (s) => new Date(s)

describe('1 isValidAt：边界口径是裁定，不是巧合', () => {
    test('无界=永久有效；缺字段与 null 同义', () => {
        assert.equal(isValidAt({}, D('2026-03-01')), true)
        assert.equal(isValidAt({validFrom: null, invalidAt: null}, D('2026-03-01')), true)
    })
    test('validFrom **含**：到点即生效', () => {
        const from = D('2026-03-01T00:00:00Z')
        assert.equal(isValidAt({validFrom: from}, from), true)
        assert.equal(isValidAt({validFrom: from}, new Date(from.getTime() - 1)), false)
    })
    test('invalidAt **不含**：到点已失效（同刻一真一假，不许共存/真空）', () => {
        const to = D('2026-03-01T00:00:00Z')
        assert.equal(isValidAt({invalidAt: to}, new Date(to.getTime() - 1)), true)
        assert.equal(isValidAt({invalidAt: to}, to), false)
    })
    test('输入形态宽容（Date/毫秒/ISO 串），垃圾时刻直接 false 不猜', () => {
        assert.equal(isValidAt({validFrom: '2026-01-01'}, 1767225600000), true)
        assert.equal(isValidAt({validFrom: 1767225600000}, '2026-01-01'), true)
        assert.equal(isValidAt({validFrom: 'not-a-date'}, D()), false)
        assert.equal(isValidAt({}, 'not-a-date'), false)
    })
    test('null atom / undefined 不炸', () => {
        assert.equal(isValidAt(null, D()), false)
        assert.equal(isValidAt(undefined, D('2026-01-01')), false)
    })
})

/** 微型求值器：只实现 asOfFilter 会产出的那三种形态（字段:null / $lte / $gt），刻意不复用被测谓词 */
function matchFilter(filter, doc, at) {
    const ms = T(at)
    const one = (cond) => Object.entries(cond).every(([k, v]) => {
        const dv = doc[k]
        if (v === null) return dv === undefined || dv === null
        if (v && v.$lte !== undefined) return dv !== undefined && dv !== null && T(dv) <= T(v.$lte)
        if (v && v.$gt !== undefined) return dv !== undefined && dv !== null && T(dv) > T(v.$gt)
        throw new Error(`求值器没实现的条件: ${k}`)
    })
    return filter.$and.every(clause => clause.$or ? clause.$or.some(one) : one(clause))
}

describe('2 asOfFilter ↔ isValidAt 一致性（离线可证的都对，不留给线上初见）', () => {
    test('9 形态 × 5 时刻全组合：过滤器命中集 == 谓词真值集', () => {
        const shapes = [
            {},
            {validFrom: D('2026-02-01')},
            {validFrom: D('2026-02-01T00:00:00.000Z'), invalidAt: D('2026-02-01T00:00:00.000Z')},
            {invalidAt: D('2026-04-01')},
            {validFrom: D('2026-01-01'), invalidAt: D('2026-03-01')},
            {validFrom: null, invalidAt: null},
            {validFrom: D('2026-05-01')},
            {invalidAt: D('2026-01-01')},
            {validFrom: D('2026-01-01'), invalidAt: D('2026-06-01')},
        ]
        const times = ['2025-12-31', '2026-02-01', '2026-03-01', '2026-04-15', '2026-06-01'].map(D)
        for (const shape of shapes) {
            for (const at of times) {
                assert.equal(
                    matchFilter(asOfFilter(at), shape, at),
                    isValidAt(shape, at),
                    `形态 ${JSON.stringify(Object.keys(shape))} @ ${at.toISOString()} 两口径不一致`)
            }
        }
    })
    test('extra 条件并入 $and（命名空间过滤的挂载点）', () => {
        const f = asOfFilter(D('2026-03-01'), {userCode: 'u1', channel: 'c1'})
        assert.ok(f.$and.some(x => x.userCode === 'u1'))
    })
})

describe('3 assertValidTransition：失效动作的最小一致性守卫', () => {
    test('正常盖戳：字符串/Date 归一为 Date', () => {
        const r = assertValidTransition({now: D('2026-06-01'), invalidAt: '2026-05-01'})
        assert.ok(r.invalidAt instanceof Date)
        assert.equal(T(r.invalidAt), T(D('2026-05-01')))
    })
    test('缺时刻 / 倒序 / 未来时点都拒（未来失效是预测不是事实）', () => {
        assert.throws(() => assertValidTransition({}), /invalidAt 缺失/)
        assert.throws(() => assertValidTransition({invalidAt: D('2026-01-01'), validFrom: D('2026-03-01'), now: D('2026-06-01')}), /倒着失效/)
        assert.throws(() => assertValidTransition({invalidAt: D('2026-07-01'), now: D('2026-06-01')}), /未来/)
    })
})

describe('4 schema 承载 + 跨层词表对账', () => {
    const M = mongoose.models.T_worldtime_atom || mongoose.model('T_worldtime_atom', atomSchema)
    test('三列都在且类型/默认正确（strict 模式丢没声明的列——加列必须进 schema）', () => {
        assert.equal(paths.validFrom.instance, 'Date')
        assert.equal(paths.invalidAt.instance, 'Date')
        assert.equal(paths.invalidReason.enumValues.slice().sort().join(','), [...WORLD_INVALID_REASONS, ''].sort().join(','))
    })
    test('WORLD_INVALID_REASONS 跨层集合相等（schema ↔ worldTime）', () => {
        assert.deepEqual([...schemaMod.WORLD_INVALID_REASONS].sort(), [...WORLD_INVALID_REASONS].sort())
    })
    test('默认 null=不设界；invalidReason 无 invalidAt ⇒ 校验拒（因果倒置）；成对 ⇒ 过', () => {
        const base = {atomCode: 'a', userCode: 'u', channel: 'c'}
        const o = new M(base).toObject()
        assert.equal(o.validFrom, null)
        assert.equal(o.invalidAt, null)
        assert.equal(o.invalidReason, '')
        assert.ok(new M({...base, invalidReason: 'expired'}).validateSync()?.errors?.invalidReason, '有原因没时刻必须拒')
        assert.ok(!new M({...base, invalidAt: D('2026-01-01'), invalidReason: 'expired'}).validateSync(), '成对必须过——样例缺 userCode/channel 时红的是别的错，测不到这条判据')
        assert.ok(new M({...base, invalidReason: 'nonsense'}).validateSync()?.errors?.invalidReason, '词表外的原因拒')
    })
    test('as-of 索引已声明（写侧成本换读侧考古全表）', () => {
        const hit = atomSchema.indexes().find((x) => x[0].userCode === 1 && x[0].channel === 1 && x[0].invalidAt === 1)
        assert.ok(hit, '缺 {userCode,channel,invalidAt} 索引')
    })
})
