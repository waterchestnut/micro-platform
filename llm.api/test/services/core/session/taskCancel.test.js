import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {planCancel} from '../../../../services/core/session/taskCancel.js'

/**
 * 任务取消判据基线（§5-2）。钉三条性格：归属 fail-closed、面收窄（存量任务不许被外部状态机乱写）、
 * 在跑的行不覆盖只计数（引擎无把手强停——装成"已停"是分叉，如实"将自然完成不聚合"才是真话）。
 */
const turn = (over = {}) => ({
    agentCode: 't1', agentRole: 'serialized-turn', handleStatus: 0,
    operator: {userCode: 'u1'}, ...over,
})
const root = (over = {}) => ({
    agentCode: 'r1', agentRole: 'root', orchestrated: true, handleStatus: 0,
    operator: {userCode: 'u1'}, ...over,
})
const child = (agentCode, handleStatus) => ({agentCode, handleStatus, operator: {userCode: 'u1'}})

describe('planCancel 守门', () => {
    test('无身份 ⇒ no-user（fail-closed）', () => {
        assert.equal(planCancel({target: turn(), rows: [turn()], userCode: ''}).reason, 'no-user')
    })
    test('目标不存在 ⇒ not-found', () => {
        assert.equal(planCancel({target: null, rows: [], userCode: 'u1'}).reason, 'not-found')
    })
    test('非发起人 ⇒ not-owner（"验不了归属≠归属没问题"同规）', () => {
        assert.equal(planCancel({target: turn(), rows: [turn()], userCode: 'attacker'}).reason, 'not-owner')
    })
    test('面收窄：建课 root（无 orchestrated）与普通 child 一律 scope-reject——存量任务的状态机不许外部乱写', () => {
        assert.equal(planCancel({target: root({orchestrated: undefined}), rows: [], userCode: 'u1'}).reason, 'scope-reject')
        assert.equal(planCancel({target: child('c', 0), agentRole: undefined, rows: [], userCode: 'u1'}).reason, 'scope-reject')
    })
    test('已终态 ⇒ already-terminal（幂等：取消不覆盖既有事实）', () => {
        assert.equal(planCancel({target: turn({handleStatus: 2}), rows: [], userCode: 'u1'}).reason, 'already-terminal')
        assert.equal(planCancel({target: root({handleStatus: 3}), rows: [], userCode: 'u1'}).reason, 'already-terminal')
        assert.equal(planCancel({target: root({handleStatus: -1}), rows: [], userCode: 'u1'}).reason, 'already-terminal')
    })
})

describe('planCancel 排队追问轮', () => {
    test('waiting 行 ⇒ 单行置 -1（condStatus=0 条件写，pump 抢走则 0 命中如实 skipped）', () => {
        const p = planCancel({target: turn(), rows: [turn()], userCode: 'u1'})
        assert.equal(p.ok, true)
        assert.deepEqual(p.updates.map((u) => ({code: u.agentCode, to: u.to, cond: u.condStatus})),
            [{code: 't1', to: -1, cond: 0}])
        assert.equal(p.rootPatch, null)
        assert.deepEqual({c: p.response.cancelled, s: p.response.surface, a: p.response.abortedWaiting},
            {c: true, s: 'serialized-turn', a: 1})
    })
})

describe('planCancel 编排树', () => {
    const rows = [root(), child('c1', 2), child('c2', 0), child('c3', 1), child('c4', -1)]
    test('waiting 子行入 updates；**成功的/失败的已有终态不动**；handling 只计数不改状态', () => {
        const p = planCancel({target: root(), rows, userCode: 'u1'})
        assert.equal(p.ok, true)
        assert.deepEqual(p.updates.map((u) => u.agentCode), ['c2'])
        assert.equal(p.response.runningNoted, 1, 'c3 在途：只记数，行不许被置 -1（引擎无把手强停）')
        assert.deepEqual(p.rootPatch, {
            condStatusIn: [0, 1], to: 3,
            orchestration: {cancelled: true, action: 'cancelled', reason: 'user-cancelled'},
        })
    })
    test('响应如实带在途说明（用户要知道"不是立刻全停"）', () => {
        const p = planCancel({target: root(), rows, userCode: 'u1'})
        assert.match(p.response.note, /自然完成/)
        const clean = planCancel({target: root(), rows: [root(), child('c2', 0)], userCode: 'u1'})
        assert.equal(clean.response.note, undefined, '没有在途行就不制造多余的"注意"文案')
    })
})
