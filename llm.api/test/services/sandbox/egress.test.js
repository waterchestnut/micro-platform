import { test } from 'node:test'
import * as assert from 'node:assert'

global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {sandboxConfig: {}},
    tools: {},
}

const {buildEgressPolicy, normalizeEgressPolicy, looksInternal, egressPolicyFromConfig, assertPolicyCoversBindings} =
    await import('../../../services/sandbox/egress.js')
const {buildCreateBody} = await import('../../../services/sandbox/runner.js')

test('只给集群内域名不给 Service CIDR 必须直接抛错（dns+nft 的两层放行）', () => {
    assert.throws(
        () => buildEgressPolicy({allow: ['llm-api-http.micro.svc.cluster.local']}),
        /serviceCidrs/,
    )
    const p = buildEgressPolicy({
        allow: ['llm-api-http.micro.svc.cluster.local'],
        serviceCidrs: ['10.43.0.0/16'],
    })
    assert.equal(p.defaultAction, 'deny')
    assert.deepEqual(p.egress, [
        {action: 'allow', target: 'llm-api-http.micro.svc.cluster.local'},
        {action: 'allow', target: '10.43.0.0/16'},
    ])
})

test('外部域名不需要 Service CIDR；CIDR 本身也不算内部目标', () => {
    const p = buildEgressPolicy({allow: ['*.pypi.org', '192.168.31.108']})
    assert.equal(p.egress.length, 2)
    assert.equal(looksInternal('10.43.0.0/16'), false)
    assert.equal(looksInternal('reg.example.net'), false)
    assert.equal(looksInternal('api.foo.svc.cluster.local'), true)
    assert.equal(looksInternal('llm-api-http'), true, '不含点是靠 search 域拼出来的 Service 短名')
    assert.equal(looksInternal('db.internal', ['db.internal']), true)
})

test('同 target 去重（PUT 是整体替换，不把顺序不确定性带进去）', () => {
    const p = buildEgressPolicy({allow: ['a.com', 'A.COM', 'a.com', '', '  ']})
    assert.deepEqual(p.egress, [{action: 'allow', target: 'a.com'}])
})

test('serviceCidrs 必须是 CIDR；defaultAction 只认 deny/allow', () => {
    assert.throws(() => buildEgressPolicy({allow: ['x.svc.cluster.local'], serviceCidrs: ['10.43.0.1']}), /CIDR/)
    assert.throws(() => buildEgressPolicy({allow: ['a.com'], defaultAction: 'maybe'}), /defaultAction/)
})

test('normalize：拒绝非法 action/空 target，并拦住"deny 且零 allow"的孤岛配置', () => {
    assert.deepEqual(
        normalizeEgressPolicy({egress: [{action: 'ALLOW', target: ' a.com '}]}),
        {defaultAction: 'deny', egress: [{action: 'allow', target: 'a.com'}]},
    )
    assert.throws(() => normalizeEgressPolicy({egress: [{action: 'redirect', target: 'a.com'}]}), /action/)
    assert.throws(() => normalizeEgressPolicy({egress: [{action: 'allow', target: '  '}]}), /target/)
    assert.throws(() => normalizeEgressPolicy({egress: [{action: 'deny', target: 'evil.com'}]}), /孤岛/)
})

test('egressPolicyFromConfig：未配置即 null（不改变现状），简写走 builder', () => {
    llm.config.sandboxConfig = {}
    assert.equal(egressPolicyFromConfig(), null)
    llm.config.sandboxConfig = {egressPolicy: {allow: ['a.com']}}
    assert.deepEqual(egressPolicyFromConfig(), {defaultAction: 'deny', egress: [{action: 'allow', target: 'a.com'}]})
    llm.config.sandboxConfig = {egressPolicy: {defaultAction: 'allow', egress: [{action: 'deny', target: 'evil.com'}]}}
    assert.equal(egressPolicyFromConfig().defaultAction, 'allow')
    llm.config.sandboxConfig = {egressPolicy: {allow: ['x.svc.cluster.local']}}
    assert.throws(() => egressPolicyFromConfig(), /serviceCidrs/)
    llm.config.sandboxConfig = {}
})

/** 假客户端：记录调用，按脚本让 GET 回读成功或失败 */
function fakeClient({readFails = false, liveRules = null} = {}) {
    const calls = []
    return {
        calls,
        async getNetworkPolicy(sandboxId) {
            calls.push(['get', sandboxId])
            if (readFails) {
                throw new Error('502 BACKEND_CONNECTION_FAILED: Could not connect to the backend sandbox 10.42.151.182:18080')
            }
            return {status: 'ok', mode: 'enforcing', enforcementMode: 'dns+nft', policy: {egress: liveRules === null ? POLICY.egress : liveRules}}
        },
        async destroySandbox(sandboxId) {
            calls.push(['destroy', sandboxId])
            return true
        },
    }
}

const POLICY = {defaultAction: 'deny', egress: [{action: 'allow', target: 'a.com'}]}

test('verifyEgressPolicy：没配策略就是空操作（dev 现状不受影响）', async () => {
    const {verifyEgressPolicy} = await import('../../../services/sandbox/runner.js')
    const c = fakeClient()
    assert.equal(await verifyEgressPolicy(c, 'sb-1', null), false)
    assert.equal(c.calls.length, 0)
})

test('verifyEgressPolicy 默认 fail-closed：回读失败（502=无侧车）必须销毁沙箱并抛错', async () => {
    llm.config.sandboxConfig = {}
    const {verifyEgressPolicy} = await import('../../../services/sandbox/runner.js')
    const c = fakeClient({readFails: true})
    await assert.rejects(() => verifyEgressPolicy(c, 'sb-2', POLICY), /以为收紧了/)
    assert.deepEqual(c.calls.map(x => x[0]), ['get', 'destroy'])
})

test('verifyEgressPolicy：回读能通但 allow 目标不齐也算失败（"侧车在、策略不是我要的"必须拦下）', async () => {
    llm.config.sandboxConfig = {}
    const {verifyEgressPolicy} = await import('../../../services/sandbox/runner.js')
    const c = fakeClient({liveRules: [{action: 'allow', target: 'other.com'}]})
    await assert.rejects(() => verifyEgressPolicy(c, 'sb-2b', POLICY), /缺少 allow 目标/)
})

test('egressEnforce=false 才降级为告警放行（显式选择，不默认）', async () => {
    llm.config.sandboxConfig = {egressEnforce: false}
    const {verifyEgressPolicy} = await import('../../../services/sandbox/runner.js')
    const c = fakeClient({readFails: true})
    assert.equal(await verifyEgressPolicy(c, 'sb-3', POLICY), false)
    assert.deepEqual(c.calls.map(x => x[0]), ['get'], '降级路径不应销毁沙箱')
    llm.config.sandboxConfig = {}
})

test('池模式与出网策略互斥要在建箱前就拒（dev 实测池沙箱无侧车，PUT 必 502）', async () => {
    const {assertPoolPolicyCompatible} = await import('../../../services/sandbox/runner.js')
    const policy = {defaultAction: 'deny', egress: [{action: 'allow', target: '1.2.3.4'}]}
    assert.throws(() => assertPoolPolicyCompatible('pool-dev', policy), /互斥/)
    assert.throws(() => assertPoolPolicyCompatible('pool-dev', policy), /502/)
    assert.doesNotThrow(() => assertPoolPolicyCompatible('', policy), '非池模式带策略是合法组合')
    assert.doesNotThrow(() => assertPoolPolicyCompatible('pool-dev', null), '池模式不带策略是现状默认')
})

test('waitExecdReady：502 连吃后第 N 次就绪即返回；永不就绪则销毁并抛错（§5.30 非池实测）', async () => {
    const {waitExecdReady} = await import('../../../services/sandbox/runner.js')
    let attempt = 0
    const calls = []
    const okClient = {
        async runCommand() {
            attempt++
            if (attempt < 3) {
                throw new Error('502 BACKEND_CONNECTION_FAILED')
            }
            return {exitCode: 0, stdout: ''}
        },
    }
    assert.equal(await waitExecdReady(okClient, 'sb-e1', {tries: 5, intervalMs: 1}), true)
    assert.equal(attempt, 3)

    const badClient = {
        async runCommand() {
            calls.push('probe')
            throw new Error('502')
        },
        async destroySandbox(id) {
            calls.push('destroy')
            return true
        },
    }
    await assert.rejects(() => waitExecdReady(badClient, 'sb-e2', {tries: 2, intervalMs: 1}), /execd 探活.*已销毁/)
    assert.deepEqual(calls, ['probe', 'probe', 'destroy'])
})

/** §5.29 实测契约：侧车在 create 带策略时才注入，所以 buildCreateBody 是唯一的下发通道 */
const RL = {cpu: '500m', memory: '512Mi'}

test('buildCreateBody：池模式请求体与现状一致（不带 image/networkPolicy/credentialProxy）', () => {
    const b = buildCreateBody({poolRef: 'pool-dev', timeout: 660, metadata: {via: 'llm-api-run-code', conv: 'c1'}})
    assert.deepEqual(b.extensions, {poolRef: 'pool-dev'})
    assert.equal(b.image, undefined)
    assert.equal(b.networkPolicy, undefined)
    assert.equal(b.credentialProxy, undefined)
    assert.equal(b.timeout, 660)
})

test('buildCreateBody：非池 + 策略 → networkPolicy 直传 create（PUT 后补的路径已按 §5.24 机制废弃）', () => {
    const pol = {defaultAction: 'deny', egress: [{action: 'allow', target: '192.168.31.108'}]}
    const b = buildCreateBody({poolRef: '', egress: pol, image: 'reg/x/ci:v1', resourceLimits: RL, timeout: 600})
    assert.deepEqual(b.networkPolicy, pol)
    assert.deepEqual(b.resourceLimits, RL)
    assert.deepEqual(b.entrypoint, ['tail', '-f', '/dev/null'], 'entrypoint 缺省要可跑（image 在场时 spec 必填）')
})

test('buildCreateBody：credentialProxy 三条互斥/前置都建箱前抛（池互斥、缺策略、缺资源）', () => {
    const pol = {defaultAction: 'deny', egress: [{action: 'allow', target: 'a.com'}]}
    assert.throws(() => buildCreateBody({poolRef: 'pool-dev', egress: pol}), /互斥/)
    assert.throws(() => buildCreateBody({poolRef: 'pool-dev', credentialProxy: true}), /poolRef/)
    assert.throws(() => buildCreateBody({poolRef: '', credentialProxy: true, image: 'i', resourceLimits: RL}), /Requires networkPolicy/)
    assert.throws(() => buildCreateBody({poolRef: '', image: 'i', timeout: 1}), /resourceLimits/)
    assert.throws(() => buildCreateBody({poolRef: '', resourceLimits: RL, timeout: 1}), /sandbox_defaultImage/)
    const b = buildCreateBody({poolRef: '', egress: pol, credentialProxy: true, image: 'i', resourceLimits: RL})
    assert.deepEqual(b.credentialProxy, {enabled: true})
})

test('assertPolicyCoversBindings：建档/改策略前本地守门，缺哪个报哪个（精确+通配）', () => {
    const pol = {defaultAction: 'deny', egress: [{action: 'allow', target: 'reg.example.net'}, {action: 'allow', target: '*.npmjs.org'}]}
    const binds = [{name: 'b1', match: {hosts: ['reg.example.net']}}, {name: 'b2', match: {hosts: ['registry.npmjs.org']}}]
    assert.doesNotThrow(() => assertPolicyCoversBindings(pol, binds))
    assert.throws(
        () => assertPolicyCoversBindings({defaultAction: 'deny', egress: [{action: 'allow', target: 'other.com'}]}, [{name: 'b1', match: {hosts: ['reg.example.net']}}]),
        /b1 → reg.example.net/,
    )
    assert.throws(() => assertPolicyCoversBindings(pol, [{name: 'bx', match: {hosts: ['npmjs.org']}}]), /裸域不被通配覆盖|bx → npmjs\.org/)
})
