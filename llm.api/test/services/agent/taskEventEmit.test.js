/**
 * @fileOverview 任务事件发射助手的用例（词表封闭集+flag 门+真跑发射形状；M1-c 刀 1）
 * @module test/services/agent/taskEventEmit.test
 * @description
 * 开 flag 的发射路径**真跑**（recoverCandidate 教训：读文本的守卫等于没验证）——
 * deps 注入假 cfg 与假客户端，断言"账里收到的形状"而不是"代码长什么样"。
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {emitTaskEvents} from '../../../services/agent/taskEventEmit.js'
import {TASK_EVENT_TYPES} from '../../../services/core/session/taskEvents.js'

/** 假专用客户端：记 xadd 的字段对（与 taskEventLog 测试同族的极简形） */
function makeFakeClient() {
    const entries = []
    let n = 0
    return {
        entries,
        pipeline() {
            const cmds = []
            const p = {
                xadd: (...a) => { cmds.push(a); return p },
                expire: () => p,
                async exec() {
                    const out = []
                    for (const a of cmds) {
                        const args = a.slice(1)
                        const fields = args.slice(args.indexOf('*') + 1)
                        const o = {}
                        for (let i = 0; i < fields.length; i += 2) o[fields[i]] = fields[i + 1]
                        entries.push(o)
                        out.push(`7-${n++}`)
                    }
                    return out
                },
            }
            return p
        },
    }
}

describe('emitTaskEvents', () => {
    test('flag 关（默认离线环境）⇒ 纯 no-op：不碰 redis、emitted 0、skipped=disabled', async () => {
        const r = await emitTaskEvents({rootCode: 'r1', events: [{type: 'task_queued', payload: {rootCode: 'r1'}}]})
        assert.deepEqual(r, {emitted: 0, skipped: 'disabled'})
    })
    test('缺 rootCode ⇒ no-root（连配置都不问）', async () => {
        assert.deepEqual(await emitTaskEvents({rootCode: '', events: []}), {emitted: 0, skipped: 'no-root'})
    })
    test('词表映射表覆盖 TASK_EVENT_TYPES 全集（漂移=未知型静默丢帧的病根）', async () => {
        const fs = await import('node:fs')
        const src = fs.readFileSync(new URL('../../../services/agent/taskEventEmit.js', import.meta.url), 'utf8')
        for (const t of TASK_EVENT_TYPES) {
            assert.ok(src.includes(`${t}:`), `映射表缺 ${t}`)
        }
        assert.equal(TASK_EVENT_TYPES.length, 9)
    })
    test('开 flag（deps 注入）：九类事件逐一发射，假客户端收到构造器产物+段界', async () => {
        const c = makeFakeClient()
        const r = await emitTaskEvents({
            rootCode: 'r9',
            events: TASK_EVENT_TYPES.map((type) => ({type, payload: {rootCode: 'r9'}})),
            end: 'synthesize',
            deps: {cfg: {enabled: true}, getClient: async () => c},
        })
        assert.equal(r.emitted, TASK_EVENT_TYPES.length)
        assert.equal(r.closed, true)
        assert.deepEqual(c.entries.map((e) => e.type), [...TASK_EVENT_TYPES, '__end__'])
        // 构造器真跑过：task_queued 的账带 queuePosition（payload 裸 {rootCode} 是被构造器补全的形状）
        assert.ok('queuePosition' in JSON.parse(c.entries[0].data))
        assert.equal(c.entries[c.entries.length - 1].data, 'synthesize')
    })
    test('未知型不造形状：跳过并 warn，其余照常（发射口不认生面孔）', async () => {
        const c = makeFakeClient()
        const r = await emitTaskEvents({
            rootCode: 'r9',
            events: [{type: 'task_queued', payload: {rootCode: 'r9'}}, {type: 'made_up_event', payload: {}}],
            deps: {cfg: {enabled: true}, getClient: async () => c},
        })
        assert.equal(r.emitted, 1)
        assert.equal(c.entries.length, 1)
    })
    test('getClient 返回 null ⇒ 全部计 failed 不抛（fail-open 承诺在发射口这一层再钉一遍）', async () => {
        const r = await emitTaskEvents({
            rootCode: 'r9',
            events: [{type: 'task_queued', payload: {rootCode: 'r9'}}],
            deps: {cfg: {enabled: true}, getClient: async () => null},
        })
        assert.equal(r.emitted, 1, '发射口视角"已受理"——落账失败由镜像层计数，不反抛')
    })
})
