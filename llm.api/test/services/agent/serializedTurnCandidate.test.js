import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    pumpOneTurnCandidate,
    pickOldestPerConversation,
    REQUIRED_DEPS,
} from '../../../services/agent/serializedTurnCandidate.js'

/**
 * serialized-turn 排队候选处理（PR-任务编排 M1-b 设计 A）。
 * 承 recoverCandidate 的教训：**这条分支会改数据、会派活，必须被真跑**——所以所有副作用都是可计数的假实现。
 * 钉的核心：① 会话忙 ⇒ 等而非派发；② 认领没拿到 ⇒ 跳过而非双跑；③ 派发 ⇒ 认领交接（不自放）；④ 抛错 ⇒ 释放。
 */
function makeDeps(over = {}) {
    const calls = { exec: 0, release: 0, findOpenRun: 0, acquire: 0 }
    const log = { info: () => {}, warn: () => {}, error: () => {} }
    const deps = {
        findOpenRun: async () => { calls.findOpenRun++; return over.open ?? null },
        acquireClaim: async (a) => { calls.acquire++; return over.claim ?? { state: 'granted', lock: { k: 'x' } } },
        releaseClaim: async () => { calls.release++; return { ok: true, reason: 'released' } },
        exec: (task, opts) => {
            calls.exec++
            calls.lastExecOpts = opts
            return over.execThrows ? Promise.reject(over.execThrows) : Promise.resolve({ handleStatus: 2 })
        },
        log,
    }
    return { deps, calls }
}

const task = (over = {}) => ({
    agentCode: 'a1', conversationCode: 'conv-1', handleStatus: 0,
    params: { messageCode: 'm-turn', query: '再讲讲' }, ...over,
})

describe('pickOldestPerConversation', () => {
    test('同会话只保留最旧一条（rows 已升序 ⇒ 首个即最旧），不同会话各自保留', () => {
        const rows = [
            task({ agentCode: 'a-old', conversationCode: 'cA' }),
            task({ agentCode: 'a-new', conversationCode: 'cA' }),
            task({ agentCode: 'b1', conversationCode: 'cB' }),
        ]
        const picked = pickOldestPerConversation(rows)
        assert.deepEqual(picked.map(r => r.agentCode), ['a-old', 'b1'])
    })
    test('无 conversationCode 的行被忽略（不能凭 agentCode 就派）', () => {
        assert.deepEqual(pickOldestPerConversation([{ agentCode: 'x' }]), [])
    })
})

describe('pumpOneTurnCandidate', () => {
    test('deps 缺项 ⇒ 立刻报缺哪个（不跑到一半炸 undefined）', async () => {
        await assert.rejects(() => pumpOneTurnCandidate({ task: task(), deps: { findOpenRun: async () => null } }),
            /turn-candidate-missing-dep:acquireClaim/)
    })
    REQUIRED_DEPS.forEach((k) => {
        test(`必填副作用清单含 ${k}`, () => assert.ok(REQUIRED_DEPS.includes(k)))
    })

    test('缺 agentCode ⇒ 抛', async () => {
        const { deps } = makeDeps()
        await assert.rejects(() => pumpOneTurnCandidate({ task: { conversationCode: 'c' }, deps }), /no-agent-code/)
    })

    test('缺 conversationCode ⇒ skip，且不查账本、不派发', async () => {
        const { deps, calls } = makeDeps()
        const r = await pumpOneTurnCandidate({ task: { agentCode: 'a' }, deps })
        assert.deepEqual({ outcome: r.outcome, reason: r.reason }, { outcome: 'skip', reason: 'no-conversation' })
        assert.equal(calls.findOpenRun, 0)
        assert.equal(calls.exec, 0)
    })

    test('上一轮还在跑（新鲜 open run）⇒ waiting-conversation，绝不派发（这是"排队不丢"的核心）', async () => {
        const { deps, calls } = makeDeps({ open: { messageCode: 'p1', insertTime: new Date(Date.now() - 1000) } })
        const r = await pumpOneTurnCandidate({ task: task(), staleMs: 45000, leaseMs: 900000, now: Date.now(), deps })
        assert.equal(r.outcome, 'waiting-conversation')
        assert.equal(r.reason, 'previous-turn-active')
        assert.equal(calls.exec, 0, '会话忙时一次都不该派')
        assert.equal(calls.acquire, 0, '忙时连锁都不取（省往返，且不给认领制造噪音）')
    })

    test('僵尸 open run（超 staleMs 未终态）⇒ 视作空闲、放行派发（与 runOverlap 陈旧不锁死同取向）', async () => {
        const now = Date.now()
        const { deps, calls } = makeDeps({ open: { messageCode: 'p1', insertTime: new Date(now - 60000) } })
        const r = await pumpOneTurnCandidate({ task: task(), staleMs: 45000, leaseMs: 900000, now, deps })
        assert.equal(r.outcome, 'dispatched')
        assert.equal(calls.exec, 1)
    })

    test('会话空闲 + 取到认领 ⇒ 直连派发、认领交接（exec 收到 {claim}，本器不自放锁）', async () => {
        const { deps, calls } = makeDeps({ claim: { state: 'granted', lock: { k: 'L' } } })
        const r = await pumpOneTurnCandidate({ task: task(), deps })
        assert.equal(r.outcome, 'dispatched')
        assert.equal(calls.exec, 1)
        assert.ok(calls.lastExecOpts && calls.lastExecOpts.claim, 'claim 必须交给 execAgentTask，由它 finally 释放')
        assert.equal(calls.release, 0, '成功派发路径本器绝不 release（交接后放=误删执行侧的锁）')
    })

    test('认领被占（held）⇒ blocked，不派发（防同一条被并发跑；execAgentTask 的 fail-open 不能指望）', async () => {
        const { deps, calls } = makeDeps({ claim: { state: 'held', lock: null } })
        const r = await pumpOneTurnCandidate({ task: task(), deps })
        assert.equal(r.outcome, 'blocked')
        assert.match(r.reason, /recover-need-claim/)
        assert.equal(calls.exec, 0)
        assert.equal(calls.release, 0, '没拿到的锁不该去放')
    })

    test('锁层不可用（unavailable）⇒ blocked，不裸奔派发', async () => {
        const { deps, calls } = makeDeps({ claim: { state: 'unavailable', lock: null } })
        const r = await pumpOneTurnCandidate({ task: task(), deps })
        assert.equal(r.outcome, 'blocked')
        assert.equal(calls.exec, 0)
    })

    test('读账本失败 ⇒ skip（读不懂时保守不派，绝不贸然并发），且不取认领', async () => {
        const { deps, calls } = makeDeps({ open: undefined })
        deps.findOpenRun = async () => { throw new Error('mongo down') }
        const r = await pumpOneTurnCandidate({ task: task(), deps })
        assert.deepEqual({ outcome: r.outcome, reason: r.reason }, { outcome: 'skip', reason: 'open-run-read-failed' })
        assert.equal(calls.acquire, 0)
        assert.equal(calls.exec, 0)
    })

    test('exec 取认领后同步抛 ⇒ 释放已持有的认领再上抛（不留占到租约到期的死锁）', async () => {
        const { deps, calls } = makeDeps({ claim: { state: 'granted', lock: { k: 'L' } } })
        deps.exec = () => { throw new Error('boom') }
        await assert.rejects(() => pumpOneTurnCandidate({ task: task(), deps }), /boom/)
        assert.equal(calls.release, 1, '抛前必须释放未交出的锁')
    })
})
