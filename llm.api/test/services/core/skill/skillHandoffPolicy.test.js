/**
 * @fileOverview 写面 handoff 一次性确认判据的穷举用例（纯函数，无 IO）
 * @module test/services/core/skill/skillHandoffPolicy.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {makeSignedBlob} from '../../../../tools/signedBlob.js'
import {
    HANDOFF_REASONS, DEFAULT_HANDOFF_TTL_MS,
    canonicalJson, hashParams, buildHandoffPayload, verifyHandoffClaim, verifyHandoffToken, decideRedeem,
} from '../../../../services/core/skill/skillHandoffPolicy.js'

const SECRET = 'test-secret-k3y'

describe('canonicalJson / hashParams（键序稳定，防合法确认被误判漂移）', () => {
    test('同内容不同键序 ⇒ canonical 串一致、哈希一致', () => {
        assert.equal(canonicalJson({b: 1, a: 2}), canonicalJson({a: 2, b: 1}))
        assert.equal(hashParams({title: 'x', content: 'y'}), hashParams({content: 'y', title: 'x'}))
    })
    test('嵌套对象也键序稳定', () => {
        assert.equal(hashParams({o: {z: 1, a: 2}, k: 3}), hashParams({k: 3, o: {a: 2, z: 1}}))
    })
    test('数组保序（顺序有意义）', () => {
        assert.notEqual(hashParams({a: [1, 2]}), hashParams({a: [2, 1]}))
    })
    test('值不同 ⇒ 哈希不同', () => {
        assert.notEqual(hashParams({t: 'a'}), hashParams({t: 'b'}))
    })
    test('缺省/空 ⇒ 稳定不抛', () => {
        assert.equal(hashParams(undefined), hashParams({}))
    })
})

describe('buildHandoffPayload', () => {
    test('带 iat/exp 且 exp=iat+ttl', () => {
        const p = buildHandoffPayload({journalKey: 'k', userCode: 'u', paramsHash: 'h', jti: 'j', now: 1000, ttlMs: 500})
        assert.deepEqual(p, {journalKey: 'k', userCode: 'u', paramsHash: 'h', jti: 'j', iat: 1000, exp: 1500})
    })
})

describe('verifyHandoffClaim（拆签后的语义：主张完整 + 确认人=发起人）', () => {
    test('齐且匹配 ⇒ ok', () => {
        const r = verifyHandoffClaim({value: {journalKey: 'k', jti: 'j', userCode: 'u', paramsHash: 'h'}, callerUserCode: 'u'})
        assert.equal(r.ok, true)
        assert.equal(r.reason, 'ok')
    })
    test('载荷空/非对象 ⇒ bad-payload', () => {
        assert.equal(verifyHandoffClaim({value: null, callerUserCode: 'u'}).reason, 'bad-payload')
        assert.equal(verifyHandoffClaim({value: 'x', callerUserCode: 'u'}).reason, 'bad-payload')
    })
    test('缺 journalKey ⇒ missing-claim', () => {
        assert.equal(verifyHandoffClaim({value: {jti: 'j', userCode: 'u'}, callerUserCode: 'u'}).reason, 'missing-claim')
    })
    test('缺 jti ⇒ missing-jti（没有一次性锚不许兑）', () => {
        assert.equal(verifyHandoffClaim({value: {journalKey: 'k', userCode: 'u'}, callerUserCode: 'u'}).reason, 'missing-jti')
    })
    test('确认人≠发起人 ⇒ user-mismatch（深链被转发也兑不动）', () => {
        assert.equal(verifyHandoffClaim({value: {journalKey: 'k', jti: 'j', userCode: 'alice'}, callerUserCode: 'bob'}).reason, 'user-mismatch')
    })
    test('调用者身份缺失 ⇒ user-mismatch（不默认放行）', () => {
        assert.equal(verifyHandoffClaim({value: {journalKey: 'k', jti: 'j', userCode: 'u'}, callerUserCode: ''}).reason, 'user-mismatch')
    })
})

describe('verifyHandoffToken（signedBlob 真实 round-trip + 归一理由）', () => {
    const fresh = () => makeSignedBlob(SECRET, buildHandoffPayload({journalKey: 'k', userCode: 'u', paramsHash: 'h', jti: 'j', now: Date.now(), ttlMs: 60000}))
    test('未篡改且未过期且同人 ⇒ ok', () => {
        const r = verifyHandoffToken({secret: SECRET, token: fresh(), callerUserCode: 'u', now: Date.now()})
        assert.equal(r.ok, true)
        assert.equal(r.value.journalKey, 'k')
    })
    test('无密钥 ⇒ no-secret', () => {
        assert.equal(verifyHandoffToken({secret: '', token: fresh(), callerUserCode: 'u'}).reason, 'no-secret')
    })
    test('格式不对 ⇒ bad-format', () => {
        assert.equal(verifyHandoffToken({secret: SECRET, token: 'no-dot-here', callerUserCode: 'u'}).reason, 'bad-format')
    })
    test('篡改 ⇒ bad-signature', () => {
        const t = fresh()
        assert.equal(verifyHandoffToken({secret: SECRET, token: t.slice(0, -2) + 'xx', callerUserCode: 'u'}).reason, 'bad-signature')
    })
    test('换密钥 ⇒ bad-signature（他方密钥签的同形串）', () => {
        const foreign = makeSignedBlob('other-secret', buildHandoffPayload({journalKey: 'k', userCode: 'u', paramsHash: 'h', jti: 'j', now: Date.now()}))
        assert.equal(verifyHandoffToken({secret: SECRET, token: foreign, callerUserCode: 'u'}).reason, 'bad-signature')
    })
    test('过期 ⇒ expired', () => {
        const t = makeSignedBlob(SECRET, buildHandoffPayload({journalKey: 'k', userCode: 'u', paramsHash: 'h', jti: 'j', now: 1000, ttlMs: 100}))
        assert.equal(verifyHandoffToken({secret: SECRET, token: t, callerUserCode: 'u', now: 5000, ttlMs: 100}).reason, 'expired')
    })
    test('同人校验穿透到 token 校验：他人持有效 token 也拒', () => {
        assert.equal(verifyHandoffToken({secret: SECRET, token: fresh(), callerUserCode: 'mallory'}).reason, 'user-mismatch')
    })
})

describe('decideRedeem（token 判定 × jti 一次性 × 参数冻结 的复合终判）', () => {
    const proposed = {status: 'proposed', paramsHash: 'h', paramSnapshot: JSON.stringify({content: 'C'})}
    test('全通 ⇒ proceed 且只回存档 paramSnapshot', () => {
        const r = decideRedeem({claimVerdict: {ok: true, reason: 'ok', value: {journalKey: 'k', paramsHash: 'h', userCode: 'u', jti: 'j'}}, alreadyConsumed: false, existing: proposed})
        assert.equal(r.action, 'proceed')
        assert.equal(r.useParams, proposed.paramSnapshot)
        assert.equal(r.journalKey, 'k')
    })
    test('token 不过 ⇒ 沿用 token 理由（优先级最高）', () => {
        const r = decideRedeem({claimVerdict: {ok: false, reason: 'expired'}, alreadyConsumed: false, existing: proposed})
        assert.equal(r.action, 'refuse')
        assert.equal(r.reason, 'expired')
    })
    test('jti 已消费 ⇒ replayed（先于账本判定，防重放优先）', () => {
        const r = decideRedeem({claimVerdict: {ok: true, reason: 'ok', value: {journalKey: 'k', paramsHash: 'h', userCode: 'u', jti: 'j'}}, alreadyConsumed: true, existing: proposed})
        assert.equal(r.action, 'refuse')
        assert.equal(r.reason, 'replayed')
    })
    test('无账/非 proposed ⇒ not-proposed', () => {
        assert.equal(decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h'}}, alreadyConsumed: false, existing: null}).reason, 'not-proposed')
        assert.equal(decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h'}}, alreadyConsumed: false, existing: {status: 'done'}}).reason, 'not-proposed')
    })
    test('参数漂移 ⇒ param-mismatch（确认 token 与存档 hash 不符）', () => {
        const r = decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h2'}}, alreadyConsumed: false, existing: proposed})
        assert.equal(r.reason, 'param-mismatch')
    })
    test('账上无 hash ⇒ param-mismatch（空不许当已核对）', () => {
        const r = decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h'}}, alreadyConsumed: false, existing: {status: 'proposed', paramsHash: '', paramSnapshot: '{}'}})
        assert.equal(r.reason, 'param-mismatch')
    })
})

describe('HANDOFF_REASONS 封闭集', () => {
    test('DEFAULT_HANDOFF_TTL_MS 为正数', () => {
        assert.ok(Number.isFinite(DEFAULT_HANDOFF_TTL_MS) && DEFAULT_HANDOFF_TTL_MS > 0)
    })
    test('decideRedeem/verify 产出的每个理由都在词表内（新理由必进表）', () => {
        const seen = new Set()
        seen.add(decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h', userCode: 'u', jti: 'j'}}, existing: {status: 'proposed', paramsHash: 'h', paramSnapshot: '{}'}}).reason)
        seen.add(decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'h'}}, alreadyConsumed: true, existing: {status: 'proposed', paramsHash: 'h'}}).reason)
        seen.add(decideRedeem({claimVerdict: {ok: false, reason: 'user-mismatch'}, existing: null}).reason)
        seen.add(decideRedeem({claimVerdict: {ok: true, value: {journalKey: 'k', paramsHash: 'z'}}, existing: {status: 'proposed', paramsHash: 'h'}}).reason)
        for (const r of seen) assert.ok(HANDOFF_REASONS.includes(r), `理由 ${r} 不在 HANDOFF_REASONS 封闭集`)
    })
})
