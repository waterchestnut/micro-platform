/**
 * @fileOverview 任务事件日志的用例（纯件+假客户端真跑；M1-c 刀 1）
 * @module test/services/core/session/taskEventLog.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {taskEventKey, createTaskEventMirror, readTaskEventLog, waitTaskEventLog, TASK_EVENT_WAIT_MAX_MS, TASK_EVENT_KEY_PREFIX} from '../../../../services/core/session/taskEventLog.js'

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
        /** xread 族（刀 2）：形态照 ioredis 位置参数；BLOCK 超时回 null——假件把"挂 waitMs
         *  再回空窗"也演出来，判据才能钉住"钳位真实生效"而不是只钉返回值 */
        async xread(...args) {
            if (fail) throw new Error('redis down')
            let count = Infinity
            let blockMs = 0
            let cursor = '0-0'
            for (let i = 0; i < args.length; i++) {
                if (args[i] === 'COUNT') count = Number(args[++i])
                else if (args[i] === 'BLOCK') blockMs = Number(args[++i])
                else if (args[i] === 'STREAMS') { cursor = args[args.length - 1]; break }
            }
            const [cm, cn] = String(cursor).includes('-') ? String(cursor).split('-').map(Number) : [Number(cursor) || 0, -1]
            const list = entries.filter((e) => {
                const [mms, mn] = e.id.split('-').map(Number)
                return mms > cm || (mms === cm && mn > cn)
            }).slice(0, count)
            if (!list.length) {
                if (blockMs > 0) await new Promise((r) => setTimeout(r, Math.min(blockMs, 20))) // 演示挂起，实等封顶 20ms
                return null // 服务端 BLOCK 超时的 nil
            }
            return [['fake:key', list.map((e) => [e.id, ['type', e.type, 'data', e.data]])]]
        },
        /** xread 调用账（判据用：block 值是否被钳位、非阻塞形态有没有真发出去） */
        xreadCalls: [],
    }
    const realXread = client.xread
    client.xread = async (...a) => { client.xreadCalls.push(a); return realXread.apply(client, a) }
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

describe('waitTaskEventLog 阻塞读（刀 2 地基，只许跑专用连接）', () => {
    test('游标后有事件立刻回 ok；响应形与回放面同契约（events/end/reason 三件套）', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'task_queued'})
        const first = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: ''})
        assert.equal(first.reason, 'ok')
        assert.equal(first.events.length, 1)
        await m.emit({type: 'subtask_spawned', data: 1})
        const second = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: first.events[0].id})
        assert.equal(second.reason, 'ok')
        assert.equal(second.events.length, 1, '游标 exclusive：旧帧不许重放')
        assert.equal(second.events[0].type, 'subtask_spawned')
    })
    test('空窗 BLOCK 超时 ⇒ reason=timeout（客户端带原游标重试的凭据）', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'task_queued'})
        const one = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: ''})
        const r = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: one.events[0].id, waitMs: 100})
        assert.equal(r.reason, 'timeout')
        assert.deepEqual(r.events, [])
        assert.equal(r.end, null)
    })
    test('坏游标挡在门口 bad-cursor（打进 XREAD 只会换来协议错误——在门口点名便宜）', async () => {
        const c = makeFakeRedis()
        const r = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: "1-0'; xadd evil 1 a b"})
        assert.equal(r.reason, 'bad-cursor')
        assert.equal(c.xreadCalls.length, 0, '挡在门口=根本没发到 redis')
        const ok0 = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: '0'})
        assert.notEqual(ok0.reason, 'bad-cursor', "'0' 是合法游标（从头）")
    })
    test('waitMs 钳位 [0,5000]：60000 的挂起不许打到 redis（Traefik/连接两头都挡死）', async () => {
        const c = makeFakeRedis()
        await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', waitMs: 60000})
        const blkIdx = c.xreadCalls[c.xreadCalls.length - 1].indexOf('BLOCK')
        assert.equal(c.xreadCalls[c.xreadCalls.length - 1][blkIdx + 1], TASK_EVENT_WAIT_MAX_MS)
        await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', waitMs: -5})
        assert.equal(c.xreadCalls[c.xreadCalls.length - 1].indexOf('BLOCK'), -1, '0/负数=非阻塞形态：不带 BLOCK 参数')
    })
    test('段界与回放同口径：__end__ 收口、下一段条目不混进本响应（单源解析不许两样）', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m.emit({type: 'arbitration'})
        await m.finish({outcome: 'done'})
        await m.emit({type: 'task_started'}) // finished 后丢弃——用第二个镜像演下一段
        const m2 = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        await m2.emit({type: 'subtask_spawned'})
        const r = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: ''})
        assert.equal(r.end?.outcome, 'done')
        assert.deepEqual(r.events.map((e) => e.type), ['arbitration'], '段界即终点')
    })
    test('no-client / unreadable 与回放面同词（订阅端一个 reason 表两用）', async () => {
        assert.equal((await waitTaskEventLog({getClient: async () => null, rootCode: 'r1'})).reason, 'no-client')
        assert.equal((await waitTaskEventLog({getClient: async () => makeFakeRedis({fail: true}), rootCode: 'r1'})).reason, 'unreadable')
        const thrower = async () => { throw new Error('conn refused') }
        assert.equal((await waitTaskEventLog({getClient: thrower, rootCode: 'r1'})).reason, 'no-client', '建连抛也是 no-client——降级不许变 500')
    })
    test('count 生效且 >=1（单次洪峰截断，客户端续游标自取下一批）', async () => {
        const c = makeFakeRedis()
        const m = createTaskEventMirror({getClient: async () => c, rootCode: 'r1'})
        for (let i = 0; i < 5; i++) await m.emit({type: 'subtask_done', i})
        const r = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: '', count: 2})
        assert.equal(r.events.length, 2)
        const r0 = await waitTaskEventLog({getClient: async () => c, rootCode: 'r1', afterId: '', count: 0})
        assert.ok(r0.events.length >= 1, 'count=0 钳到 1——不许发个恒空的订阅')
    })
})
