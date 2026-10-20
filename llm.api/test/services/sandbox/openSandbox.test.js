import { test } from 'node:test'
import * as assert from 'node:assert'
import {createSandboxClient, parseCommandStream} from '../../../services/sandbox/openSandbox.js'

/** 假 fetch：记录请求，按脚本返回响应 */
function fakeFetch(script) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers})
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`
    const hit = script[key] || script[`*`] || {status: 200, json: {}}
    if (hit.throw) throw hit.throw
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      text: async () => (hit.text !== undefined ? hit.text : JSON.stringify(hit.json ?? {})),
    }
  }
  return {impl, calls}
}

const baseCfg = {
  baseUrl: 'http://sandbox.test:30980',
  apiKey: 'k-1',
  readyIntervalMs: 1,
  readyTimeoutMs: 500,
  requestTimeoutMs: 500,
}

test('lifecycle 地址归一：自动补 /v1，且容忍尾斜杠', async () => {
  for (const base of ['http://sandbox.test:30980', 'http://sandbox.test:30980/', 'http://sandbox.test:30980/v1']) {
    const {impl, calls} = fakeFetch({'GET /v1/sandboxes/x': {status: 200, json: {state: 'running'}}})
    const c = createSandboxClient({...baseCfg, baseUrl: base, fetchImpl: impl})
    await c.call('/sandboxes/x')
    assert.equal(calls[0].url, 'http://sandbox.test:30980/v1/sandboxes/x')
  }
})

test('createSandbox 发 POST /v1/sandboxes 并带鉴权头，轮询到 running 才返回', async () => {
  const calls = []
  let polls = 0
  const impl = async (url, init = {}) => {
    calls.push({url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined})
    if ((init.method || 'GET') === 'POST') {
      return {ok: true, status: 202, text: async () => JSON.stringify({sandboxId: 'sb-1'})}
    }
    polls++
    return {ok: true, status: 200, text: async () => JSON.stringify({state: polls >= 2 ? 'running' : 'pending'})}
  }
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const ret = await c.createSandbox({image: 'python:3.12', poolRef: 'pool-dev'})
  assert.equal(ret.sandboxId, 'sb-1')
  assert.equal(calls[0].url, 'http://sandbox.test:30980/v1/sandboxes')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, {image: 'python:3.12', poolRef: 'pool-dev'})
  assert.equal(calls.length, 3, 'create + 两次轮询')
  assert.equal(polls, 2)
})

test('鉴权头是 OPEN-SANDBOX-API-KEY（不是 x-api-key）', async () => {
  const {impl, calls} = fakeFetch({'GET /v1/sandboxes/a': {status: 200, json: {state: 'running'}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await c.call('/sandboxes/a')
  assert.equal(calls[0].headers['OPEN-SANDBOX-API-KEY'], 'k-1')
  assert.equal(calls[0].headers['x-api-key'], undefined)
})

test('401 的错误信息带上可行动提示', async () => {
  const {impl} = fakeFetch({'GET /v1/sandboxes/a': {status: 401, text: 'unauthorized'}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.call('/sandboxes/a'), /返回 401.*OPEN-SANDBOX-API-KEY.*unauthorized/s)
})

test('响应里没有沙箱标识时报错并带上响应片段', async () => {
  const {impl} = fakeFetch({'POST /v1/sandboxes': {status: 202, json: {foo: 1}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.createSandbox({image: 'x'}), /没有沙箱标识.*foo/)
})

test('就绪超时也要回收沙箱（不留僵尸占池）', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({url, method: init.method || 'GET'})
    const path = new URL(url).pathname
    if (init.method === 'POST') return {ok: true, status: 202, text: async () => JSON.stringify({sandboxId: 'sb-9'})}
    if (init.method === 'DELETE') return {ok: true, status: 204, text: async () => ''}
    return {ok: true, status: 200, text: async () => JSON.stringify({state: 'pending'})}
  }
  const c = createSandboxClient({...baseCfg, readyTimeoutMs: 30, fetchImpl: impl})
  await assert.rejects(c.createSandbox({image: 'x'}), /就绪超时/)
  assert.ok(calls.some(c2 => c2.method === 'DELETE' && c2.url.endsWith('/sandboxes/sb-9')), '必须发过 DELETE')
})

test('进入失败终态时立刻报错并回收', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push(init.method || 'GET')
    if ((init.method || 'GET') === 'POST') return {ok: true, status: 202, text: async () => JSON.stringify({sandboxId: 'sb-f'})}
    if ((init.method || 'GET') === 'DELETE') return {ok: true, status: 204, text: async () => ''}
    return {ok: true, status: 200, text: async () => JSON.stringify({state: 'failed'})}
  }
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.createSandbox({image: 'x'}), /终态 failed/)
  assert.ok(calls.includes('DELETE'))
})

test('endpoint 补 scheme 并透传网关路由头；runCommand 打到解析出的地址', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/sandboxes/s2/endpoints/44772': {
      status: 200,
      /** dev 实测形状：不带 scheme + 必须回带的 header */
      json: {endpoint: '192.168.31.152:30988', headers: {'OpenSandbox-Ingress-To': 's2-44772'}},
    },
    'POST /command': {status: 200, text: '{"type":"init","text":"e1"}\n{"type":"stdout","text":"ok"}\n{"type":"execution_complete","execution_time":5}\n'},
  })
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const ep = await c.endpoint('s2', 44772)
  assert.equal(ep.url, 'http://192.168.31.152:30988', '缺协议时要补 scheme')
  assert.deepEqual(ep.headers, {'OpenSandbox-Ingress-To': 's2-44772'})
  const ret = await c.runCommand({sandboxId: 's2', command: 'echo hi'})
  assert.equal(ret.stdout, 'ok', 'NDJSON 事件流要解析成纯 stdout')
  assert.equal(ret.exitCode, 0)
  assert.equal(ret.executionId, 'e1')
  const cmdCall = calls.find(x => x.url === 'http://192.168.31.152:30988/command')
  assert.ok(cmdCall, 'execd 请求必须打到解析出的入口')
  assert.equal(cmdCall.headers['OpenSandbox-Ingress-To'], 's2-44772', '路由头没带上网关找不到沙箱')
  assert.equal(cmdCall.body.command, 'echo hi', '字符串命令必须原样给 command（execd 的 command 是 shell 字符串）')
  assert.equal(cmdCall.body.argv, undefined, 'command 与 argv 互斥，不能同时出现')
})

test('endpointScheme 可切 https；已带协议时不重复补', async () => {
  const mk = (json) => {
    const calls = []
    return {calls, impl: async (url, init = {}) => {
      calls.push(url)
      return {ok: true, status: 200, text: async () => JSON.stringify(json)}
    }}
  }
  const a = mk({endpoint: 'gw.example.com'})
  const ca = createSandboxClient({...baseCfg, endpointScheme: 'https', fetchImpl: a.impl})
  assert.equal((await ca.endpoint('s', 1)).url, 'https://gw.example.com')
  const b = mk({endpoint: 'https://gw.example.com/'})
  const cb = createSandboxClient({...baseCfg, fetchImpl: b.impl})
  assert.equal((await cb.endpoint('s', 1)).url, 'https://gw.example.com', '已有协议且尾斜杠要清')
})

test('execd 访问令牌按 X-EXECD-ACCESS-TOKEN 发出（平台配了才需要）', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/sandboxes/s5/endpoints/44772': {status: 200, json: {endpoint: 'http://e5'}},
    'POST /command': {status: 200, json: {}},
  })
  const c = createSandboxClient({...baseCfg, execdAccessToken: 'tok-1', fetchImpl: impl})
  await c.runCommand({sandboxId: 's5', command: 'ls'})
  const call = calls.find(x => x.url === 'http://e5/command')
  assert.equal(call.headers['X-EXECD-ACCESS-TOKEN'], 'tok-1')
})

test('入口缺失时报错；无 headers 字段时给空对象', async () => {
  const {impl} = fakeFetch({'GET /v1/sandboxes/s4/endpoints/44772': {status: 200, json: {unexpected: 1}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.endpoint('s4', 44772), /未返回可用入口.*unexpected/)

  const {impl: impl2} = fakeFetch({'GET /v1/sandboxes/s6/endpoints/9': {status: 200, json: {endpoint: 'h:1'}}})
  const c2 = createSandboxClient({...baseCfg, fetchImpl: impl2})
  const ep = await c2.endpoint('s6', 9)
  assert.deepEqual(ep.headers, {}, '没有 headers 字段时应给空对象而不是 undefined')
})

test('数组命令走 argv（与 command 互斥），env 键名是 envs', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/sandboxes/s3/endpoints/44772': {status: 200, json: {endpoint: 'http://e:1'}},
    'POST /command': {status: 200, json: {}},
  })
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await c.runCommand({sandboxId: 's3', command: ['python', '-c', 'print(1)'], envs: {FOO: 'bar'}})
  const call = calls.find(x => x.url === 'http://e:1/command')
  assert.deepEqual(call.body.argv, ['python', '-c', 'print(1)'])
  assert.equal(call.body.command, undefined)
  assert.deepEqual(call.body.envs, {FOO: 'bar'}, '契约里环境变量键名是 envs')
})

test('端点缺失时报错并回显实际地址，便于排查网关配置', async () => {
  const {impl} = fakeFetch({'GET /v1/sandboxes/s4/endpoints/44772': {status: 200, json: {unexpected: 1}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.endpoint('s4', 44772), /未返回可用入口.*unexpected/)
})

test('网络层异常（含超时）转成带 URL 的错误', async () => {
  const err = new Error('boom'); err.name = 'AbortError'
  const {impl} = fakeFetch({'GET /v1/sandboxes/x': {throw: err}})
  const c = createSandboxClient({...baseCfg, fetchImpl: () => Promise.reject(err)})
  await assert.rejects(c.call('/sandboxes/x'), /请求失败：超时.*ms/)
  assert.ok(c)
})

test('health 走 base 不拼 /v1', async () => {
  const {impl, calls} = fakeFetch({'GET /health': {status: 200, json: {ok: true}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  assert.equal(await c.health(), true)
  assert.equal(calls[0].url, 'http://sandbox.test:30980/health')
})

// ---------- 以下覆盖 pause/resume/snapshot/续期（runc + 快照路线，选型见 docs/memory-plan.md §5.16）----------

test('pause 后等 Paused；Pausing 中间态会被 resume 先等完', async () => {
  const mk = (states) => {
    const calls = []
    let i = 0
    const impl = async (url, init = {}) => {
      const m = init.method || 'GET'
      calls.push({m, path: new URL(url).pathname, body: init.body})
      if (m === 'POST') return {ok: true, status: 202, text: async () => ''}
      const state = states[Math.min(i++, states.length - 1)]
      return {ok: true, status: 200, text: async () => JSON.stringify({status: {state}})}
    }
    return {impl, calls}
  }
  const p = mk(['Pausing', 'Paused'])
  const cp = createSandboxClient({...baseCfg, fetchImpl: p.impl})
  const after = await cp.pause('sb-1')
  assert.equal(after.status.state, 'Paused')
  assert.deepEqual(p.calls.map(x => x.m + ' ' + x.path), [
    'POST /v1/sandboxes/sb-1/pause',
    'GET /v1/sandboxes/sb-1',
    'GET /v1/sandboxes/sb-1',
  ])

  /** 沙箱还在 Pausing 时直接 resume：客户端要先等 Paused，否则服务端 409（dev 实测） */
  const r = mk(['Pausing', 'Paused', 'Running'])
  const cr = createSandboxClient({...baseCfg, fetchImpl: r.impl})
  const done = await cr.resume('sb-1')
  assert.equal(done.status.state, 'Running')
  assert.equal(r.calls[0].m, 'GET', 'resume 前必须先查状态')
  assert.deepEqual(r.calls.map(x => x.m + ' ' + x.path), [
    'GET /v1/sandboxes/sb-1', 'GET /v1/sandboxes/sb-1',
    'POST /v1/sandboxes/sb-1/resume', 'GET /v1/sandboxes/sb-1',
  ])
})

test('parseCommandStream 解的是 dev 实测到的 NDJSON 事件流', async () => {
  /** 真实抓回来的形状：事件用空行分隔，非零退出在 error.evalue 里 */
  const payload = [
    '{"type":"init","text":"3e644b24eb814ed4","timestamp":1792382418909}',
    '',
    '{"type":"ping","text":"pong","timestamp":1792382418909}',
    '',
    '{"type":"stdout","text":"smoke-ok","timestamp":1792382419042}',
    '',
    '{"type":"stdout","text":"6.8.0-139-generic","timestamp":1792382419042}',
    '',
    '{"type":"execution_complete","execution_time":134,"timestamp":1792382419042}',
    '',
  ].join('\n')
  const r = parseCommandStream(payload)
  assert.equal(r.stdout, 'smoke-ok\n6.8.0-139-generic')
  assert.equal(r.exitCode, 0)
  assert.equal(r.executionId, '3e644b24eb814ed4')
  assert.equal(r.executionTimeMs, 134)

  const err = '{"type":"init","text":"x"}\n{"type":"error","error":{"ename":"CommandExecError","evalue":"3","traceback":["exit status 3"]}}'
  const e = parseCommandStream(err)
  assert.equal(e.exitCode, 3, '非零退出码在 error.evalue 里，没有 exitCode 字段')
  assert.equal(e.stderr, '3')

  /** 有 ename 但 evalue 不是数字时按失败处理，不能报成功 */
  const anon = parseCommandStream('{"type":"error","error":{"ename":"OOM"}}')
  assert.equal(anon.exitCode, 1)
  assert.deepEqual(parseCommandStream('').stdout, '')
  assert.equal(parseCommandStream('不是 JSON 的一行').stdout, '不是 JSON 的一行', '非 JSON 行按 stdout 兜底，宁可不丢内容')
})

test('createSnapshot 只发 name（契约 additionalProperties:false），不传时发空对象', async () => {
  const {impl, calls} = fakeFetch({'POST /v1/sandboxes/s9/snapshots': {status: 202, json: {id: 'snap-1', state: 'Creating'}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await c.createSnapshot('s9', '每日备份')
  await c.createSnapshot('s9')
  assert.deepEqual(calls[0].body, {name: '每日备份'})
  assert.deepEqual(calls[1].body, {}, '不传 name 时也不能塞别的字段')
})

test('waitSnapshotReady 认 Creating→Ready，失败态带 reason', async () => {
  let n = 0
  const impl = async () => {
    n++
    const json = n < 2 ? {status: {state: 'Creating'}} : {status: {state: 'Ready'}}
    return {ok: true, status: 200, text: async () => JSON.stringify(json)}
  }
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const s = await c.waitSnapshotReady('snap-1')
  assert.equal(s.status.state, 'Ready')

  const c2 = createSandboxClient({...baseCfg, fetchImpl: async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({status: {state: 'Failed', reason: 'registry unreachable'}}),
  })})
  await assert.rejects(c2.waitSnapshotReady('snap-2'), /registry unreachable|进入 failed/)
})

test('listSnapshots 解包 items；getSnapshot/deleteSnapshot 打到正确路径', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/snapshots': {status: 200, json: {items: [{id: 'a'}, {id: 'b'}], pagination: {}}},
    'GET /v1/snapshots/a': {status: 200, json: {id: 'a'}},
    'DELETE /v1/snapshots/a': {status: 204, text: ''},
  })
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  assert.deepEqual((await c.listSnapshots({pageSize: 20})).map(x => x.id), ['a', 'b'])
  assert.ok(calls.some(x => x.url.includes('/v1/snapshots?pageSize=20')), '查询参数要带上')
  assert.equal((await c.getSnapshot('a')).id, 'a')
  await c.deleteSnapshot('a')
  assert.ok(calls.some(x => x.method === 'DELETE' && x.url.endsWith('/v1/snapshots/a')))
})

test('renewExpiration 客户端就挡住非未来时刻，不发无谓请求', async () => {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined})
    return {ok: true, status: 200, text: async () => JSON.stringify({expiresAt: '2030-01-01T00:00:00Z'})}
  }
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  await assert.rejects(c.renewExpiration('sb-1', '2020-01-01T00:00:00Z'), /必须在未来/)
  await assert.rejects(c.renewExpiration('sb-1', 'not-a-date'), /不是合法时间/)
  assert.equal(calls.length, 0, '校验失败时不应发请求')

  const future = new Date(Date.now() + 3600 * 1000)
  const ret = await c.renewExpiration('sb-1', future)
  assert.equal(ret.expiresAt, '2030-01-01T00:00:00Z')
  assert.equal(calls[0].method, 'POST')
  assert.ok(calls[0].url.endsWith('/v1/sandboxes/sb-1/renew-expiration'))
  /** 契约只要一个字段，且是 RFC3339 UTC */
  assert.deepEqual(Object.keys(calls[0].body), ['expiresAt'])
  assert.equal(calls[0].body.expiresAt, future.toISOString())
})

test('未配 baseUrl 时明确报错，不拿 undefined 去拼 URL', async () => {
  const c = createSandboxClient({baseUrl: '', apiKey: 'x', fetchImpl: async () => ({ok: true, status: 200, text: async () => ''})})
  await assert.rejects(c.call('/sandboxes'), /baseUrl 未配置/)
  assert.equal(await c.health(), false)
})

// ---------- PR-15：网络策略与 egress 侧车调用 ----------
test('replaceNetworkPolicy 走 lifecycle PUT（池模式只能在建箱后用这条路收紧出网）', async () => {
  const {impl, calls} = fakeFetch({'PUT /v1/sandboxes/sb-1/networkpolicy': {status: 200, json: {status: 'ok', mode: 'deny_all'}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const policy = {defaultAction: 'deny', egress: [{action: 'allow', target: 'a.com'}]}
  const ret = await c.replaceNetworkPolicy('sb-1', policy)
  assert.equal(ret.mode, 'deny_all')
  assert.equal(calls[0].method, 'PUT')
  assert.deepEqual(calls[0].body, policy)
})

test('getNetworkPolicy 读回当前策略', async () => {
  const {impl} = fakeFetch({'GET /v1/sandboxes/sb-2/networkpolicy': {status: 200, json: {defaultAction: 'deny', egress: []}}})
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const ret = await c.getNetworkPolicy('sb-2')
  assert.equal(ret.defaultAction, 'deny')
})

test('egressCall 按上游 Access Model 两步走：先解析侧车入口，再把返回的 headers 原样转发', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/sandboxes/sb-9/endpoints/18080': {status: 200, json: {endpoint: '192.168.31.152:30988', headers: {'OpenSandbox-Ingress-To': 'sb-9-18080'}}},
    'GET /credential-vault': {status: 200, json: {revision: 1, credentials: []}},
  })
  const c = createSandboxClient({...baseCfg, fetchImpl: impl, egressAuthToken: 'eg-1'})
  const ret = await c.getCredentialVault('sb-9')
  assert.equal(ret.revision, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'http://192.168.31.152:30988/credential-vault')
  assert.equal(calls[1].headers['OpenSandbox-Ingress-To'], 'sb-9-18080', '不转发的话网关根本找不到这台沙箱')
  assert.equal(calls[1].headers['OPENSANDBOX-EGRESS-AUTH'], 'eg-1')
})

test('createCredentialVault 用 POST 打侧车；入口没有可用地址时明确报错', async () => {
  const {impl, calls} = fakeFetch({
    'GET /v1/sandboxes/sb-3/endpoints/18080': {status: 200, json: {endpoint: '10.0.0.5:18080'}},
    'POST /credential-vault': {status: 201, json: {status: 'created'}},
  })
  const c = createSandboxClient({...baseCfg, fetchImpl: impl})
  const ret = await c.createCredentialVault('sb-3', {credentials: []})
  assert.equal(ret.status, 'created')
  assert.equal(calls[1].method, 'POST')

  const bad = fakeFetch({'GET /v1/sandboxes/sb-4/endpoints/18080': {status: 200, json: {}}})
  const c2 = createSandboxClient({...baseCfg, fetchImpl: bad.impl})
  await assert.rejects(() => c2.getCredentialVault('sb-4'), /未返回可用入口/)
})
