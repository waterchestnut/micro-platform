/**
 * @fileOverview PR-0.3 第二块：traceId 传播到 OpenSandbox/execd 的用例
 * @module test/services/sandbox/openSandboxTrace
 * @description
 * 客户端侧是行为测（真造请求看头），调用点侧是源码锚（runner/codeTool/llmChat/intakeWiring 真的把
 * messageCode 传进来）——只有前者=判据没人调，只有后者=头拼错也没人红。两头都要。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createSandboxClient} from '../../../services/sandbox/openSandbox.js'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/sandbox/openSandbox.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const codeOf = (rel) => strip(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, ''))

const recorder = () => {
    const seen = []
    const impl = async (url, init = {}) => {
        seen.push({url, headers: init.headers || {}})
        return {
            ok: true, status: 200,
            text: async () => '{}',
            arrayBuffer: async () => new ArrayBuffer(0),
            headers: {get: () => null},
        }
    }
    return {impl, seen}
}
const base = {baseUrl: 'http://sbx.test:30980', apiKey: 'k-1', requestTimeoutMs: 500}

describe('1 客户端行为：trace 头出现在每个出站请求上', () => {
    test('cfg.trace：call 与 callRaw 都带 x-trace-id / x-conversation-id', async () => {
        const {impl, seen} = recorder()
        const c = createSandboxClient({...base, fetchImpl: impl, trace: {traceId: 'm-7', conversationCode: 'c-7'}})
        await c.call('/sandboxes/x')
        await c.callRaw('/files/info?path=/a', {baseUrl: 'http://sbx/v1/sandboxes/s1/proxy/44772'})
        assert.equal(seen[0].headers['x-trace-id'], 'm-7')
        assert.equal(seen[0].headers['x-conversation-id'], 'c-7')
        assert.equal(seen[1].headers['x-trace-id'], 'm-7', '文件/代理通道也必须带——intake 的 execd 流量要能被同一轮捞到')
    })
    test('不给 trace ⇒ 头集合与旧行为逐字一致（观测件不许改变形状）', async () => {
        const {impl, seen} = recorder()
        const c = createSandboxClient({...base, fetchImpl: impl})
        await c.call('/sandboxes/y')
        assert.deepEqual(Object.keys(seen[0].headers).sort(), ['OPEN-SANDBOX-API-KEY', 'content-type'])
    })
    test('traceId 脱敏：CRLF/空格/感叹全剥、长度 ≤64（头注入零容忍，含换行的 trace 比没 trace 危险）', async () => {
        const {impl, seen} = recorder()
        const c = createSandboxClient({...base, fetchImpl: impl, trace: {traceId: 'ev\ril x!' .repeat(12), conversationCode: ''}})
        await c.call('/z')
        const v = seen[0].headers['x-trace-id']
        assert.ok(v && !/[\r\n ]/.test(v) && !v.includes('!'), v)
        assert.ok(v.length <= 64, `应 ≤64，实际 ${v.length}`)
        assert.ok(!('x-conversation-id' in seen[0].headers), '空值不发空头')
    })
    test('调用级 trace 覆盖客户端级；显式 headers 再覆盖 trace（内部调用方有最终决定权）', async () => {
        const {impl, seen} = recorder()
        const c = createSandboxClient({...base, fetchImpl: impl, trace: {traceId: 'cfg-level', conversationCode: ''}})
        await c.call('/a', {trace: {traceId: 'call-level', conversationCode: ''}})
        await c.call('/b', {headers: {'x-trace-id': 'explicit'}})
        assert.equal(seen[0].headers['x-trace-id'], 'call-level')
        assert.equal(seen[1].headers['x-trace-id'], 'explicit')
    })
    test('只有 messageCode 没有 traceId 的宽容形状（调用方常拿到的就是这个）', async () => {
        const {impl, seen} = recorder()
        const c = createSandboxClient({...base, fetchImpl: impl, trace: {messageCode: 'mc-1', conversationCode: 'c-1'}})
        await c.call('/a')
        assert.equal(seen[0].headers['x-trace-id'], 'mc-1')
    })
})

describe('2 调用点源码锚（两侧齐：真把本轮 messageCode 灌进来了）', () => {
    test('llmChat：codeTool 上下文带 messageCode', () => {
        assert.match(codeOf('services/core/llmChat.js'), /context: \{conversationCode, userCode: curUserInfo\?\.userCode, channel, messageCode\}/)
    })
    test('codeTool：trace 由 context.messageCode 构造后传给 runModelCode', () => {
        const c = codeOf('services/sandbox/codeTool.js')
        assert.match(c, /trace: context\.messageCode \? \{traceId: context\.messageCode, conversationCode: context\.conversationCode\} : undefined/)
    })
    test('runner：getSharedSandbox 用 trace 建客户端，runModelCode 透传 params.trace', () => {
        const r = codeOf('services/sandbox/runner.js')
        assert.match(r, /const client = sandboxClient\(params\.trace \? \{trace: params\.trace\} : \{\}\)/)
        assert.match(r, /getSharedSandbox\(\{[\s\S]{0,200}?trace: params\.trace,\s*\}\)/)
    })
    test('intakeWiring：execd 客户端从 task.runCode 造 trace', () => {
        assert.match(codeOf('services/core/artifact/intakeWiring.js'), /const trace = task\.runCode \? \{traceId: String\(task\.runCode\), conversationCode: String\(task\.conversationCode \|\| ''\)\} : null/)
    })
})
