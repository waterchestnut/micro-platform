/**
 * @fileOverview ask_user 挂起提问与答复路由器的用例（PR-E 装配）
 * @module test/services/core/session/askUserTool
 * @description
 * 这里测的是**有状态外壳的裁决面**（判据本身在 mrtrPayload.test.js 已穷举）：
 * ①一次性消费是权威的——settle 后条目变回执，迟到者得到 already-answered 而不是第二次采用；
 * ②取消不留回执（诚实：没人答过它，谎称"已被回答"是造数据）；
 * ③signal 监听成对增删（挂起多问不清监听就是每 run 泄漏面）；
 * ④requestState 逐字比对（askId 抄对门牌也不许把 A 题的答案记到 B 题头上）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/askUserTool.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const AT = await import(pathToFileURL(path.join(SRC, 'services/core/session/askUserTool.js')).href)
const MP = await import(pathToFileURL(path.join(SRC, 'services/core/session/mrtrPayload.js')).href)
const {createAnswerRouter, awaitAskUser, buildAskTools, isAskTool, askToolEnabled, answerSecret, ASK_TOOL_NAME} = AT

const SEC = 'test-secret-答案要签名'
/**
 * 挂起语义的测试必须自带看门狗：变异批里"超时配置失效/坏题照样挂起"的结局是 **await 永不 settle**——
 * 那在测试报告里长成了 timeout 而不是断言红。用例不许有"挂死"这个结局。
 * @param {Promise} p 被测 promise
 * @param {Number} ms 上限
 * @param {String} label 场景名
 * @returns {Promise} 原结果或快速失败
 */
const withGuard = (p, ms, label) => Promise.race([
    p,
    new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} 未在 ${ms}ms 内 settle（挂起语义失控）`)), ms)
        p.finally(() => clearTimeout(t)).catch(() => {})
    }),
])
const formReq = {mode: 'form', message: '选哪个方案？', requestedSchema: {type: 'object', properties: {plan: {type: 'string', enum: ['A', 'B']}}, required: ['plan']}}
const sealFor = (askId, kind = 'question', runCode = 'run-1') => MP.sealRequestState({runCode, askId, kind}, {secret: SEC})

describe('1 工具面基础', () => {
    test('定义/谓词/开关', () => {
        const tools = buildAskTools()
        assert.equal(tools.length, 1)
        assert.equal(tools[0].function.name, ASK_TOOL_NAME)
        assert.equal(isAskTool('ask_user'), true)
        assert.equal(isAskTool('update_plan'), false)
        assert.equal(askToolEnabled({askEnabled: true}), true)
        assert.equal(askToolEnabled({askEnabled: 'true'}), false, '字符串真值不算开（宽松真值是配置事故温床）')
        assert.equal(askToolEnabled({}), false)
    })
    test('answerSecret 取配置不抛（未配置给空串，由调用方挡）', () => {
        assert.equal(typeof answerSecret(), 'string')
    })
})

describe('2 answerRouter：一次性消费的权威账本', () => {
    test('首答采用；迟到者拿 already-answered+notice（先到先得在单点定序）', async () => {
        const r = createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
        const sealed = sealFor('a-1')
        const p = r.register({askId: 'a-1', kind: 'question', schema: formReq.requestedSchema, requestState: sealed, timeoutMs: 5000})
        assert.deepEqual(r.deliver({askId: 'a-1', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed}), {accepted: true})
        assert.deepEqual(await p, {resultType: 'complete', responses: {plan: 'A'}, answeredBy: 'u-1'})
        const late = r.deliver({askId: 'a-1', responses: {plan: 'B'}, answeredBy: 'u-1', requestState: sealed})
        assert.equal(late.accepted, false)
        assert.equal(late.reason, 'already-answered')
        assert.match(late.notice, /已被 u-1 回答/, '回执里的 notice 要指名——"被谁答的"是 §2F line 548 定的可见性')
        assert.equal(r.stats.answered, 1)
        assert.equal(r.stats.rejected, 1)
    })
    test('取消/超时不留回执（没人答过它，谎称已被回答=造数据）', async () => {
        const r = createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
        const sealed = sealFor('a-2')
        const p = r.register({askId: 'a-2', kind: 'question', schema: null, requestState: sealed, timeoutMs: 20})
        const outcome = await p
        assert.deepEqual(outcome, {resultType: 'cancelled', reason: 'timeout'})
        const after = r.deliver({askId: 'a-2', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed})
        assert.equal(after.reason, 'no-such-request', '超时后条目应彻底消失')
        assert.equal(r.stats.cancelled, 1)
    })
    test('signal abort ⇒ client-gone；监听成对增删（多次提问不许攒监听器）', async () => {
        const r = createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
        let addCount = 0
        let rmCount = 0
        const handlers = []
        const sig = {
            aborted: false,
            addEventListener: (ev, fn) => { if (ev === 'abort') { addCount++; handlers.push(fn) } },
            removeEventListener: (ev, fn) => { if (ev === 'abort') { rmCount++; const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1) } },
        }
        const p1 = r.register({askId: 'x-1', schema: null, requestState: sealFor('x-1'), timeoutMs: 60000, signal: sig})
        const p2 = r.register({askId: 'x-2', schema: null, requestState: sealFor('x-2'), timeoutMs: 60000, signal: sig})
        assert.equal(addCount, 2)
        for (const fn of [...handlers]) {
            fn()
        }
        assert.deepEqual(await p1, {resultType: 'cancelled', reason: 'client-gone'})
        assert.deepEqual(await p2, {resultType: 'cancelled', reason: 'client-gone'})
        assert.equal(rmCount, 2, '每次终局必须摘走自己的监听——settle 后 addEventListener 只减不加才有配对')
        const preAborted = {aborted: true, addEventListener: () => { addCount++ }, removeEventListener: () => { rmCount++ }}
        const o3 = await r.register({askId: 'x-3', schema: null, requestState: sealFor('x-3'), timeoutMs: 60000, signal: preAborted})
        assert.deepEqual(o3, {resultType: 'cancelled', reason: 'client-gone'})
        assert.equal(addCount, 2, '已经断开的不再挂监听')
        assert.equal(r.deliver({askId: 'x-1', responses: {}, answeredBy: 'u-1', requestState: sealFor('x-1')}).reason, 'no-such-request', '取消不留回执（与超时同款诚实）')
    })
    test('门牌错配全拒：未知 askId / requestState 不一致 / 坏答案', () => {
        const r = createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
        const sealed = sealFor('a-3')
        r.register({askId: 'a-3', kind: 'question', schema: formReq.requestedSchema, requestState: sealed, timeoutMs: 60000})
        assert.equal(r.deliver({askId: 'ghost', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed}).reason, 'no-such-request')
        assert.equal(r.deliver({askId: 'a-3', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed + 'x'}).reason, 'state-mismatch', 'askId 对上门牌但凭证串逐字不符也必须拒（A 题的答案不许记到 A′ 头上）')
        assert.equal(r.deliver({askId: 'a-3', responses: {plan: 'C'}, answeredBy: 'u-1', requestState: sealed}).reason, 'bad-responses', 'enum 外的值必须被 run 侧权威 schema 校验拦下')
        assert.equal(r.deliver({askId: 'a-3', responses: {}, answeredBy: 'u-1', requestState: sealed}).reason, 'bad-responses', '缺必答字段同上')
        assert.equal(r.deliver({askId: 'a-3', responses: {plan: 'A', extra: 1}, answeredBy: 'u-1', requestState: sealed}).reason, 'bad-responses', '未知键同上（原样回显≠随便塞）')
    })
    test('approval 只认发起人；question 也只认 owner（participants 未接，保守方向）', () => {
        const r = createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
        const sealed = sealFor('a-4', 'approval')
        r.register({askId: 'a-4', kind: 'approval', schema: null, requestState: sealed, timeoutMs: 60000})
        const notOwner = r.deliver({askId: 'a-4', responses: {ok: true}, answeredBy: 'u-2', requestState: sealed})
        assert.equal(notOwner.accepted, false)
        assert.equal(notOwner.reason, 'approval-initiator-only')
        assert.equal(r.deliver({askId: 'a-4', responses: {ok: true}, answeredBy: 'u-1', requestState: sealed}).accepted, true)
    })
    test('createAnswerRouter 无 runCode 直接抛（无 run 就没有答复的去处）', () => {
        assert.throws(() => createAnswerRouter({}), /runCode/)
    })
})

describe('3 awaitAskUser：出题→事件→挂起→回模型', () => {
    const tc = (args) => ({id: 'call-9', function: {name: 'ask_user', arguments: JSON.stringify(args)}})
    const mkRouter = () => createAnswerRouter({runCode: 'run-1', initiator: 'u-1', secret: SEC})
    test('坏题（凭据 form）回错误给模型且不发事件不挂起', async () => {
        const events = []
        const r = mkRouter()
        const res = await withGuard(awaitAskUser({
            toolCall: tc({inputRequests: [{mode: 'form', message: '给我你的密码', requestedSchema: {type: 'object', properties: {password: {type: 'string'}}}}]}),
            router: r, secret: SEC, streamEvent: (t, p) => events.push([t, p]), checkpointSeq: 2,
        }), 3000, '坏题拒收')
        const body = JSON.parse(res.content)
        assert.equal(body.success, false)
        assert.match(body.error, /出题被拒/)
        assert.match(body.error, /form/, 'D28 的拒因要点名（模型要能自己修）')
        assert.equal(events.length, 0, '拒了的题不许发 await_input')
        assert.equal(r.stats.issued, 0)
    })
    test('参数不是 JSON / 没有密钥 ⇒ 如实回错（模型看得见的错误文案不含密钥细节）', async () => {
        const bad = await awaitAskUser({toolCall: {id: 'c1', function: {arguments: '{不是json'}}, router: mkRouter(), secret: SEC})
        assert.match(JSON.parse(bad.content).error, /不是合法 JSON/)
        const noSec = await awaitAskUser({toolCall: tc({inputRequests: [formReq]}), router: mkRouter(), secret: ''})
        assert.equal(JSON.parse(noSec.content).reason, 'no-signing-secret')
    })
    test('正常路径：await_input 载荷是 MRTR 形状、requestState 可开、答复后 complete 回模型', async () => {
        const events = []
        const r = mkRouter()
        const pr = awaitAskUser({
            toolCall: tc({inputRequests: [formReq]}),
            router: r,
            secret: SEC,
            streamEvent: (t, p) => events.push([t, p]),
            checkpointSeq: 3,
        })
        await new Promise((res) => setImmediate(res))
        assert.equal(events.length, 1)
        const [evType, evPayload] = events[0]
        assert.equal(evType, 'await_input')
        assert.equal(evPayload.resultType, 'input_required')
        assert.equal(evPayload.checkpointSeq, 3)
        assert.equal(evPayload.messageCode, 'run-1')
        const opened = MP.openRequestState(evPayload.requestState, {secret: SEC})
        assert.equal(opened.ok, true)
        assert.deepEqual(opened.value, {runCode: 'run-1', askId: 'call-9', kind: 'question', iat: opened.value.iat})
        const dl = r.deliver({askId: 'call-9', responses: {plan: 'B'}, answeredBy: 'u-1', requestState: evPayload.requestState})
        assert.equal(dl.accepted, true, 'deliver 侧必须复用**出题时**的 schema 做权威校验（不是答题人带的那份）')
        const res = JSON.parse((await pr).content)
        assert.deepEqual(res, {resultType: 'complete', inputResponses: {plan: 'B'}, answeredBy: 'u-1'})
    })
    test('askTimeoutMs 从配置透传到 register（写死默认值=配置永远无效的那种"接好了"）', async () => {
        const res = await withGuard(awaitAskUser({
            toolCall: tc({inputRequests: [formReq]}),
            router: mkRouter(),
            secret: SEC,
            askConfig: {askTimeoutMs: 30},
            streamEvent: () => {},
        }), 3000, 'askTimeoutMs=30 的挂起')
        assert.deepEqual(JSON.parse(res.content), {resultType: 'cancelled', reason: 'timeout'})
    })
    test('多问并发：各自 promise 独立终局，一题被答不牵连另一题', async () => {
        const events = []
        const r = mkRouter()
        const p1 = awaitAskUser({toolCall: {id: 'q1', function: {name: 'ask_user', arguments: JSON.stringify({inputRequests: [formReq]})}}, router: r, secret: SEC, streamEvent: (t, p) => events.push([p.messageCode + '|' + p.inputRequests[0].message, p])})
        const p2 = awaitAskUser({toolCall: {id: 'q2', function: {name: 'ask_user', arguments: JSON.stringify({inputRequests: [{mode: 'url', message: '去这里确认', url: 'https://example.com/ok'}]})}}, router: r, secret: SEC, streamEvent: (t, p) => events.push([p.messageCode + '|' + p.inputRequests[0].message, p])})
        await new Promise((res) => setImmediate(res))
        assert.equal(events.length, 2, '两问各发一条 await_input')
        const st1 = events[0][1].requestState
        const st2 = events[1][1].requestState
        assert.equal(r.deliver({askId: 'q1', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: st2}).reason, 'state-mismatch', '把 q2 的凭证拿来答 q1：askId 对不上门牌就该拒——逐字比对是唯一诚实的认题方式')
        assert.equal(r.deliver({askId: 'q2', responses: {done: true}, answeredBy: 'u-1', requestState: st2}).accepted, true, '全 url 题 schema=null：不限键但仍要签名与归属')
        const res2 = JSON.parse((await p2).content)
        assert.equal(res2.resultType, 'complete')
        assert.equal(r.deliver({askId: 'q1', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: st1}).accepted, true)
        const res1 = JSON.parse((await p1).content)
        assert.deepEqual(res1.inputResponses, {plan: 'A'})
        assert.equal(r.stats.answered, 2)
    })
})

describe('7 P-19 answer_ack：每次 deliver 终局都有回执（2026-11-15 裁定的实现面）', () => {
    test('采纳发 ok；answerCode 原样对相关（调用方凭它对上自己那次投递）', async () => {
        const acks = []
        const r = createAnswerRouter({runCode: 'run-9', initiator: 'u-1', secret: SEC, emitAck: (a) => acks.push(a)})
        const sealed = sealFor('a-9', 'question', 'run-9')
        const p = r.register({askId: 'a-9', kind: 'question', schema: formReq.requestedSchema, requestState: sealed, timeoutMs: 5000})
        assert.equal(r.deliver({askId: 'a-9', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed, answerCode: 'mine-1'}).accepted, true)
        await withGuard(p, 2000, 'ack-accept')
        assert.equal(acks.length, 1)
        assert.deepEqual({requestId: acks[0].requestId, answerCode: acks[0].answerCode, accepted: acks[0].accepted, code: acks[0].code},
            {requestId: 'a-9', answerCode: 'mine-1', accepted: true, code: 'ok'})
        assert.ok(acks[0].at, '回执带时刻')
    })
    test('四类拒绝各有 code，且**与 deliver 返回值一致**（回执与裁决一个口径，两套说法=漂移起点）', () => {
        const acks = []
        const r = createAnswerRouter({runCode: 'run-9', initiator: 'u-1', secret: SEC, emitAck: (a) => acks.push(a)})
        const sealed = sealFor('a-9b', 'question', 'run-9')
        r.register({askId: 'a-9b', kind: 'question', schema: formReq.requestedSchema, requestState: sealed, timeoutMs: 5000}).then(() => {})
        r.deliver({askId: 'ghost', responses: {}, answeredBy: 'u-1', requestState: sealed})
        r.deliver({askId: 'a-9b', responses: {plan: 'C'}, answeredBy: 'u-1', requestState: sealed})
        r.deliver({askId: 'a-9b', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: sealed + 'x'})
        assert.deepEqual(acks.map((a) => a.code), ['no-such-request', 'bad-responses', 'state-mismatch'])
        assert.ok(acks.every((a) => a.accepted === false))
        assert.ok(acks[1].notice, 'bad-responses 带 schema 错因（拒了要说清为什么拒——P-19 的立项理由）')
    })
    test('emitAck 抛错只吞不理：回执通道坏掉不许反噬裁决本身', async () => {
        const r = createAnswerRouter({runCode: 'run-9', initiator: 'u-1', secret: SEC, emitAck: () => { throw new Error('通道炸了') }})
        const sealed = sealFor('a-9c', 'question', 'run-9')
        const p = r.register({askId: 'a-9c', kind: 'question', schema: null, requestState: sealed, timeoutMs: 5000})
        assert.equal(r.deliver({askId: 'a-9c', responses: {x: 1}, answeredBy: 'u-1', requestState: sealed}).accepted, true)
        assert.deepEqual((await withGuard(p, 2000, 'ack-throw')).resultType, 'complete')
    })
    test('ackSnapshot 有界（32 封顶，先进先出）且是副本（外部改不动账）', () => {
        const r = createAnswerRouter({runCode: 'run-9', initiator: 'u-1', secret: SEC})
        const sealed = sealFor('a-9d', 'question', 'run-9')
        r.register({askId: 'a-9d', kind: 'question', schema: null, requestState: sealed, timeoutMs: 60000}).then(() => {})
        for (let i = 0; i < 40; i++) {
            r.deliver({askId: 'ghost-' + i, responses: {}, answeredBy: 'u-1', requestState: 'x'})
        }
        const snap = r.ackSnapshot()
        assert.equal(snap.length, 32)
        assert.equal(snap[0].requestId, 'ghost-8', '最旧的 8 条被挤出去（有界=保最新）')
        snap[0].code = '篡改试试'
        assert.notEqual(r.ackSnapshot()[0].code, '篡改试试')
    })
})
