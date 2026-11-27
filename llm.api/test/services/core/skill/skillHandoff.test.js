/**
 * @fileOverview handoff 接线层的编排用例（fake 三件套真跑全分支，纪律同 skillWriteGate.test）
 * @module test/services/core/skill/skillHandoff.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {proposeHandoff, previewHandoff, redeemHandoff, buildHandoffConfirmUrl, buildJumpUrl} from '../../../../services/core/skill/skillHandoff.js'

const SECRET = 'test-handoff-secret'

function makeDac(store = new Map()) {
    return {
        store,
        lookup: async (k) => store.get(k) || null,
        proposeOnce: async (m) => {
            if (store.has(m.key)) return store.get(m.key)
            const r = {...m, status: 'proposed', paramSnapshot: m.paramSnapshot || '', paramsHash: m.paramsHash || '', resultSnapshot: ''}
            store.set(m.key, r)
            return null
        },
        updateProposed: async (k, {paramSnapshot, paramsHash}) => {
            const r = store.get(k)
            if (!r || r.status !== 'proposed') return null
            Object.assign(r, {paramSnapshot, paramsHash})
            return r
        },
        startConfirmed: async (k) => {
            const r = store.get(k)
            if (!r || r.status !== 'proposed') return null
            r.status = 'started'
            return r
        },
        settle: async (k, {text}) => {
            const r = store.get(k)
            if (!r || r.status !== 'started') return null
            r.status = 'done'
            r.resultSnapshot = text
            return r
        },
    }
}
function makeJti() {
    const seen = new Set()
    return {consumeJti: async (jti) => { if (seen.has(jti)) return false; seen.add(jti); return true }, seen}
}
const okDeps = (extra = {}) => ({secret: SECRET, dac: makeDac(), resolveHost: async () => 'callin-api-grpc.xxzx:50051', execGrpc: async (h, s, c, p) => ({success: true, data: {researchCode: p.researchCode || 'rc-gen'} }), ...extra})

describe('proposeHandoff', () => {
    test('显式 key 优先（handoff 用自造键，不依赖 runCode:toolCallId）', async () => {
        const dac = makeDac()
        const r = await proposeHandoff({key: 'handoff:my-research.createDraft:xyz', skillName: 'my-research', params: {title: 'T'}, userCode: 'u', deps: {secret: SECRET, dac, execGrpc: async () => ({success: true})}})
        assert.equal(r.ok, true)
        assert.equal(r.journalKey, 'handoff:my-research.createDraft:xyz')
        assert.ok(dac.store.get('handoff:my-research.createDraft:xyz').status === 'proposed')
    })
})

describe('buildHandoffConfirmUrl（wujie 门户深链）', () => {
    test('带 base ⇒ 绝对链接，内层 path 的 query 被整体 encode、confirmToken 续接', () => {
        const u = buildHandoffConfirmUrl('https://xxzx.paretop.net/', {clientCode: 'callin-survey', path: '/research/ai-confirm'}, 'TK/EN=+')
        assert.ok(u.startsWith('https://xxzx.paretop.net/sub/callin-survey?callin-survey='))
        assert.ok(u.includes(encodeURIComponent('/research/ai-confirm?confirmToken=TK/EN=+')), u)
    })
    test('path 已含 query ⇒ 用 & 续接 confirmToken，不是第二个 ?', () => {
        const u = buildHandoffConfirmUrl('', {clientCode: 'c', path: '/x?a=1'}, 'T')
        assert.ok(u.includes(encodeURIComponent('/x?a=1&confirmToken=T')), u)
    })
    test('base 空 ⇒ 相对门户路径', () => {
        const u = buildHandoffConfirmUrl('', {clientCode: 'callin-survey', path: '/research/ai-confirm'}, 'T')
        assert.ok(u.startsWith('/sub/callin-survey?'), u)
    })
})

describe('proposeHandoff（原用例）', () => {
    test('首次提案 ⇒ 落 proposed 行 + 返回 token，且不碰 grpc（零副作用）', async () => {
        const dac = makeDac()
        let grpcCalled = false
        const r = await proposeHandoff({runCode: 'msg-1', toolCallId: 'tc-1', skillName: 'my-research', params: {title: 'T', content: 'C'}, userCode: 'alice', deps: {secret: SECRET, dac, execGrpc: async () => { grpcCalled = true; return {success: true} }}})
        assert.equal(r.ok, true)
        assert.ok(r.token && r.journalKey === 'msg-1:tc-1')
        assert.equal(grpcCalled, false, '提案阶段绝不该落库')
        assert.equal(dac.store.get('msg-1:tc-1').status, 'proposed')
    })
    test('缺 skill/user/键 ⇒ 拒', async () => {
        assert.equal((await proposeHandoff({runCode: 'r', toolCallId: 't', params: {}, userCode: 'u', deps: okDeps()})).ok, false)   // no-skill
        assert.equal((await proposeHandoff({runCode: 'r', toolCallId: 't', skillName: 's', params: {}, userCode: '', deps: okDeps()})).ok, false)  // no-user
        assert.equal((await proposeHandoff({runCode: '', toolCallId: '', skillName: 's', params: {}, userCode: 'u', deps: okDeps()})).reason, 'no-key')
    })
    test('同键重提案 ⇒ repropose 覆写存档（一键至多一活动提案）', async () => {
        const dac = makeDac()
        const a = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {v: 1}, userCode: 'u', deps: {secret: SECRET, dac, execGrpc: async () => ({success: true})}})
        const b = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {v: 2}, userCode: 'u', deps: {secret: SECRET, dac, execGrpc: async () => ({success: true})}})
        assert.ok(a.token && b.token)
        assert.notEqual(a.paramsHash, b.paramsHash)
        assert.equal(dac.store.get('m:t').paramsHash, b.paramsHash, '存档应被最新提案覆写')
    })
})

describe('previewHandoff', () => {
    test('有效 token ⇒ 回显组装参数', async () => {
        const dac = makeDac()
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T', content: 'C'}, userCode: 'alice', deps: okDeps({dac})})
        const p = await previewHandoff({token, callerUserCode: 'alice', deps: okDeps({dac})})
        assert.equal(p.ok, true)
        assert.deepEqual(p.params, {title: 'T', content: 'C'})
        assert.equal(p.skillName, 'my-research')
    })
    test('他人持有效 token ⇒ user-mismatch（转发兑不动）', async () => {
        const dac = makeDac()
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps: okDeps({dac})})
        assert.equal((await previewHandoff({token, callerUserCode: 'bob', deps: okDeps({dac})})).reason, 'user-mismatch')
    })
    test('篡改 token ⇒ bad-signature', async () => {
        const dac = makeDac()
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps: okDeps({dac})})
        assert.equal((await previewHandoff({token: token.slice(0, -3) + 'zzz', callerUserCode: 'alice', deps: okDeps({dac})})).reason, 'bad-signature')
    })
})

describe('redeemHandoff（确认时才落库）', () => {
    test('首次兑换 ⇒ grpc 落草稿一次、行 proposed→done、返 researchCode', async () => {
        const dac = makeDac()
        const jti = makeJti()
        let calls = 0
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async (host, skill, cmd, params, cur) => { calls++; assert.equal(skill, 'my-research'); assert.equal(cmd, 'createDraft'); assert.equal(cur.userCode, 'alice'); return {success: true, data: {researchCode: 'rc-42'}} }}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T', content: 'C'}, userCode: 'alice', deps})
        const r = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice', realName: 'A'}, deps})
        assert.equal(r.ok, true)
        assert.equal(r.researchCode, 'rc-42')
        assert.equal(calls, 1, '确认兑换恰好落库一次')
        assert.equal(dac.store.get('m:t').status, 'done')
    })
    test('重放同一 token ⇒ replayed（jti 一次性），且不再落库', async () => {
        const dac = makeDac()
        const jti = makeJti()
        let calls = 0
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => { calls++; return {success: true, data: {researchCode: 'x'}} }}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        assert.equal((await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})).ok, true)
        const second = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
        assert.equal(second.ok, false)
        assert.equal(second.reason, 'replayed')
        assert.equal(calls, 1, '重放不该二次落库')
    })
    test('他人兑换 ⇒ user-mismatch，不落库', async () => {
        const dac = makeDac(); const jti = makeJti(); let calls = 0
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => { calls++; return {success: true, data: {}} }}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        assert.equal((await redeemHandoff({token, callerUserCode: 'mallory', curUserInfo: {userCode: 'mallory'}, deps})).reason, 'user-mismatch')
        assert.equal(calls, 0)
    })
    test('grpc 落库失败 ⇒ exec-failed 且行留 started（不谎报 done、不 settle）', async () => {
        const dac = makeDac(); const jti = makeJti()
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => ({success: false, error: 'boom'})}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        const r = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'exec-failed')
        assert.equal(dac.store.get('m:t').status, 'started', '落库失败行必须停 started')
    })
    test('host 解析不到 ⇒ host-unavailable 且不落库、行留 started', async () => {
        const dac = makeDac(); const jti = makeJti(); let calls = 0
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => '', execGrpc: async () => { calls++; return {success: true} }}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'ghost', params: {title: 'T'}, userCode: 'alice', deps})
        assert.equal((await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})).reason, 'host-unavailable')
        assert.equal(calls, 0)
        assert.equal(dac.store.get('m:t').status, 'started')
    })
    test('账行非 proposed（已 done）⇒ not-proposed，不落库', async () => {
        const dac = makeDac(); const jti = makeJti()
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => ({success: true, data: {}})}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        // 先兑一次→done，再用同 token 兑（jti 已消费→replayed 优先）
        await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
        const r = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
        assert.equal(r.ok, false)
    })
    test('参数漂移（token hash≠存档）⇒ param-mismatch', async () => {
        const dac = makeDac(); const jti = makeJti()
        const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => ({success: true, data: {}})}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        // 篡改存档 hash
        dac.store.get('m:t').paramsHash = 'drifted'
        assert.equal((await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})).reason, 'param-mismatch')
    })
    test('consumeJti 抛错（redis 挂）⇒ fail-closed 拒兑，不落库', async () => {
        const dac = makeDac()
        const deps = {secret: SECRET, dac, consumeJti: async () => { throw new Error('redis down') }, resolveHost: async () => 'h', execGrpc: async () => ({success: true, data: {}})}
        const {token} = await proposeHandoff({runCode: 'm', toolCallId: 't', skillName: 'my-research', params: {title: 'T'}, userCode: 'alice', deps})
        const r = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'store-unavailable')
    })
    test('通用化：materialize 后 entityId + 按 config spec.redirect 拼回跳路径（{id} 填充并 encode）', async () => {
        const prev = globalThis.llm
        globalThis.llm = {config: {cookieSecret: SECRET, skillHandoff: {handoffCommands: [{command: 'my-research.createDraft', redirect: '/research/detail/{id}'}]}}}
        try {
            const dac = makeDac(); const jti = makeJti()
            const deps = {secret: SECRET, dac, ...jti, resolveHost: async () => 'h', execGrpc: async () => ({success: true, data: {entityId: 'AB/cd'}})}
            const {token} = await proposeHandoff({key: 'k1', skillName: 'my-research', commandName: 'createDraft', params: {}, userCode: 'alice', deps})
            const r = await redeemHandoff({token, callerUserCode: 'alice', curUserInfo: {userCode: 'alice'}, deps})
            assert.equal(r.ok, true)
            assert.equal(r.entityId, 'AB/cd')
            assert.equal(r.researchCode, 'AB/cd')
            assert.equal(r.redirectPath, `/research/detail/${encodeURIComponent('AB/cd')}`)
        } finally {
            if (prev === undefined) delete globalThis.llm; else globalThis.llm = prev
        }
    })
})

describe('buildJumpUrl（jump 模式：参数编 query、无 token）', () => {
    test('标量+数组参数都进 query 并整体编码', () => {
        const u = buildJumpUrl('https://p.net', {clientCode: 'thesis', path: '/selection/apply'}, {editionCode: 'E1', topicCodes: ['T1', 'T2']})
        assert.ok(u.startsWith('https://p.net/sub/thesis?thesis='))
        const inner = decodeURIComponent(u.split('thesis=')[1])
        assert.ok(inner.startsWith('/selection/apply?'), inner)
        assert.ok(inner.includes('editionCode=E1'), inner)
        assert.ok(inner.includes('topicCodes=T1%2CT2') || inner.includes('topicCodes=T1,T2'), inner)
    })
    test('base 空 ⇒ 相对路径', () => {
        assert.ok(buildJumpUrl('', {clientCode: 'c', path: '/x'}, {a: '1'}).startsWith('/sub/c?c='))
    })
    test('空参数 ⇒ 只有 path + ?', () => {
        const u = buildJumpUrl('', {clientCode: 'c', path: '/x'}, {})
        assert.ok(decodeURIComponent(u).includes('/x?'), u)
    })
    test('路径模板：{param} 编进路径段且不再进 query（详情页类 jump）', () => {
        const u = buildJumpUrl('', {clientCode: 'union-callin-crowdfunding', path: '/crowdfunding/detail/{crowdfundingCode}'}, {crowdfundingCode: 'C1', from: 'ai'})
        const inner = decodeURIComponent(u.split('union-callin-crowdfunding=')[1])
        assert.ok(inner.startsWith('/crowdfunding/detail/C1?'), inner)
        assert.ok(inner.includes('from=ai'), inner)
        assert.ok(!inner.includes('crowdfundingCode='), '模板消费掉的参数不应再进 query')
    })
    test('路径模板值含特殊字符 ⇒ 路径段编码', () => {
        const u = buildJumpUrl('', {clientCode: 'c', path: '/d/{code}'}, {code: 'a/b c'})
        const inner = decodeURIComponent(u.split('c=')[1])
        assert.ok(inner.startsWith('/d/a%2Fb%20c?'), inner)
    })
    test('无模板路径 ⇒ 旧行为逐字（全参数进 query）', () => {
        const u = buildJumpUrl('', {clientCode: 'c', path: '/x'}, {code: 'C1'})
        const inner = decodeURIComponent(u.split('c=')[1])
        assert.equal(inner, '/x?code=C1')
    })
})
