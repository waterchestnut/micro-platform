import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import { decideFanOutEntry } from '../../../../services/core/session/fanOutEntry.js'

/**
 * 任务模式入口判定（M4b c2）。核心纪律：默认不进；开了才看"显式开关/频道白名单"；
 * 用户按了任务模式但功能没开 ⇒ 仍不进（并给出可区分的 reason），因为"没开"是部署事实、不该让用户的话被吃掉。
 */
describe('decideFanOutEntry', () => {
    test('总开关不为严格 true ⇒ 一律不进（"true" 字符串/1 都不算开）', () => {
        for (const off of [false, undefined, 'true', 1, 0]) {
            assert.equal(decideFanOutEntry({ enabled: off, taskMode: true, channel: 'x', entryChannels: ['x'] }).attempt, false, String(off))
        }
    })

    test('功能没开但用户显式要任务模式 ⇒ reason=task-mode-disabled（与"没要求"可区分，日志/界面用）', () => {
        assert.equal(decideFanOutEntry({ enabled: false, taskMode: true }).reason, 'task-mode-disabled')
        assert.equal(decideFanOutEntry({ enabled: false, taskMode: 1 }).reason, 'task-mode-disabled')
        assert.equal(decideFanOutEntry({ enabled: false }).reason, 'disabled')
    })

    test('开了 + taskMode=true/1 ⇒ 进，via=taskMode', () => {
        for (const v of [true, 1]) {
            const r = decideFanOutEntry({ enabled: true, taskMode: v })
            assert.equal(r.attempt, true)
            assert.equal(r.via, 'taskMode')
        }
    })

    test('开了 + taskMode 假值(0/false/"true"/undefined) ⇒ 不因开关进（字符串 "true" 不算承诺）', () => {
        for (const v of [0, false, 'true', 'yes', undefined, '']) {
            assert.equal(decideFanOutEntry({ enabled: true, taskMode: v, channel: 'other', entryChannels: [] }).attempt, false, String(v))
        }
    })

    test('开了 + 频道命中白名单 ⇒ 进，via=channel（精确成员，不做前缀/包含匹配）', () => {
        assert.equal(decideFanOutEntry({ enabled: true, channel: 'xxzx_research', entryChannels: ['xxzx_research'] }).via, 'channel')
        assert.equal(decideFanOutEntry({ enabled: true, channel: 'xxzx', entryChannels: ['xxzx_research'] }).attempt, false,
            '频道名必须是白名单成员；"xxzx" 不该因前缀相同命中')
        assert.equal(decideFanOutEntry({ enabled: true, channel: 'x', entryChannels: ['a', 'x', 'b'] }).via, 'channel')
    })

    test('空频道/非数组白名单不炸且不进', () => {
        assert.equal(decideFanOutEntry({ enabled: true, channel: '', entryChannels: [''] }).attempt, false, '空频道不该命中')
        assert.equal(decideFanOutEntry({ enabled: true, channel: 'x', entryChannels: undefined }).attempt, false)
        assert.equal(decideFanOutEntry({ enabled: true, channel: 'x', entryChannels: 'x' }).attempt, false)
    })

    test('都没满足 ⇒ not-requested（普通回答，零额外成本）', () => {
        const r = decideFanOutEntry({ enabled: true, taskMode: false, channel: 'xxzx_common', entryChannels: ['xxzx_research'] })
        assert.deepEqual(r, { attempt: false, via: null, reason: 'not-requested' })
    })
})
