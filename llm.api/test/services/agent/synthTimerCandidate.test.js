/**
 * @fileOverview synth-timer 泵候选的行为用例（deps 注入真跑，§7-2）
 * @module test/services/agent/synthTimerCandidate.test
 * @description
 * serializedTurnCandidate 的同款纪律：这条分支会派活，必须被真跑——
 * "认领被占不派发""异常恰好释放自己那把""到期才派"都是**调用计数读数**，不是读源码。
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {pumpOneSynthTimer, REQUIRED_DEPS} from '../../../services/agent/synthTimerCandidate.js'

const TASK = {agentCode: 't-1', agentRole: 'synth-timer', handleStatus: 0, params: {rootCode: 'r1', dueAt: 1000}}

function makeDeps({claimState = 'granted', execRet = Promise.resolve({handleStatus: 2}), execThrow = null, extraMissing = null} = {}) {
    const calls = []
    const deps = {
        calls,
        acquireClaim: async ({agentCode, leaseMs}) => { calls.push(['acquire', agentCode, leaseMs]); return {state: claimState, lock: {k: agentCode}} },
        releaseClaim: async ({lock}) => { calls.push(['release', lock.k]); return true },
        // 刻意非 async：execThrow 走**同步 throw** 路径（execAgentTask 的装载期炸法），
        // async 函数会把同步炸变 rejection 吞进 .catch，守卫的 release 分支就测不到了
        exec: (task, {claim}) => {
            calls.push(['exec', task.agentCode, claim?.lock?.k ?? null])
            if (execThrow) throw execThrow
            return Promise.resolve({handleStatus: 2})
        },
        log: {info: () => {}, warn: () => {}, error: () => {}},
    }
    if (extraMissing) delete deps[extraMissing]
    return deps
}

describe('pumpOneSynthTimer', () => {
    test('到点+拿到认领 ⇒ 派发并交接（exec 之后不再 release——所有权归执行侧）', async () => {
        const deps = makeDeps()
        const r = await pumpOneSynthTimer({task: TASK, leaseMs: 5000, now: 1000, deps})
        assert.equal(r.outcome, 'dispatched')
        assert.deepEqual(deps.calls.map((c) => c[0]), ['acquire', 'exec'])
        assert.equal(deps.calls[1][2], 't-1', '认领没交接给执行侧')
    })
    test('未到点 ⇒ not-due，零认领零派发（闹钟没响谁也甭碰）', async () => {
        const deps = makeDeps()
        const r = await pumpOneSynthTimer({task: TASK, now: 999, deps})
        assert.deepEqual(r, {outcome: 'not-due', reason: 'window-open'})
        assert.deepEqual(deps.calls, [])
    })
    test('缺 rootCode 的坏行 ⇒ skip 且不碰认领（finalize 拿到它会猜，宁留账不派）', async () => {
        const deps = makeDeps()
        const r = await pumpOneSynthTimer({task: {...TASK, params: {dueAt: 1}}, now: 2, deps})
        assert.equal(r.outcome, 'skip')
        assert.deepEqual(deps.calls, [])
    })
    test('认领被占（held）⇒ blocked，不派发——pump 走严格语义（claimDecision recover 档）', async () => {
        const deps = makeDeps({claimState: 'held'})
        const r = await pumpOneSynthTimer({task: TASK, now: 1001, deps})
        assert.equal(r.outcome, 'blocked')
        assert.equal(r.state, 'held')
        assert.deepEqual(deps.calls.map((c) => c[0]), ['acquire'], 'blocked 还派发=双跑综合')
    })
    test('redis 不可用（unavailable）⇒ blocked（恢复类动作没有保护就不动，与 recover 同规）', async () => {
        const deps = makeDeps({claimState: 'unavailable'})
        const r = await pumpOneSynthTimer({task: TASK, now: 1001, deps})
        assert.equal(r.outcome, 'blocked')
    })
    test('exec 同步抛 ⇒ 释放自己那把再上抛（绝不留悬挂认领）', async () => {
        const deps = makeDeps({execThrow: new Error('派发炸了')})
        await assert.rejects(() => pumpOneSynthTimer({task: TASK, now: 1001, deps}), /派发炸了/)
        assert.deepEqual(deps.calls.map((c) => c[0]), ['acquire', 'exec', 'release'])
        assert.equal(deps.calls[2][1], 't-1')
    })
    test('acquire 直接抛 ⇒ 没有可释放的东西，照常上抛（不释放一把不存在的锁）', async () => {
        const deps = makeDeps()
        deps.acquireClaim = async () => { throw new Error('redis down') }
        await assert.rejects(() => pumpOneSynthTimer({task: TASK, now: 1001, deps}), /redis down/)
    })
    test('deps 缺项点名（REQUIRED_DEPS 是接口清单）', async () => {
        const deps = makeDeps({extraMissing: 'exec'})
        await assert.rejects(() => pumpOneSynthTimer({task: TASK, deps}), /synth-timer-missing-dep:exec/)
        assert.deepEqual(REQUIRED_DEPS, ['acquireClaim', 'releaseClaim', 'exec', 'log'])
    })
    test('exec 异步 reject（fire-and-forget 面）：候选已经 dispatched 返回，rejection 由挂接的 catch 吞进日志——不让一条闹钟炸穿整个泵', async () => {
        const deps = makeDeps()
        deps.exec = async () => Promise.reject(new Error('后台挂了'))
        const r = await pumpOneSynthTimer({task: TASK, now: 1001, deps})
        assert.equal(r.outcome, 'dispatched')
        await new Promise((res) => setImmediate(res)) // 让 rejection 回调跑一拍，不 unhandled
    })
})
