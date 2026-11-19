import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    activeAttempts, supersededAttempts, buildRetrySpecs, buildReplanSpecs, nextPlanRound,
    planFollowStep, degradeFollowToReport, rollupAllAttemptCredits, runFollowLoop, buildReplanQuery, mergeCancelAware,
} from '../../../services/agent/fanOutFollow.js'

/**
 * 追活判据 + 循环（PR-任务编排 f）。runFollowLoop 用注入假依赖**真跑**（recoverCandidate 教训：
 * 会派活的分支只能读文本"验证"＝没验证）。钉四件事：
 * ① 计数看 active / 花钱看 all 的两口径；② 重试是**新行**（终态行不改历史）；
 * ③ 预算/保险帽到点必停且降级如实 report，绝不把 root 悬在"等一个不会来的 replan"；
 * ④ autoFollow 关 ⇒ 循环零动作（dispatch 原样如实回传）。
 */
const kid = (agentCode, handleStatus, over = {}) => ({
    agentCode, title: agentCode, handleStatus,
    handleRet: over.handleRet !== undefined ? over.handleRet : (handleStatus === 2 ? { content: 'x', usable: true } : null),
    params: over.params || {},
})
const boom = (agentCode, over = {}) => kid(agentCode, -1, { handleRet: null, ...over })

describe('轮次语义：active / superseded / 代', () => {
    test('无轮次标记时 active=全集（向后兼容：既有 e2e 的树行为不变）', () => {
        const all = [kid('a', 2), boom('b')]
        assert.deepEqual(activeAttempts(all).map((c) => c.agentCode), ['a', 'b'])
        assert.deepEqual(supersededAttempts(all), [])
    })

    test('retry 后 active 只看每槽最新一轮；旧尝试进 superseded（不消失，花钱账要它）', () => {
        const all = [
            boom('b', { params: { retryOf: 'b', followRound: 0 } }),   // 槽 b 第 0 轮失败
            kid('b2', 2, { params: { retryOf: 'b', followRound: 1 } }), // 槽 b 第 1 轮成功
        ]
        assert.deepEqual(activeAttempts(all).map((c) => c.agentCode), ['b2'], '槽 b 的 active 是最新一轮(成功)')
        assert.deepEqual(supersededAttempts(all).map((c) => c.agentCode), ['b'])
    })

    test('replan 换代：active 只认最新一代，旧代整组退场', () => {
        const all = [boom('a', { params: { planRound: 0 } }), boom('b', { params: { planRound: 0 } }),
            kid('c', 2, { params: { planRound: 1 } })]
        assert.deepEqual(activeAttempts(all).map((x) => x.agentCode), ['c'])
        assert.equal(nextPlanRound(all), 2)
    })
})

describe('规格构造', () => {
    test('buildRetrySpecs：新行不带 agentCode（交 format 生成），打 retryOf/followRound，标题带重试轮', () => {
        const all = [boom('x', { params: { query: 'q1' } })]
        const specs = buildRetrySpecs({ children: all, retryAgents: ['x'] })
        assert.equal(specs.length, 1)
        assert.equal(specs[0].agentCode, undefined, '身份字段必须交下游 format，两处生 id 会打架')
        assert.equal(specs[0].params.query, 'q1', '参数原样复制——失败现场可复现')
        assert.deepEqual({ retryOf: specs[0].params.retryOf, followRound: specs[0].params.followRound }, { retryOf: 'x', followRound: 1 })
        assert.match(specs[0].title, /重试1/)
    })

    test('第 2 轮 retry：arbitrate 点名"最新失败行"(retryOf 那行)也必须认得——e2e 实测第 2 轮曾 empty', () => {
        const all = [
            boom('b', { params: { query: 'q' } }),                                   // 槽主行 round0
            boom('b1', { params: { query: 'q', retryOf: 'b', followRound: 1 } }),     // 最新失败 round1
        ]
        const specs = buildRetrySpecs({ children: all, retryAgents: ['b1'] })
        assert.equal(specs.length, 1, '按最新失败行的 agentCode 点名也要能找到它所在槽')
        assert.equal(specs[0].params.followRound, 2)
        assert.equal(specs[0].params.retryOf, 'b', '槽主不变，仍是 b')
    })

    test('buildReplanSpecs：全代次 planRound 递增、新槽位（无 retryOf）', () => {
        const specs = buildReplanSpecs({
            subtasks: [{ title: 'T', query: 'q', handler: 'agentChat', params: { query: 'q' } }], planRound: 1,
        })
        assert.equal(specs[0].params.planRound, 1)
        assert.equal(specs[0].params.retryOf, undefined)
    })

    test('buildReplanQuery：带失败事实与原请求，不替 planner 决定拆法', () => {
        const q = buildReplanQuery('调研 X', { reason: 'all-failed-replan' })
        assert.match(q, /调研 X/)
        assert.match(q, /all-failed-replan/)
    })
})

describe('planFollowStep：预算与降级', () => {
    test('autoFollow 关 ⇒ 一切 stop（dispatch 保持如实回传，行为同 A/B1 落地版）', () => {
        const s = planFollowStep({ action: 'retry', autoFollow: false })
        assert.deepEqual({ act: s.act, reason: s.reason, degrade: s.degrade }, { act: 'stop', reason: 'auto-follow-off', degrade: null })
    })
    test('用户已取消 ⇒ stop+degrade=cancelled-by-user，**优先级在 autoFollow 之前**（预算再够也不许追）', () => {
        const s = planFollowStep({action: 'retry', autoFollow: true, cancelled: true})
        assert.deepEqual({act: s.act, degrade: s.degrade}, {act: 'stop', degrade: 'cancelled-by-user'})
    })

    test('synthesize/report 是终局，不追', () => {
        assert.equal(planFollowStep({ action: 'synthesize', autoFollow: true }).act, 'stop')
        assert.equal(planFollowStep({ action: 'report', autoFollow: true }).act, 'stop')
    })
    test('retry ⇒ spawnRetry 且计数 +1（预算本身在 arbitrate，不在这里重造）', () => {
        const s = planFollowStep({ action: 'retry', autoFollow: true, retryCount: 0 })
        assert.equal(s.act, 'spawnRetry')
        assert.equal(s.counts.retryCount, 1)
    })
    test('replan + planner 没开 ⇒ stop+degrade=replan-no-planner（root 不许悬在 1 等不来的 replan）', () => {
        const s = planFollowStep({ action: 'replan', autoFollow: true, plannerEnabled: false })
        assert.equal(s.act, 'stop')
        assert.equal(s.degrade, 'replan-no-planner')
    })
    test('replan + planner 开 ⇒ spawnReplan 计数 +1', () => {
        const s = planFollowStep({ action: 'replan', autoFollow: true, plannerEnabled: true, replanCount: 0 })
        assert.equal(s.act, 'spawnReplan')
        assert.equal(s.counts.replanCount, 1)
    })
    test('spawn 数到保险帽 ⇒ stop+degrade（防循环 bug，裁决预算之外的第二道闸）', () => {
        const s = planFollowStep({ action: 'retry', autoFollow: true, spawned: 8, spawnCap: 8 })
        assert.equal(s.act, 'stop')
        assert.equal(s.degrade, 'retry-cap')
    })
    test('degradeFollowToReport：改判 report/3 但原裁决保留在 reason 里（审计不丢现场）', () => {
        const f = degradeFollowToReport({ action: 'replan', reason: 'all-failed-replan', handleStatus: 1 }, 'replan-no-planner')
        assert.equal(f.action, 'report')
        assert.equal(f.handleStatus, 3)
        assert.match(f.reason, /replan-no-planner.*replan/)
    })
})

describe('rollupAllAttemptCredits：花钱账含失败尝试', () => {
    test('superseded 的 credits 照算（失败也是真花了钱）；无用量行如实 missing 不补 0', () => {
        const all = [
            { agentCode: 'a', handleRet: { credits: 10, creditsPriced: false } },
            { agentCode: 'b', handleRet: { credits: 4, creditsPriced: false } },   // 旧代
            { agentCode: 'c', handleRet: null },                                     // 确定性失败,无账
        ]
        const r = rollupAllAttemptCredits(all)
        assert.deepEqual({ t: r.totalCredits, n: r.count, p: r.priced }, { t: 14, n: 2, p: false })
        assert.deepEqual(r.missing, ['c'])
    })
})

describe('runFollowLoop：四条路径真跑（假 deps）', () => {
    const mkFin = (children, counts) => ({
        action: counts.action, reason: 'fake', handleStatus: 2, settled: true,
        counts: {}, credits: {}, dispatch: { retryAgents: ['b'] },
    })
    function harness({ all, action, cfg = {}, replanPlan }) {
        let state = all.slice()
        const spawned = []
        return {
            spawned,
            deps: {
                readAllChildren: async () => state.slice(),
                computeFin: (active, counts) => mkFin(active, { action: action.shift(), ...counts }),
                spawnRetrySpecs: async (specs) => {
                    spawned.push(...specs.map((s) => ({ kind: 'retry', title: s.title })))
                    specs.forEach((s, i) => state.push({ ...kid(s.title + '-' + i, 2), params: s.params }))
                },
                replanSubtasks: async () => replanPlan || { needFanOut: false, subtasks: [], reason: 'no-fanout' },
                spawnReplanSpecs: async (specs) => {
                    spawned.push(...specs.map((s) => ({ kind: 'replan', title: s.title })))
                    specs.forEach((s, i) => state.push({ ...kid('rp' + i, 2), params: s.params }))
                },
                log: { warn: () => {}, error: () => {}, info: () => {} },
                cfg: { originalQuery: 'Q', ...cfg },
            },
        }
    }

    test('autoFollow 关 ⇒ 零 spawn，fin 原样（现网默认形态）', async () => {
        const h = harness({ all: [kid('a', 2), boom('b')], action: ['retry'], cfg: { autoFollow: false } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.spawned, 0)
        assert.deepEqual(h.spawned, [])
        assert.equal(r.fin.action, 'retry', 'dispatch 如实保留，让观测方知道"该追但没追"')
    })

    test('retry 一轮后全成 ⇒ synthesize 收尾；superseded 记账；计数持久', async () => {
        const h = harness({ all: [kid('a', 2), boom('b')], action: ['retry', 'synthesize'], cfg: { autoFollow: true } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.retryCount, 1)
        assert.equal(r.fin.action, 'synthesize')
        assert.equal(r.follow.superseded.length, 1, '旧的 -1 行退场进 superseded，不冒充 active')
        assert.equal(h.spawned[0].kind, 'retry')
    })

    test('replan：planner 给得出新方案 ⇒ 换代 spawn；给不出 ⇒ 降级 report 不空转', async () => {
        const okPlan = { needFanOut: true, subtasks: [{ title: '新A', query: 'qa', handler: 'agentChat' }, { title: '新B', query: 'qb', handler: 'agentChat' }] }
        const h1 = harness({
            all: [boom('a'), boom('b')], action: ['replan', 'synthesize'],
            cfg: { autoFollow: true, plannerEnabled: true }, replanPlan: okPlan,
        })
        const r1 = await runFollowLoop(h1.deps)
        assert.equal(r1.follow.replanCount, 1)
        assert.equal(h1.spawned[0].kind, 'replan')

        const h2 = harness({ all: [boom('a')], action: ['replan'], cfg: { autoFollow: true, plannerEnabled: true }, replanPlan: { needFanOut: false } })
        const r2 = await runFollowLoop(h2.deps)
        assert.equal(r2.fin.action, 'report')
        assert.equal(r2.follow.degrade, 'spawnReplan-empty')
        assert.equal(r2.follow.replanCount, 0, '没 spawn 成功就不该记这次换代')
    })

    test('planner 没开而裁决要 replan ⇒ stop+degrade，root 落 3 不悬 1', async () => {
        const h = harness({ all: [boom('a')], action: ['replan'], cfg: { autoFollow: true, plannerEnabled: false } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.fin.action, 'report')
        assert.equal(r.fin.handleStatus, 3)
        assert.equal(r.follow.degrade, 'replan-no-planner')
        assert.deepEqual(h.spawned, [])
    })

    test('pending(未终局) ⇒ stop+degrade not-settled：root 绝不回写 1 悬死（alreadyFinalized 不会再触发）', async () => {
        const h = harness({ all: [kid('a', 2)], action: ['pending'], cfg: { autoFollow: true } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.fin.action, 'report')
        assert.equal(r.fin.handleStatus, 3)
        assert.equal(r.follow.degrade, 'not-settled')
        assert.deepEqual(h.spawned, [])
    })

    test('runFollowLoop：isCancelled 真了 ⇒ 不再 spawn，fin 改写 cancelled 的如实 report(3)', async () => {
        let ticks = 0
        const h = harness({all: [kid('a', 2), boom('b')], action: ['retry', 'retry'], cfg: {autoFollow: true}})
        h.deps.isCancelled = async () => { ticks += 1; return ticks >= 2 } // 第一轮放行，第二轮喊停
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.spawned, 1, '第一轮的 1 个失败槽 spawn 发生了')
        assert.equal(r.fin.action, 'report')
        assert.equal(r.fin.handleStatus, 3)
        assert.match(r.fin.reason, /cancelled/)
    })

    test('spawn 的 IO 炸(如依赖缺失/DB 抖) ⇒ 降级 report 带 error 审计，绝不空手让 root 无 orchestration', async () => {
        const h = harness({ all: [kid('a', 2), boom('b')], action: ['retry'], cfg: { autoFollow: true } })
        h.deps.spawnRetrySpecs = async () => { throw new Error('mongo down') }
        const r = await runFollowLoop(h.deps)
        assert.equal(r.fin.action, 'report')
        assert.equal(r.fin.handleStatus, 3)
        assert.equal(r.follow.degrade, 'spawnRetry-spawn-failed')
        assert.match(r.follow.error, /mongo down/)
    })
})

describe('mergeCancelAware（写回前重读感知）', () => {
    test('未标取消 ⇒ 原样；已标 ⇒ report(3)+cancelled，原裁决留在 reason 供审计', () => {
        const fin = {action: 'synthesize', reason: 'all-success', handleStatus: 2, settled: true, terminal: true, counts: {}, dispatch: {}}
        assert.equal(mergeCancelAware(fin, null), fin)
        assert.equal(mergeCancelAware(fin, {cancelled: false}), fin)
        const m = mergeCancelAware(fin, {cancelled: true, action: 'cancelled'})
        assert.equal(m.action, 'report')
        assert.equal(m.handleStatus, 3)
        assert.equal(m.cancelled, true)
        assert.match(m.reason, /cancelled-by-user.*synthesize/)
    })
})
