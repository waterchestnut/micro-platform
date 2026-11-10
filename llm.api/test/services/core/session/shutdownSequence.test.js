import {test, describe, beforeEach} from 'node:test'
import * as assert from 'node:assert'
import {closeWithRescue} from '../../../../services/core/session/shutdownSequence.js'
import {attachArchive, archiveCount, resetForTest} from '../../../../services/core/session/runRegistry.js'

/**
 * 关闭编排的离线验证。
 * 这段逻辑在线上只有"pod 收到 SIGTERM"才会跑到，而本机发不出可用 SIGTERM
 * （Windows 的 `taskkill /F` 是 SIGKILL，不触发处理器）——所以它必须能在假 app 上跑，
 * 否则我们等于把最重要的 20 行进到了没人验证过的路径里。
 */
const events = []
const fakeLog = (msg, obj) => events.push({msg, obj})

/**
 * @description 造一个 close() 可控时长的假 app
 * @param {Number} ms close() 耗时
 * @returns {Object} app
 */
function fakeApp(ms) {
    return {
        close() {
            events.push({msg: 'close-called'})
            return new Promise(res => setTimeout(res, ms))
        },
    }
}

beforeEach(() => {
    resetForTest()
    events.length = 0
})

describe('closeWithRescue', () => {
    test('delayMs 是字符串就抛错——这正是 env 配了却不生效的形状', async () => {
        await assert.rejects(
            () => closeWithRescue({app: fakeApp(10), delayMs: '45000', log: fakeLog}),
            /必须是正数毫秒/,
        )
        assert.equal(archiveCount(), 0)
    })

    test('在途能跑完时不主动落档（跑完的那条自己会落 finish）', async () => {
        attachArchive('m-late', async () => { throw new Error('不该被调用') })
        const r = await closeWithRescue({app: fakeApp(40), delayMs: 4000, reserveMs: 3000, log: fakeLog})
        /** budget = max(1000, 4000-3000) = 1000ms，而 close 只花 40ms ⇒ 不该超时 */
        assert.equal(r.timedOut, false)
        assert.equal(r.archived.length, 0)
        assert.deepEqual(events.map(e => e.msg), ['close-called'], '只调用 close，没有落档动作')
    })

    test('在途跑不完时主动落档，且顺序是"先 close 再落档"', async () => {
        const seen = []
        attachArchive('m1', async () => { seen.push('m1') })
        attachArchive('m2', async () => { seen.push('m2') })
        /** close 3s 才回，预算只有 1s ⇒ 到点必须抢救 */
        const r = await closeWithRescue({app: fakeApp(3000), delayMs: 4000, reserveMs: 3000, perRunTimeoutMs: 500, log: fakeLog})
        assert.equal(r.timedOut, true)
        assert.equal(r.budgetMs, 1000)
        assert.deepEqual(seen, ['m1', 'm2'], '两条在途都被落档')
        assert.equal(r.archived.length, 2)
        assert.ok(r.archived.every(x => x.ok), '落档成功数必须逐条回报')
        /** 顺序断言：close 先被调用，之后才有落档日志——反了就是"想续跑但现场没了" */
        const msgs = events.map(e => e.msg)
        assert.ok(msgs[0] === 'close-called', `第一步必须是 app.close()，实际是 ${msgs[0]}`)
        assert.ok(msgs.some(m => /主动落档 2\/2 条/.test(m)), '日志要写清落了几个：' + msgs.join(' | '))
        assert.ok(msgs.some(m => /m1:/.test(m) && /m2:/.test(m)), '日志要能归属到 messageCode（上一轮就是栽在无法归属）')
        /** 整体耗时应当等于 close 的真实耗时，而不是被预算截断 */
        assert.ok(r.closeMs >= 3000, `收尾要等完，实测 ${r.closeMs}ms`)
    })

    test('抢救不能因为库已关而静默失败：失败的原文要进回报与日志', async () => {
        attachArchive('boom', async () => { throw new Error('mongo closed') })
        const r = await closeWithRescue({app: fakeApp(3000), delayMs: 4000, reserveMs: 3000, perRunTimeoutMs: 500, log: fakeLog})
        assert.equal(r.timedOut, true)
        assert.equal(r.archived[0].ok, false)
        assert.match(r.archived[0].error, /mongo closed/)
        const line = events.find(e => /主动落档 0\/1 条/.test(e.msg || ''))
        assert.ok(line, '失败也要写在同一行日志里，不然"落了 0 条"会被读成"没有在途"')
    })
})
