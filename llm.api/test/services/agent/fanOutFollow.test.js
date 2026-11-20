import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
    activeAttempts, supersededAttempts, buildRetrySpecs, buildReplanSpecs, nextPlanRound,
    planFollowStep, degradeFollowToReport, rollupAllAttemptCredits, runFollowLoop, buildReplanQuery, mergeCancelAware, buildLayerSpecs,
} from '../../../services/agent/fanOutFollow.js'

/**
 * 追活判据 + 循环（PR-任务编排 f）。runFollowLoop 用注入假依赖**真跑**（recoverCandidate 教训：
 * 会派活的分支只能读文本"验证"＝没验证）。钉四件事：
 * ① 计数看 active / 花钱看 all 的两口径；② 重试是**新行**（终态行不改历史）；
 * ③ 预算/保险帽到点必停且降级如实 report，绝不把 root 悬在"等一个不会来的 replan"；
 * ④ autoFollow 关 ⇒ 循环零动作；retry/replan 裁决降级 report(3) 不悬空（§7-4），dispatch 原样留审计。
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
    test('autoFollow 关 ⇒ 一切 stop；**retry/replan 标 degrade=auto-follow-off（§7-4 不许悬空），终态动作不标**', () => {
        const s = planFollowStep({ action: 'retry', autoFollow: false })
        assert.deepEqual({ act: s.act, reason: s.reason, degrade: s.degrade }, { act: 'stop', reason: 'auto-follow-off', degrade: 'auto-follow-off' })
        assert.equal(planFollowStep({ action: 'replan', autoFollow: false }).degrade, 'auto-follow-off')
        // synthesize/report 本就终局、无"等待者"问题；pending 是"未终局不收尾"另一条纪律（§7-4 不碰）
        assert.equal(planFollowStep({ action: 'synthesize', autoFollow: false }).degrade, null)
        assert.equal(planFollowStep({ action: 'report', autoFollow: false }).degrade, null)
        assert.equal(planFollowStep({ action: 'pending', autoFollow: false }).degrade, null)
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

    // ===== §8 分层：计划没走完不许 synthesize，层推进吃保险帽 =====
    test('synthesize + pendingLayers>0 ⇒ spawnLayer（layer-advance，不吃 retry 预算）', () => {
        const s = planFollowStep({ action: 'synthesize', autoFollow: true, pendingLayers: 2 })
        assert.equal(s.act, 'spawnLayer'); assert.equal(s.reason, 'layer-advance'); assert.equal(s.degrade, null)
        assert.deepEqual(s.counts, { retryCount: 0, replanCount: 0 }, '层推进不是重试：计数不进 retry 预算')
    })
    test('synthesize + pendingLayers=0 ⇒ terminal:synthesize（逐字旧行为）', () => {
        assert.equal(planFollowStep({ action: 'synthesize', autoFollow: true }).reason, 'terminal:synthesize')
    })
    test('层推进触 spawn 帽 ⇒ degrade=layer-cap（保险对 layer spawn 同样成立）', () => {
        const s = planFollowStep({ action: 'synthesize', autoFollow: true, pendingLayers: 1, spawned: 8, spawnCap: 8 })
        assert.equal(s.act, 'stop'); assert.equal(s.degrade, 'layer-cap')
    })
    test('OFF + synthesize + pendingLayers ⇒ degrade=layered-not-advanced（半树综合=谎报完成）', () => {
        const s = planFollowStep({ action: 'synthesize', autoFollow: false, pendingLayers: 1 })
        assert.equal(s.degrade, 'layered-not-advanced')
        // OFF + 无分层 ⇒ 仍 null（§7-4 账不变）
        assert.equal(planFollowStep({ action: 'synthesize', autoFollow: false, pendingLayers: 0 }).degrade, null)
    })
    test('buildLayerSpecs 形状：query 必填、layerIndex/planRound/followRound 盖进 params、id/deps 住 params、坏项丢', () => {
        const specs = buildLayerSpecs(
            [{ title: 'T', query: 'q1', handler: 'agentChat', id: 'c' }, { title: '坏' }],
            { planRound: 2, layerIndex: 1 },
        )
        assert.equal(specs.length, 1)
        assert.equal(specs[0].handler, 'agentChat')
        assert.deepEqual({ ...specs[0].params }, { query: 'q1', planRound: 2, followRound: 0, layerIndex: 1, id: 'c' })
        assert.equal(specs[0].id, undefined, 'id 不再住顶层（format 只带 params，库内反查锚统一 params.id）')
        // deps 项：query 必带注入段（缺上游也标注——deps 的"缺席不装存在"），deps 进 params
        const d = buildLayerSpecs([{ title: 'D', query: 'q2', deps: ['a'] }], { layerIndex: 1 })
        assert.equal(d[0].params.deps.join(), 'a')
        assert.ok(d[0].params.query.startsWith('q2') && d[0].params.query.includes('上游未产出'))
    })
    test('§8 deps 真语义：上游 usable 正文注入下游 query；无产出 ⇒ 如实"上游未产出"（缺席不装存在）', () => {
        const withUp = buildLayerSpecs([{ title: 'C', query: '对比吧', deps: ['a', 'b'] }], {
            layerIndex: 1, upstream: { a: { title: 'A', content: 'A的调研结果' }, b: {} },
        })
        assert.match(withUp[0].params.query, /A的调研结果/)
        assert.match(withUp[0].params.query, /- b: （上游未产出/)
        const noUp = buildLayerSpecs([{ title: 'C', query: '对比吧', deps: ['x'] }], { layerIndex: 1, upstream: {} })
        assert.match(noUp[0].params.query, /上游未产出/)
    })
    test('上游超长截断 maxUpstreamChars（下游 prompt 不被子任务长产出撑爆）', () => {
        const r = buildLayerSpecs([{ title: 'C', query: 'q', deps: ['a'] }], {
            layerIndex: 1, maxUpstreamChars: 50, upstream: { a: { title: 'A', content: 'x'.repeat(500) } },
        })
        assert.ok(r[0].params.query.includes('x'.repeat(50)) && !r[0].params.query.includes('x'.repeat(51)))
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
    function harness({ all, action, cfg = {}, replanPlan, budgetGate }) {
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
                budgetGate, // §7-3：不传=闸放行（与 finalize 注入缺省同形）
                spawnReplanSpecs: async (specs) => {
                    spawned.push(...specs.map((s) => ({ kind: 'replan', title: s.title })))
                    specs.forEach((s, i) => state.push({ ...kid('rp' + i, 2), params: s.params }))
                },
                // §8 层推进收集口：与 retry/replan 同法真跑（假 deps 纪律）
                spawnLayerSpecs: async (specs) => {
                    spawned.push(...specs.map((s) => ({ kind: 'layer', title: s.title, params: s.params })))
                    specs.forEach((s, i) => state.push({ ...kid('ly' + i, 2), params: s.params }))
                },
                log: { warn: () => {}, error: () => {}, info: () => {} },
                cfg: { originalQuery: 'Q', ...cfg },
            },
        }
    }

    test('autoFollow 关 + retry 裁决 ⇒ 零 spawn 且**降级 report(3) 不悬 1（§7-4）**；dispatch 原样留审计', async () => {
        const h = harness({ all: [kid('a', 2), boom('b')], action: ['retry'], cfg: { autoFollow: false } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.spawned, 0)
        assert.deepEqual(h.spawned, [])
        assert.equal(r.fin.action, 'report', '没有承接方的裁决不许把树挂起：降级 report')
        assert.equal(r.fin.handleStatus, 3, '完成含错(3)，不是悬 1')
        assert.match(r.fin.reason, /原裁决:retry/, '降级不吞原裁决事实：reason 带审计原文')
        assert.deepEqual(r.fin.dispatch, { retryAgents: ['b'] }, '"该追未追"仍在——dispatch 原样保留给观测/对账')
        assert.equal(r.follow.degrade, 'auto-follow-off')
        assert.equal(r.follow.stopReason, 'auto-follow-off')
    })

    test('autoFollow 关 + replan 裁决 ⇒ 同样降级 report(3)；synthesize/report/pending 原样不碰', async () => {
        const h1 = harness({ all: [boom('a')], action: ['replan'], cfg: { autoFollow: false } })
        const r1 = await runFollowLoop(h1.deps)
        assert.equal(r1.fin.action, 'report')
        assert.equal(r1.fin.handleStatus, 3)
        assert.equal(r1.follow.degrade, 'auto-follow-off')
        // 终局动作与未终局 pending：OFF 路径逐字原样（pending 的"不收尾"是另一条纪律，无实测不加刀）
        const h2 = harness({ all: [kid('a', 2)], action: ['synthesize'], cfg: { autoFollow: false } })
        assert.equal((await runFollowLoop(h2.deps)).fin.action, 'synthesize')
        const h3 = harness({ all: [kid('a', 2), boom('b')], action: ['report'], cfg: { autoFollow: false } })
        assert.equal((await runFollowLoop(h3.deps)).fin.action, 'report')
        const h4 = harness({ all: [kid('a', 2)], action: ['pending'], cfg: { autoFollow: false } })
        const r4 = await runFollowLoop(h4.deps)
        assert.equal(r4.fin.action, 'pending')
        assert.equal(r4.follow.degrade, null, 'pending 不许被 §7-4 顺手改判——未终局不收尾')
    })

    // ===== §8 分层：循环真跑 =====
    test('ON + 层队列：层0 全成 ⇒ spawnLayer 真推进，推进后全成才 synthesize', async () => {
        const orchPlan = [[{ title: '汇总', query: 'sum', handler: 'agentChat', id: 'c', deps: ['a'] }]]
        const h = harness({ all: [kid('a', 2)], action: ['synthesize', 'synthesize'], cfg: { autoFollow: true, orchPlan } })
        const r = await runFollowLoop(h.deps)
        const ly = h.spawned.filter((s) => s.kind === 'layer')
        assert.equal(ly.length, 1, '下一层被 spawn')
        assert.equal(ly[0].params.layerIndex, 1)
        assert.equal(ly[0].params.followRound, 0)
        assert.equal(r.follow.spawnedLayers, 1)
        assert.equal(r.follow.spawned, 1, '层行计入总 spawn 帽')
        assert.equal(r.fin.action, 'synthesize', '队列走完后才 terminal')
        assert.equal(r.follow.degrade, null)
    })
    test('ON + 两层队列连续推进：layerIndex 递增、终局 synthesize', async () => {
        const orchPlan = [
            [{ title: 'L1', query: 'q1', handler: 'agentChat' }],
            [{ title: 'L2', query: 'q2', handler: 'agentChat' }],
        ]
        const h = harness({ all: [kid('a', 2)], action: ['synthesize', 'synthesize', 'synthesize'], cfg: { autoFollow: true, orchPlan } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.spawnedLayers, 2)
        assert.deepEqual(h.spawned.filter((s) => s.kind === 'layer').map((s) => s.params.layerIndex), [1, 2])
    })
    test('OFF + synthesize + 层队列 ⇒ 降级 report(3) 不半树综合；skippedLayers 如实', async () => {
        const orchPlan = [[{ title: 'L1', query: 'q1' }], [{ title: 'L2', query: 'q2' }]]
        const h = harness({ all: [kid('a', 2)], action: ['synthesize'], cfg: { autoFollow: false, orchPlan } })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.fin.action, 'report')
        assert.equal(r.fin.handleStatus, 3)
        assert.equal(r.follow.degrade, 'layered-not-advanced')
        assert.equal(r.follow.skippedLayers, 2, '没跑的层数如实记账——不假装计划完成')
        assert.equal(r.follow.spawned, 0)
    })
    test('§8/B1 层消费回执：spawn 成功后 onLayerSpawned 收到"剩余层"；写库炸不吞循环（layerAckFailed 留痕）', async () => {
        const orchPlan = [[{ title: 'L1', query: 'q1' }], [{ title: 'L2', query: 'q2' }]]
        const acks = []
        const h = harness({ all: [kid('a', 2)], action: ['synthesize', 'synthesize', 'synthesize'], cfg: { autoFollow: true, orchPlan } })
        h.deps.onLayerSpawned = async ({remaining}) => { acks.push(remaining.length) }
        const r = await runFollowLoop(h.deps)
        assert.deepEqual(acks, [1, 0], '第一层消费后剩 1，第二层消费后剩 0——恢复判据的写侧锚')
        // 回执失败：循环继续（下一层还推进），layerAckFailed 记数，不裸崩
        const h2 = harness({ all: [kid('a', 2)], action: ['synthesize', 'synthesize'], cfg: { autoFollow: true, orchPlan: [[{ title: 'L1', query: 'q1' }]] } })
        h2.deps.onLayerSpawned = async () => { throw new Error('写库炸') }
        const r2 = await runFollowLoop(h2.deps)
        assert.equal(r2.follow.layerAckFailed, 1)
        assert.equal(r2.follow.spawnedLayers, 1, '回执失败不吞已发生的层 spawn（事实账在 follow，恢复面靠帽防双跑）')
    })

    test('ON + 预算闸停在层推进 ⇒ budget-exhausted + skippedLayers，绝不裸预算 spawn', async () => {
        const orchPlan = [[{ title: 'L1', query: 'q1' }]]
        const deny = async () => ({ allow: false, degrade: 'single-agent', reason: 'budget: token 天花板已破', allowedSubtasks: 0 })
        const h = harness({ all: [kid('a', 2)], action: ['synthesize', 'synthesize'], cfg: { autoFollow: true, orchPlan }, budgetGate: deny })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.degrade, 'budget-exhausted')
        assert.equal(r.fin.action, 'report')
        assert.equal(r.follow.skippedLayers, 1)
        assert.deepEqual(h.spawned.filter((s) => s.kind === 'layer'), [], '闸在 spawn 前')
    })
    test('replan 换代带新 orchPlan ⇒ 旧残层作废接管（layerPlanReset 审计）', async () => {
        const h = harness({
            all: [boom('a')], action: ['replan', 'synthesize'],
            cfg: { autoFollow: true, plannerEnabled: true, orchPlan: [[{ title: '旧残层', query: 'old' }]] },
            replanPlan: { needFanOut: true, subtasks: [{ title: 'N', query: 'n1' }], orchPlan: [[{ title: '新层', query: 'n2' }]] },
        })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.layerPlanReset, 1)
        const ly = h.spawned.filter((s) => s.kind === 'layer')
        assert.equal(ly.length, 1); assert.equal(ly[0].title, '新层', '接的是新代计划，旧残层作废')
    })
    test('§8 交叉批：replan 新代**不带**分层计划 ⇒ 旧残层同样废弃（换代即清——全败的上游不配被继承）', async () => {
        const h = harness({
            all: [boom('a')], action: ['replan', 'synthesize'],
            cfg: { autoFollow: true, plannerEnabled: true, orchPlan: [[{ title: '旧残层', query: 'old' }]] },
            replanPlan: { needFanOut: true, subtasks: [{ title: 'N', query: 'n1' }] },
        })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.layerPlanReset, 1, '废弃计数在账')
        assert.deepEqual(h.spawned.filter((s) => s.kind === 'layer'), [], '旧残层绝不被 spawn——依赖的是这一代已全败的产出')
        assert.equal(r.fin.action, 'synthesize', '新代单层正常收口')
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

    // §7-3 预算降级事件源：循环只**留话**不发事件（发射资格与执行归接线位）
    test('replan 被预算闸拒（budget:* 话）⇒ budgetNote 留痕原话，specs 空降级 report 不空转', async () => {
        const h = harness({
            all: [boom('a')], action: ['replan', 'report'],
            cfg: { autoFollow: true, plannerEnabled: true },
            replanPlan: { ok: true, needFanOut: false, subtasks: [], reason: 'budget:no-headroom' },
        })
        const r = await runFollowLoop(h.deps)
        assert.deepEqual(r.follow.budgetNote, { degrade: 'single-agent', reason: 'budget:no-headroom', allowedSubtasks: 0 })
        assert.equal(r.fin.action, 'report', 'replan 空转不了：budgetNote 不改变降级 report 的既定形态')
    })

    test('budgetGate 拒本轮 spawn ⇒ budgetStop 记 planned/degrade/reason 原话并停追', async () => {
        const h = harness({ all: [kid('a', 2), boom('b')], action: ['retry'], cfg: { autoFollow: true } })
        h.deps.budgetGate = async () => ({ allow: false, degrade: 'single-agent', reason: 'over-ceiling', allowedSubtasks: 0 })
        const r = await runFollowLoop(h.deps)
        assert.equal(r.follow.budgetStop.reason, 'over-ceiling')
        assert.equal(r.follow.budgetStop.degrade, 'single-agent')
        assert.equal(r.follow.degrade, 'budget-exhausted')
        assert.equal(r.fin.action, 'report')
        assert.deepEqual(h.spawned, [], '闸停在一轮 spawn 之前——预算裸奔式重试被掐死')
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
