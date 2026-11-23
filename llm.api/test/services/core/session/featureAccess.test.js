/**
 * @fileOverview featureAccess 判据四件的穷举用例（platform-feature-map Phase 1 首刀）
 * @module test/services/core/session/featureAccess.test
 * @description
 * 钉设计稿定稿的四条纪律：两层合取（W9/§9 属主修正模型）、缺省即严（browseGate 缺失按 true）、
 * 存量直通与 schema 默认**分家**（W6 归一单源）、child 写面排除（W10）。
 * 纯函数零 IO——hasPriv 的 RPC 面由调用方喂 granted 表，这里只测合取逻辑本身。
 */
import { test, describe } from 'node:test'
import * as assert from 'node:assert/strict'
import {
    decideFeatureAccess, decideEffectClass, decideFeatureToolScope, normalizeFeatureEntry,
} from '../../../../services/core/session/featureAccess.js'

const E = (over = {}) => ({ clientCode: 'learoad', browseGate: true, featurePrivs: [], ...over })

describe('decideFeatureAccess：两层合取', () => {
    test('入口门：browseGate=true 时 browse 不过就全案拒（功能级再满也没用）', () => {
        const r = decideFeatureAccess({ entry: E({ featurePrivs: ['a'] }), granted: { 'a': true } })
        assert.deepEqual(r, { allow: false, reason: 'browse-denied' })
    })
    test('browseGate=true 且 browse 过 + featurePrivs 全过 ⇒ ok', () => {
        const r = decideFeatureAccess({ entry: E({ featurePrivs: ['a', 'b'] }), granted: { 'learoad-browse': true, a: true, b: true } })
        assert.equal(r.allow, true)
    })
    test('功能级任一不过 ⇒ feature-denied:<priv> 点名到具体缺失项（审计与排障都要指得准）', () => {
        const r = decideFeatureAccess({ entry: E({ featurePrivs: ['a', 'x'] }), granted: { 'learoad-browse': true, a: true } })
        assert.deepEqual(r, { allow: false, reason: 'feature-denied:x' })
    })
    test('browseGate=false（公共子系统）⇒ 不查 browse，只看功能级', () => {
        const r = decideFeatureAccess({ entry: E({ browseGate: false }), granted: {} })
        assert.equal(r.allow, true)
    })
    test('browseGate 缺失/脏值 ⇒ 保守按 true（缺省即严，normalizeReviewStatus 同款性格）', () => {
        for (const bad of [undefined, null, 'yes', 1]) {
            assert.equal(decideFeatureAccess({ entry: E({ browseGate: bad }), granted: {} }).reason, 'browse-denied', `browseGate=${bad}`)
        }
    })
    test('featurePrivs 脏形状（非数组/含空项/含非串）⇒ 不因脏词放行也不炸', () => {
        assert.equal(decideFeatureAccess({ entry: E({ browseGate: false, featurePrivs: null }), granted: {} }).allow, true)
        const r = decideFeatureAccess({ entry: E({ browseGate: false, featurePrivs: ['', 'x', 7] }), granted: {} })
        assert.equal(r.reason, 'feature-denied:x', '空串跳过、非串跳过、真 priv 照判')
    })
})

describe('decideEffectClass：W6 归一单源（存量直通 ≠ schema 默认）', () => {
    test('缺失⇒legacyPassthrough（effect 空串，装配面据此走旧行为）', () => {
        assert.deepEqual(decideEffectClass({}), { effect: '', passthrough: true })
    })
    test('合法三值照取', () => {
        for (const e of ['guide', 'read', 'write']) {
            assert.deepEqual(decideEffectClass({ effectClass: e }), { effect: e, passthrough: false })
        }
    })
    test('脏值按 guide 最保守且**不冒充直通**（脏词≠存量：装配要能分辨"没标"与"标坏"）', () => {
        assert.deepEqual(decideEffectClass({ effectClass: 'delete-all' }), { effect: 'guide', passthrough: false })
    })
})

describe('decideFeatureToolScope：W10 child 写面排除', () => {
    test('编排 child + write ⇒ 拒（child 无出题通道，提案=死锁）', () => {
        assert.equal(decideFeatureToolScope({ isOrchestratedChild: true, effect: 'write' }).include, false)
    })
    test('child+read/guide/直通 都在；主会话轮全放行', () => {
        for (const effect of ['read', 'guide', '']) {
            assert.equal(decideFeatureToolScope({ isOrchestratedChild: true, effect }).include, true)
        }
        assert.equal(decideFeatureToolScope({ isOrchestratedChild: false, effect: 'write' }).include, true)
    })
})

describe('normalizeFeatureEntry：W1 identityParams 收敛单源', () => {
    test('方法面声明优先；仅 paramsSchema.x-identity 时兼容读到', () => {
        const a = normalizeFeatureEntry({ invokeSpec: { identityParams: [' userCode '] } })
        assert.deepEqual(a.identityParams, ['userCode'], 'trim 后进判据')
        const b = normalizeFeatureEntry({ invokeSpec: { paramsSchema: { properties: { userCode: { type: 'string', 'x-identity': true }, q: { type: 'string' } } } } })
        assert.deepEqual(b.identityParams, ['userCode'])
    })
    test('两处都声明 ⇒ 取方法面 + identityDeclaredBoth 报警（单源违例不静默选边）', () => {
        const r = normalizeFeatureEntry({ invokeSpec: { identityParams: ['operator'], paramsSchema: { properties: { userCode: { 'x-identity': true } } } } })
        assert.deepEqual(r.identityParams, ['operator'])
        assert.equal(r.identityDeclaredBoth, true)
    })
    test('两处都空 ⇒ 未声明（存量现状，V10 迁移清单成员，不报错但可数出来）', () => {
        const r = normalizeFeatureEntry({})
        assert.deepEqual(r.identityParams, [])
        assert.equal(r.identityDeclaredBoth, false)
    })
    test('归一出 browseGate/featurePrivs/effect 的判据可吃形状（含 browseGate 缺失原样传递，保守在合取件处理）', () => {
        const r = normalizeFeatureEntry({ clientCode: 'callin', featurePrivs: ['p1'], effectClass: 'read' })
        assert.equal(r.clientCode, 'callin')
        assert.deepEqual(r.featurePrivs, ['p1'])
        assert.equal(r.effect, 'read')
        assert.equal(r.browseGate, undefined)
        assert.equal(decideFeatureAccess({ entry: r, granted: {} }).reason, 'browse-denied', '缺失经合取件仍保守')
    })
})
