/**
 * @fileOverview 功能目录扩展字段的离线 cast 用例（platform-feature-map Phase 0）
 * @module test/daos/core/schema/grpcSkillCatalogFields.test
 * @description
 * 守三条会静默失效的口径（本仓 schema 教训三连的第四钉）：
 * ① 扩展字段全部**声明在案**——未声明=按 cast 静默丢，Phase 1 检索面读到的永远是空；
 * ② 默认值零行为——老记录（无新字段）validate 通过、effectClass 缺省 guide、
 *    装配链不读新字段时形状逐字不变（容器先于消费）；
 * ③ enum 严——效果级/幂等策略的非法值在写入面拒（目录数据是模型视野的原料，
 *    脏词进库=脏推荐出口）。
 */
import {test, describe, before} from 'node:test'
import * as assert from 'node:assert'
import mongoose from 'mongoose'

let schema
before(async () => {
    // grpcSkillSchema 顶层读 llm.tools（skillCode default），离线用例先注入最小全局（userInfoDeadline 同法）
    global.llm = {tools: {getUUID: () => 'mock-uuid-0001'}}
    schema = (await import('../../../../daos/core/schema/grpcSkillSchema.js')).default
})

const mkModel = (name) => mongoose.models[name] || mongoose.model(name, schema)
const base = () => ({
    skillName: 'catalog-unit-test', skillMD: '---\nname: t\n---\nbody',
    channels: ['xxzx_common'], grpcHost: 'h:1', clientCode: 'learoad',
})

describe('1 声明在案（cast 不丢）', () => {
    test('目录七扩展字段路径齐（effectClass/featurePrivs/browseGate/entry/invokeSpec/idemKeyPolicy/sourceManifest）', () => {
        const paths = schema.paths || {}
        for (const f of ['effectClass', 'featurePrivs', 'browseGate', 'entry', 'invokeSpec', 'idemKeyPolicy', 'sourceManifest']) {
            assert.ok(paths[f], `字段 ${f} 未声明——写库会被 cast 静默丢（教训三连）`)
        }
        // 子路径可达（Object 子 schema 非 Mixed 裸存——嵌套字段声明才算数）
        assert.ok(schema.path('entry.subsystem'), 'entry.subsystem 子字段缺席')
        assert.ok(schema.path('invokeSpec.api'), 'invokeSpec.api 子字段缺席')
        assert.ok(schema.path('sourceManifest.version'), 'sourceManifest.version 子字段缺席')
    })
    test('整对象写入读回：新字段值逐字保真（cast 后不失）', () => {
        const M = mkModel('T_cat_roundtrip')
        const doc = new M({
            ...base(), effectClass: 'read', featurePrivs: ['xxz-report:manage', 'x-priv'], browseGate: true,
            entry: {subsystem: 'learoad', menuPath: '数据看板/周报', url: '/sub/learoad#/report'},
            invokeSpec: {api: 'learoad.stat.query', paramsSchema: {type: 'object'}, timeoutMs: 8000},
            idemKeyPolicy: 'explicit', sourceManifest: {subsystemCode: 'learoad', version: '3', stamp: 'md5:ab'},
        })
        const err = doc.validateSync()
        assert.ok(!err, `合法目录条目被拒: ${err?.message}`)
        assert.equal(doc.effectClass, 'read')
        assert.deepEqual(doc.featurePrivs, ['xxz-report:manage', 'x-priv'])
        assert.equal(doc.browseGate, true)
        assert.equal(doc.entry.url, '/sub/learoad#/report')
        assert.equal(doc.invokeSpec.timeoutMs, 8000)
        assert.equal(doc.sourceManifest.version, '3')
    })
})

describe('2 默认值零行为（容器先于消费）', () => {
    test('老记录（无新字段）validate 过，effectClass 缺省 guide、idemKeyPolicy 缺省 per-run', () => {
        const M = mkModel('T_cat_default')
        const doc = new M(base())
        assert.ok(!doc.validateSync())
        assert.equal(doc.effectClass, 'guide', 'guide 缺省=最保守（不会误标可调用）')
        assert.equal(doc.idemKeyPolicy, 'per-run')
    })
})

describe('3 enum 严（脏词不进目录）', () => {
    test('effectClass 非法值拒', () => {
        const M = mkModel('T_cat_enum')
        assert.ok(new M({...base(), effectClass: 'delete-everything'}).validateSync()?.errors?.effectClass)
    })
    test('idemKeyPolicy 非法值拒', () => {
        const M = mkModel('T_cat_enum2')
        assert.ok(new M({...base(), idemKeyPolicy: 'none'}).validateSync()?.errors?.idemKeyPolicy)
    })
})
