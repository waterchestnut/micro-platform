/**
 * @fileOverview run 控制通道（PR-D 装配地基）的用例
 * @module test/services/core/session/runControl
 * @description
 * 纯判据 + 假 redis 走真函数体（连接工厂注入，同 makeIntakeRunner 家规）。重点钉：
 * ①通道名的字符集闸（把任意串拼进 pubsub 频道名 = 给投递面开注入通道）；
 * ②坏消息弃收不炸订阅（一条烂 JSON 不该让本 worker 从此收不到 stop）；
 * ③"不归我"是常态不是错误（多副本各自查表）；④订阅单例幂等、失败可重试；
 * ⑤take **不清除**（重复 stop 应持续可用，幂等靠 controller.abort 本身）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/runControl.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const RC = await import(pathToFileURL(path.join(SRC, 'services/core/session/runControl.js')).href)
const {stopChannel, buildStopMessage, parseStopMessage, createStopDispatcher, attachHandle, detachHandle, takeHandle, controlSnapshot, resetHandlesForTest, publishStop, ensureRunControlSubscriber, resetRunControlForTest, STOP_CHANNEL_PREFIX} = RC

describe('1 通道与消息契约', () => {
    test('合法 messageCode 进通道；字符集外的拒（不许把任意串拼进 pubsub 频道名）', () => {
        assert.equal(stopChannel('m-7_1:x.2'), `${STOP_CHANNEL_PREFIX}m-7_1:x.2`)
        for (const bad of ['', 'has space', 'spa*ne', 'a'.repeat(129), '中文', 'x\r\nY']) {
            assert.throws(() => stopChannel(bad), /字符集|长度/, `该拒: ${JSON.stringify(bad)}`)
        }
    })
    test('build→parse 往返；缺字段/错版本/坏 JSON ⇒ ok:false（不抛）', () => {
        const raw = buildStopMessage({messageCode: 'm-1', actorCode: 'u-9', now: 555})
        const p = parseStopMessage(raw)
        assert.equal(p.ok, true)
        assert.deepEqual(p.value, {messageCode: 'm-1', actorCode: 'u-9', ts: 555})
        assert.equal(parseStopMessage('not json').ok, false)
        assert.equal(parseStopMessage(JSON.stringify({v: 2, type: 'stop', messageCode: 'm'})).ok, false, '协议版本必须精确')
        assert.equal(parseStopMessage(JSON.stringify({v: 1, type: 'steer', messageCode: 'm'})).ok, false)
        assert.equal(parseStopMessage(JSON.stringify({v: 1, type: 'stop', messageCode: 'in valid!'})).ok, false)
    })
})

describe('2 dispatcher 状态机', () => {
    test('四条出边各有其名：bad-message / not-my-run / delivered / abort-threw', () => {
        const logs = {warn: [], info: [], error: []}
        const logger = {warn: (m) => logs.warn.push(m), info: (m) => logs.info.push(m), error: (m) => logs.error.push(m)}
        let hit = 0
        const d = createStopDispatcher({takeAbort: (mc) => (mc === 'mine' ? () => { hit++ } : null), logger})
        assert.equal(d('junk').reason, 'bad-message')
        assert.equal(logs.warn.length, 1)
        assert.equal(d(buildStopMessage({messageCode: 'other'})).reason, 'not-my-run')
        assert.equal(d(buildStopMessage({messageCode: 'mine'})).reason, 'delivered')
        assert.equal(hit, 1)
        const boom = createStopDispatcher({takeAbort: () => { throw new Error('abort 炸了') }, logger})
        assert.equal(boom(buildStopMessage({messageCode: 'm'})).reason, 'abort-threw')
        assert.equal(logs.error.length, 1)
        assert.equal(logs.info.length, 1, '"不归我"只配 info：多副本里这是常态，warn 会淹没真问题')
        // takeAbort 缺席（装配漏线）必须优雅降级为"不归我"——事件回调里裸调会把配置错误升级成进程异常
        const bare = createStopDispatcher({logger})
        assert.equal(bare(buildStopMessage({messageCode: 'm'})).reason, 'not-my-run')
    })
})

describe('3 把手表（与并发闸解耦的独立生命周期）', () => {
    test('attach→take→(仍在)→detach→take null；重复 stop 持续可用；take 不消费', () => {
        resetHandlesForTest()
        let n = 0
        assert.equal(attachHandle({messageCode: 'm-1', abort: () => n++}), true)
        assert.equal(controlSnapshot().handles, 1)
        takeHandle('m-1')()
        takeHandle('m-1')()
        assert.equal(n, 2, 'take 不清除：重复 stop 信号仍应打得断（幂等由 controller 本身保证）')
        assert.equal(detachHandle('m-1'), true)
        assert.equal(detachHandle('m-1'), false, '二次 detach 如实报 false，不装成功')
        assert.equal(takeHandle('m-1'), null)
        assert.equal(controlSnapshot().handles, 0)
    })
    test('脏 attach 全拒（无号/非函数 abort），不污染表', () => {
        resetHandlesForTest()
        assert.equal(attachHandle({messageCode: '', abort: () => {}}), false)
        assert.equal(attachHandle({messageCode: 'm', abort: 'nope'}), false)
        assert.equal(attachHandle({}), false)
        assert.equal(controlSnapshot().handles, 0)
    })
    test('同 messageCode 重复 attach ⇒ 后挂覆盖前挂（重发 run 的把手就该是新的）', () => {
        resetHandlesForTest()
        const calls = []
        attachHandle({messageCode: 'm', abort: () => calls.push('old')})
        attachHandle({messageCode: 'm', abort: () => calls.push('new')})
        takeHandle('m')()
        assert.deepEqual(calls, ['new'])
        assert.equal(controlSnapshot().handles, 1)
    })
})

describe('4 传输层（假 redis 走真实现）', () => {
    test('publishStop：频道与消息体正确；失败返回 error 不抛', async () => {
        const sent = []
        const redisFactory = async () => ({publish: async (ch, msg) => { sent.push([ch, msg]) }})
        assert.deepEqual(await publishStop({messageCode: 'm-9', actorCode: 'u-1', redisFactory}), {published: true})
        assert.equal(sent[0][0], `${STOP_CHANNEL_PREFIX}m-9`)
        assert.equal(parseStopMessage(sent[0][1]).value.actorCode, 'u-1')
        const bad = await publishStop({messageCode: 'm-9', redisFactory: async () => { throw new Error('redis down') }})
        assert.equal(bad.published, false)
        assert.match(bad.error, /redis down/)
    })
    test('订阅：单例幂等、pmessage 打通到 abort、失败置回可重试', async () => {
        resetRunControlForTest()
        resetHandlesForTest()
        let handler = null
        let subs = 0
        const mkFactory = () => async () => ({
            duplicate: () => {
                subs++
                return {psubscribe: async (pat) => { assert.equal(pat, `${RC.CTL_FAMILY_PREFIX}*`, '单连接吃整个控制族：按类型分订阅=连接数的慢性泄漏') }, on: (ev, fn) => { if (ev === 'pmessage') handler = fn }}
            },
        })
        attachHandle({messageCode: 'live', abort: () => { throw new Error('sentinel-abort') }})
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, logger: {warn() {}, info() {}, error() {}}, redisFactory: mkFactory()}), 'ready')
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, redisFactory: mkFactory()}), 'already')
        assert.equal(subs, 1, '单例：第二次 ensure 不许再 duplicate 一条连接')
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, redisFactory: async () => { throw new Error('no redis') }}), 'already', '已就绪后失败工厂也不重置状态')
        let thrown = ''
        handler('p', 'c', buildStopMessage({messageCode: 'live'}))
        assert.match((() => { try { takeHandle('live')() } catch (e) { return e.message } return '' })(), /sentinel/, '把手还活着（detach 只发生在 run finally）')
        resetRunControlForTest()
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, logger: {warn() {}}, redisFactory: async () => { throw new Error('boom') }}), 'unavailable')
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, redisFactory: mkFactory()}), 'ready', '失败后可重试——订阅失败不该永久废掉本 worker 的 stop')
        void thrown
        resetRunControlForTest()
        resetHandlesForTest()
    })
})

describe('5 steer 通道族（commit 2 泛化：一条连接、type 分派）', () => {
    test('steerChannel 与 stopChannel 同族不同段；同一把字符集闸', () => {
        assert.equal(RC.steerChannel('m-1'), `${RC.STEER_CHANNEL_PREFIX}m-1`)
        assert.ok(RC.steerChannel('m-1').startsWith(RC.CTL_FAMILY_PREFIX))
        assert.throws(() => RC.steerChannel('bad channel*'), /字符集|长度/)
    })
    test('buildControlMessage：payload 往返；未知 type 直接抛（造消息侧不吞配置错误）', () => {
        const steer = {steerCode: 's-1', text: '换成表格', mode: 'soft', userCode: 'u-1', realName: '李', ts: 777}
        const raw = RC.buildControlMessage({type: 'steer', messageCode: 'm-2', actorCode: 'u-1', payload: steer, now: 888})
        const p = RC.parseControlMessage(raw)
        assert.equal(p.ok, true)
        assert.equal(p.value.type, 'steer')
        assert.deepEqual(p.value.payload, steer)
        assert.throws(() => RC.buildControlMessage({type: 'nonsense', messageCode: 'm'}), /type/, '未知 type 照抛——answer 在 commit 3 转正了，示例要跟着换（这条断言防的是"造消息侧吞配置错误"）')
        /** 兼容封装不许漏：stop 解析器见 steer 必须 ok:false（旧接线不能被新类型放行） */
        assert.equal(RC.parseStopMessage(raw).ok, false)
    })
    test('dispatcher steer 分支：有口即投（accept/reject 都算投递）、无口不归我、抛错有专边', () => {
        const logs = {warn: [], info: [], error: []}
        const logger = {warn: (m) => logs.warn.push(m), info: (m) => logs.info.push(m), error: (m) => logs.error.push(m)}
        const box = {push: (p) => (p && p.text ? {accepted: true, depth: 1} : {accepted: false, error: 'text 空'})}
        const d = RC.createControlDispatcher({takeSteerHandle: (mc) => (mc === 'mine' ? box.push.bind(box) : null), logger})
        const ok = d(RC.buildControlMessage({type: 'steer', messageCode: 'mine', payload: {text: 'hi'}}))
        assert.equal(ok.handled, true)
        assert.equal(ok.reason, 'delivered')
        assert.equal(ok.accepted, true)
        const rej = d(RC.buildControlMessage({type: 'steer', messageCode: 'mine', payload: {}}))
        assert.equal(rej.handled, true, '邮箱拒收是业务裁决，通道照记"已投递"')
        assert.equal(rej.accepted, false)
        assert.equal(rej.rejectError, 'text 空')
        assert.equal(d(RC.buildControlMessage({type: 'steer', messageCode: 'other'})).reason, 'not-my-run')
        const bare = RC.createControlDispatcher({logger})
        assert.equal(bare(RC.buildControlMessage({type: 'steer', messageCode: 'm'})).reason, 'not-my-run', 'takeSteerHandle 缺席⇒优雅降级（C3 同款纪律）')
        const boom = RC.createControlDispatcher({
            takeSteerHandle: () => { throw new Error('push 炸了') },
            takeAbort: () => { throw new Error('abort 炸了') },
            logger,
        })
        assert.equal(boom(RC.buildControlMessage({type: 'steer', messageCode: 'm'})).reason, 'push-threw')
        assert.equal(boom(RC.buildControlMessage({type: 'stop', messageCode: 'm'})).reason, 'abort-threw', '两条分支的抛错边各留各的名')
    })
    test('onSteer 挂点独立：没挂的 takeSteerHandle=null；快照分得清两种把手', () => {
        resetHandlesForTest()
        attachHandle({messageCode: 'both', abort: () => {}, onSteer: () => ({accepted: true})})
        attachHandle({messageCode: 'stop-only', abort: () => {}})
        assert.equal(typeof takeHandle('both'), 'function')
        assert.equal(typeof RC.takeSteerHandle('both'), 'function')
        assert.equal(RC.takeSteerHandle('stop-only'), null, 'steer 未启用的 run 上 steer 消息⇒not-my-run，不是错')
        assert.equal(RC.takeSteerHandle('ghost'), null)
        assert.deepEqual(RC.controlSnapshot(), {handles: 2, steerHandles: 1, answerHandles: 0})
        resetHandlesForTest()
    })
    test('publishSteer：频道/类型/payload 三对；失败回 error 不抛', async () => {
        const sent = []
        const redisFactory = async () => ({publish: async (ch, msg) => { sent.push([ch, msg]) }})
        const steer = {text: '轻一点', mode: 'soft', userCode: 'u-2'}
        assert.deepEqual(await RC.publishSteer({messageCode: 'm-3', actorCode: 'u-2', steer, redisFactory}), {published: true})
        assert.equal(sent[0][0], `${RC.STEER_CHANNEL_PREFIX}m-3`)
        const p = RC.parseControlMessage(sent[0][1])
        assert.equal(p.value.type, 'steer')
        assert.deepEqual(p.value.payload, steer)
        const bad = await RC.publishSteer({messageCode: 'm-3', steer, redisFactory: async () => { throw new Error('redis down') }})
        assert.equal(bad.published, false)
        assert.match(bad.error, /redis down/)
    })
    test('pmessage 全链：一条订阅连接同时送达 stop 与 steer（族订阅不是两张皮）', async () => {
        resetRunControlForTest()
        resetHandlesForTest()
        let handler = null
        const redisFactory = async () => ({duplicate: () => ({psubscribe: async () => {}, on: (ev, fn) => { if (ev === 'pmessage') handler = fn }})})
        const pushed = []
        attachHandle({messageCode: 'live', abort: () => {}, onSteer: (p) => { pushed.push(p); return {accepted: true} }})
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, takeSteerHandle: RC.takeSteerHandle, logger: {warn() {}, info() {}, error() {}}, redisFactory}), 'ready')
        handler('p', 'c', RC.buildControlMessage({type: 'steer', messageCode: 'live', payload: {text: 'x', userCode: 'u'}}))
        handler('p', 'c', RC.buildControlMessage({type: 'stop', messageCode: 'live'}))
        assert.equal(pushed.length, 1, 'steer 经同一连接进同一邮箱口')
        resetRunControlForTest()
        resetHandlesForTest()
    })
})

describe('6 answer 通道（commit 3：/answer 经控制族投给 run 侧 router）', () => {
    test('answerChannel 同族同闸；parse 带 payload；stop 解析器继续拒 answer', () => {
        assert.equal(RC.answerChannel('m-1'), `${RC.ANSWER_CHANNEL_PREFIX}m-1`)
        assert.throws(() => RC.answerChannel('bad id'), /字符集|长度/)
        const raw = RC.buildControlMessage({type: 'answer', messageCode: 'm-2', actorCode: 'u-9', payload: {askId: 'a-1', responses: {plan: 'A'}, answeredBy: 'u-9', requestState: 'blob'}})
        const p = RC.parseControlMessage(raw)
        assert.equal(p.ok, true)
        assert.equal(p.value.type, 'answer')
        assert.deepEqual(p.value.payload, {askId: 'a-1', responses: {plan: 'A'}, answeredBy: 'u-9', requestState: 'blob'})
        assert.equal(RC.parseStopMessage(raw).ok, false)
    })
    test('dispatcher answer 分支：sink 三出边 + reason 透传（steer/answer 同构但各自入口）', () => {
        const logger = {warn() {}, info() {}, error() {}}
        const sink = {calls: [], ret: {accepted: true}}
        const d = RC.createControlDispatcher({takeAnswerHandle: (mc) => (mc === 'mine' ? (p) => { sink.calls.push(p); return sink.ret } : null), logger})
        const msg = (pl) => RC.buildControlMessage({type: 'answer', messageCode: 'mine', payload: pl})
        assert.deepEqual(d(msg({askId: 'a'})), {handled: true, reason: 'delivered', accepted: true, rejectError: undefined})
        sink.ret = {accepted: false, reason: 'already-answered'}
        const late = d(msg({askId: 'a'}))
        assert.equal(late.handled, true, 'router 拒绝（迟到/错配）是业务裁决，通道照记已投递')
        assert.equal(late.accepted, false)
        assert.equal(late.rejectError, 'already-answered', '拒绝原因要能顺着通道看见（payload.error || payload.reason 都收）')
        assert.equal(sink.calls.length, 2)
        const steerOnly = RC.createControlDispatcher({takeSteerHandle: () => () => ({accepted: true}), logger})
        assert.equal(steerOnly(msg({askId: 'a'})).reason, 'not-my-run', 'answer 不许从 steer 口漏进')
        const bare = RC.createControlDispatcher({logger})
        assert.equal(bare(msg({askId: 'a'})).reason, 'not-my-run', 'takeAnswerHandle 缺席⇒优雅降级（C3 家规第 N 次执行）')
    })
    test('onAnswer 挂点独立 + 快照三分（stop/steer/answer 各数各的）', () => {
        resetHandlesForTest()
        attachHandle({messageCode: 'full', abort: () => {}, onSteer: () => ({}), onAnswer: () => ({accepted: true})})
        attachHandle({messageCode: 'stop-only', abort: () => {}})
        assert.equal(typeof RC.takeAnswerHandle('full'), 'function')
        assert.equal(RC.takeAnswerHandle('stop-only'), null)
        assert.deepEqual(RC.controlSnapshot(), {handles: 2, steerHandles: 1, answerHandles: 1})
        resetHandlesForTest()
    })
    test('publishAnswer：频道与消息体；失败回 error 不抛', async () => {
        const sent = []
        const redisFactory = async () => ({publish: async (ch, msg) => { sent.push([ch, msg]) }})
        const answer = {askId: 'a-9', responses: {plan: 'A'}, answeredBy: 'u-1', requestState: 'blob'}
        assert.deepEqual(await RC.publishAnswer({messageCode: 'm-9', actorCode: 'u-1', answer, redisFactory}), {published: true})
        assert.equal(sent[0][0], `${RC.ANSWER_CHANNEL_PREFIX}m-9`)
        assert.deepEqual(RC.parseControlMessage(sent[0][1]).value.payload, answer)
        const bad = await RC.publishAnswer({messageCode: 'm-9', answer, redisFactory: async () => { throw new Error('redis down') }})
        assert.equal(bad.published, false)
        assert.match(bad.error, /redis down/)
    })
    test('三类型全链：单连接按 type 分流到各自把手（stop/steer/answer 互不串门）', async () => {
        resetRunControlForTest()
        resetHandlesForTest()
        let handler = null
        const redisFactory = async () => ({duplicate: () => ({psubscribe: async () => {}, on: (ev, fn) => { if (ev === 'pmessage') handler = fn }})})
        const hits = {abort: 0, steer: 0, answer: 0}
        attachHandle({
            messageCode: 'live',
            abort: () => { hits.abort++ },
            onSteer: () => { hits.steer++; return {accepted: true} },
            onAnswer: () => { hits.answer++; return {accepted: true} },
        })
        assert.equal(await ensureRunControlSubscriber({takeAbort: takeHandle, takeSteerHandle: RC.takeSteerHandle, takeAnswerHandle: RC.takeAnswerHandle, logger: {warn() {}, info() {}, error() {}}, redisFactory}), 'ready')
        handler('p', 'c', RC.buildControlMessage({type: 'steer', messageCode: 'live', payload: {text: 'x', userCode: 'u'}}))
        handler('p', 'c', RC.buildControlMessage({type: 'answer', messageCode: 'live', payload: {askId: 'a', responses: {}, answeredBy: 'u', requestState: 's'}}))
        handler('p', 'c', RC.buildControlMessage({type: 'stop', messageCode: 'live'}))
        assert.deepEqual(hits, {abort: 1, steer: 1, answer: 1})
        resetRunControlForTest()
        resetHandlesForTest()
    })
})
