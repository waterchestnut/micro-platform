/**
 * @fileOverview 任务事件日志的用例（纯件+假客户端真跑；M1-c 刀 1）
 * @module test/services/core/session/taskEventLog.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {taskEventKey, createTaskEventMirror, readTaskEventLog, TASK_EVENT_KEY_PREFIX} from '../../../../services/core/session/taskEventLog.js'

/** 假 redis：只实现 xadd/pipeline/expire/xrange，语义照 ioredis（stream id ms-n 递增） */
function makeFakeRedis({fail = false} = {}) {
    const entries = []
    let n = 0
    let ms = 1000
    const client = {
        entries,
        pipeline() {
            const cmds = []
            const p = {
                xadd: (...a) => { cmds.push(a); return p },
                expire: () => p,
                async exec() {
                    if (fail) throw new Error('redis down')
                    const out = []
                    for (const a of cmds) {
                        const args = a.slice(1) // 去掉 'xadd'
                        const starAt = args.indexOf('*')
                        const fields = args.slice(starAt + 1)
                        const o = {}
                        for (let i = 0; i < fields.length; i += 2) o[fields[i]] = fields[i + 1]
                        const id = `${ms}-${n++}`
                        ms += 0 // 同毫秒多条目靠 -n 递增（与真 redis 同形）
                        entries.push({id, ...o})
                        out.push(id)
                    }
                    return out
                },
            }
            return p
        },
        async xrange(key, start, end, ...rest) {
            if (fail) throw new Error('redis down')
            let list = entries
            if (start && start !== '-') {
                const after = start.slice(1)
                const [ams, an] = after.split('-').map(Number)
                list = list.filter((e) => {
                    const [mms, mn] = e.id.split('-').map(Number)
                    return mms > ams || (mms === ams && mn > an)
                })
            }
            const count = rest[1]
            if (Number.isFinite(count)) list = list.slice(0, count)
            return list.map((e) => [e.id, ['type', e.type, 'data', e.data]])
        },
    }
    return client
}

describe('taskEventKey', () => {
    test('前缀与 root 拼键（族对齐 llmrun:events，命名空间互不串台）', () => {
        assert.equal(taskEventKey('r1'), `${TASK_EVENT_KEY_PREFIX}:r1`)
        assert.equal(taskEventKey('r1', 'x:y'), 'x:y:r1')
    })
})

describe('createTaskEventMirror 写侧', () => {
    test('缺 rootCode 直接抛（没归属的事件流不许存在）', () => {
        assert.throws(() => createTaskEventMirror({getClient: async () => ({}), rootCode: ''}), /rootCode/)
    })
    test('emit 写 type/data；finish 写 __end__ 后 emit 丢弃并计数', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'task_queued', rootCode: 'r1', queuePosition: 1})
        const r = await m.finish({outcome: 'synthesize'})
        assert.equal(r.segmentClosed, true)
        await m.emit({type: 'subtask_done', rootCode: 'r1', agentCode: 'a'})
        assert.equal(m.stats().droppedAfterFinish, 1, '段界之后的追加必须丢弃（"结束后还在写"的键不许存在）')
        assert.equal(c.entries.length, 2)
        assert.equal(c.entries[0].type, 'task_queued')
        assert.deepEqual(JSON.parse(c.entries[0].data), {rootCode: 'r1', queuePosition: 1})
        assert.equal(c.entries[1].type, '__end__')
        assert.equal(c.entries[1].data, 'synthesize')
    })
    test('fail-open：redis 抛 ⇒ 只计数不 throw（事件是加法，不许变成编排的新故障源）', async () => {
        const c = makeFakeRedis({fail: true})
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        const ok = await m.emit({type: 'task_queued', rootCode: 'r1'})
        assert.equal(ok, false)
        assert.equal(m.stats().failed, 1)
        assert.equal(m.stats().written, 0)
    })
    test('getClient 返回 null ⇒ 静默降级计数', async () => {
        const m = createTaskEventMirror({getClient: async () => null, rootCode: 'r1'})
        assert.equal(await m.emit({type: 'task_queued', rootCode: 'r1'}), false)
        assert.equal(m.stats().failed, 1)
    })
    test('无 type 的事件不收（不造没名字的帧）', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        assert.equal(await m.emit({payload: 1}), false)
        assert.equal(c.entries.length, 0)
    })
})

describe('readTaskEventLog 回放', () => {
    test('从头读到段界为止；__end__ 后条目属于下一段，本响应不带', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'task_queued', rootCode: 'r1', queuePosition: 1})
        await m.emit({type: 'subtask_spawned', rootCode: 'r1', subtasks: [{agentCode: 'a', title: '甲'}]})
        await m.finish({outcome: 'await-input'})
        await m.emit({type: 'task_queued', rootCode: 'r1'}) // 被丢弃
        const r = await readTaskEventLog({getClient: async () => c, rootCode: 'r1'})
        assert.equal(r.reason, 'ok')
        assert.equal(r.events.length, 2)
        assert.equal(r.events[0].payload.queuePosition, 1)
        assert.deepEqual(r.end, {id: c.entries[2].id, outcome: 'await-input'})
    })
    test('游标增量：afterId 之后只回新条目', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'task_queued', rootCode: 'r1'})
        const first = await readTaskEventLog({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'subtask_done', rootCode: 'r1', agentCode: 'a', usable: true})
        const second = await readTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: first.events[0].id})
        assert.equal(second.events.length, 1)
        assert.equal(second.events[0].type, 'subtask_done')
    })
    test('空窗/坏客户端各归各的 reason（missing 与 unreadable 是两句真话）', async () => {
        const empty = await readTaskEventLog({getClient: async () => makeFakeRedis(), rootCode: 'r1'})
        assert.equal(empty.reason, 'empty')
        const bad = await readTaskEventLog({getClient: async () => makeFakeRedis({fail: true}), rootCode: 'r1'})
        assert.equal(bad.reason, 'unreadable')
        const none = await readTaskEventLog({getClient: async () => null, rootCode: 'r1'})
        assert.equal(none.reason, 'no-client')
    })
    test('data 不是 JSON 也不炸（raw 兜住——镜像丢帧物理可能，读侧不许假设写侧完美）', async () => {
        const c = makeFakeRedis()
        c.entries.push({id: '9-0', type: 'weird', data: 'not-json'})
        const r = await readTaskEventLog({getClient: async () => c, rootCode: 'r1'})
        assert.deepEqual(r.events[0].payload, {raw: 'not-json'})
    })
})
