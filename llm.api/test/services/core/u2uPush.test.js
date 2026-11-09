import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {u2uPushTargets, buildU2uEvent, fanoutU2uEvent, U2U_CHANNEL_PREFIX} from '../../../services/core/u2uPush.js'

/**
 * u2u 扇出的约束。
 * 这块逻辑的价值全在"发几个人、每人看到什么、失败算谁的"，
 * 而这三件事在没有推送的年代从来没被执行过，所以每条都要钉住。
 */

describe('u2uPushTargets：推给谁', () => {
    test('排除操作者本人', () => {
        assert.deepEqual(u2uPushTargets(['a', 'b'], 'a'), ['b'])
    })

    test('群聊（多成员）推给除自己外的全部成员', () => {
        assert.deepEqual(u2uPushTargets(['a', 'b', 'c'], 'a').sort(), ['b', 'c'])
    })

    test('去重与去空：脏 userCodes 不该变成重复推送', () => {
        assert.deepEqual(u2uPushTargets(['b', 'b', '', null, 'a'], 'a'), ['b'])
    })

    test('单人会话或只有自己有号时不推任何人', () => {
        assert.deepEqual(u2uPushTargets(['a'], 'a'), [])
        assert.deepEqual(u2uPushTargets([], 'a'), [])
        assert.deepEqual(u2uPushTargets(undefined, 'a'), [])
    })
})

describe('buildU2uEvent：订阅端要能按 conversationCode 过滤', () => {
    test('必须带 conversationCode 与 event（路由靠这两个字段分派与过滤）', () => {
        const e = buildU2uEvent('conv-1', 'message', {content: 'hi'})
        assert.deepEqual({event: e.event, conversationCode: e.conversationCode, data: e.data},
            {event: 'message', conversationCode: 'conv-1', data: {content: 'hi'}})
        assert.ok(!Number.isNaN(Date.parse(e.timestamp)), 'timestamp 必须是可解析的时间')
    })
})

describe('fanoutU2uEvent：按人各发一份，且绝不抛错', () => {
    /**
     * 这条是最容易被写错的：`fromMe` 是"按人算"的字段，
     * 若只发一份公共 payload，群聊里就会出现"谁的话都标成对方说的"（前端靠它决定气泡左右）。
     */
    test('每个接收人拿到自己的 payload', async () => {
        const sent = []
        const ret = await fanoutU2uEvent({
            publish: async (channel, message) => {
                sent.push({channel, payload: JSON.parse(message)})
                return 1
            },
            targets: ['b', 'c'],
            dataFor: (userCode) => ({content: 'hi', fromMe: userCode === 'a'}),
            conversationCode: 'conv-1',
            event: 'message',
        })
        assert.equal(ret.attempted, 2)
        assert.equal(ret.succeeded, 2)
        assert.deepEqual(sent.map(s => s.channel), [`${U2U_CHANNEL_PREFIX}b`, `${U2U_CHANNEL_PREFIX}c`])
        /** 频道名必须与 routes/core/chat/u2u.js 的订阅端一致，否则就是发了没人收 */
        assert.deepEqual(sent.map(s => s.payload.event), ['message', 'message'])
        assert.deepEqual(sent.map(s => s.payload.conversationCode), ['conv-1', 'conv-1'])
    })

    /** 消息此刻已经落库：通知没送到，不能把"发出去了"报成"发送失败" */
    test('publish 抛错时只计数、不抛出，并留下可查的原因', async () => {
        const warns = []
        const ret = await fanoutU2uEvent({
            publish: async (channel) => {
                if (channel.endsWith('c')) {
                    throw new Error('redis down')
                }
                return 1
            },
            targets: ['b', 'c'],
            dataFor: () => ({}),
            conversationCode: 'conv-1',
            event: 'message',
            log: {warn: (m) => warns.push(m)},
        })
        assert.deepEqual({attempted: ret.attempted, succeeded: ret.succeeded, failed: ret.failed},
            {attempted: 2, succeeded: 1, failed: 1})
        assert.match(ret.reasons[0], /^c:redis down$/, '原因要带工号，否则不知道谁没收到')
        assert.equal(warns.length, 1)
    })

    /** 一个目标失败不该拖累其他目标（旧实现用 Promise.all，一个 reject 会让整批状态不明） */
    test('第一个目标失败，第二个仍然送达', async () => {
        const got = []
        await fanoutU2uEvent({
            publish: async (channel) => {
                if (channel.endsWith('b')) {
                    throw new Error('boom')
                }
                got.push(channel)
            },
            targets: ['b', 'c'],
            dataFor: () => ({}),
            conversationCode: 'conv-1',
            event: 'read',
        })
        assert.deepEqual(got, [`${U2U_CHANNEL_PREFIX}c`])
    })

    test('没有目标或没注入 publish 时静默返回 0，不报错', async () => {
        assert.deepEqual(await fanoutU2uEvent({publish: async () => 1, targets: [], dataFor: () => ({}), conversationCode: 'c', event: 'message'}),
            {attempted: 0, succeeded: 0, failed: 0, reasons: []})
        assert.deepEqual(await fanoutU2uEvent({publish: undefined, targets: ['b'], dataFor: () => ({}), conversationCode: 'c', event: 'message'}),
            {attempted: 0, succeeded: 0, failed: 0, reasons: []})
    })

    test('payload 是 JSON 字符串（订阅端 JSON.parse 才能过滤 conversationCode）', async () => {
        let raw = ''
        await fanoutU2uEvent({
            publish: async (channel, message) => {
                raw = message
            },
            targets: ['b'],
            dataFor: () => ({upToTime: '2026-11-09T00:00:00.000Z'}),
            conversationCode: 'conv-9',
            event: 'read',
        })
        assert.equal(typeof raw, 'string')
        assert.equal(JSON.parse(raw).event, 'read')
    })
})
