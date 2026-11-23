/**
 * @fileOverview /runStats 的身份校验与读数字段
 * @module test/routes/runStats
 * @description
 * 这条校验是补 v1.40 记下的纵深防御缺口：网关确实拦了无凭据请求（实测 `code:4002 token无效`），
 * 但**内部路径不能当成已鉴权**（D57）——集群里任意 pod 直连 12008 原本可以匿名读到
 * 闸的 limit/active/rejected 与抢救表。补掉它的同时，也必须让自家工具跟着改，
 * 否则就是"用缺陷当便利"：缺陷一修，探针集体变红。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const ui = Buffer.from(JSON.stringify({userCode: 'sim-runstats', realName: '路由测试'})).toString('base64')

test('/runStats 无身份 ⇒ 401，且不泄漏任何计数', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST',
        url: '/core/chat/runStats',
        payload: {},
    })
    assert.equal(res.statusCode, 401, `期望 401，实际 ${res.statusCode}: ${res.payload}`)
    const body = JSON.parse(res.payload)
    /** 拒绝响应里不能顺手把 limit/active 带出去——那正是我们要收口的东西 */
    assert.equal(body.data?.limit, undefined, '401 的响应体里不该有闸配置')
    assert.equal(body.data?.archiving, undefined, '401 的响应体里不该有抢救表长度')
})

test('/runStats 有身份 ⇒ 200，字段包含闸、抢救表与停机状态', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST',
        url: '/core/chat/runStats',
        headers: {'user-info': ui},
        payload: {},
    })
    assert.equal(res.statusCode, 200, `期望 200，实际 ${res.statusCode}: ${res.payload}`)
    const d = JSON.parse(res.payload).data
    /**
     * 断言这些键**存在**而不是断言具体数值：数值取决于当下有没有在途 run，
     * 断言数值会把测试变成时钟的奴隶（本仓已经因为这类断言返工过多次）。
     */
    for (const k of ['active', 'archiving', 'accountingGap', 'limit', 'perUserLimit', 'gateEnabled', 'shutdown']) {
        assert.ok(Object.prototype.hasOwnProperty.call(d, k), `响应缺字段 ${k}：${JSON.stringify(d)}`)
    }
    assert.equal(typeof d.shutdown.closing, 'boolean', '停机状态必须是布尔：运维要能不看代码就判断进程是否正在关闭')
    assert.ok(typeof d.archiving === 'number', 'archiving 必须是数字：闸关着时它是抢救能力的唯一可见证据')
})

test('/runStats credits 计价面：configured/pricedActive/effective/issues 四件套在账（汇率批上线的确认面）', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST', url: '/core/chat/runStats',
        headers: {'user-info': ui}, payload: {},
    })
    const d = JSON.parse(res.payload).data
    const cw = d.creditsWeights
    assert.ok(cw && typeof cw === 'object', `creditsWeights 面缺席：${JSON.stringify(d).slice(0, 200)}`)
    assert.equal(typeof cw.configured, 'boolean', '配没配权重必须是布尔——priced 的因')
    assert.equal(typeof cw.pricedActive, 'boolean', '归一后是否生效必须是布尔——priced 的果')
    assert.ok(Array.isArray(cw.issues), '坏项清单必须是数组：剔了什么要能查到，不静默')
    // 测试环境未配权重 ⇒ 两面一致地"未计价"（configured=false 且 pricedActive=false）
    assert.equal(cw.configured, false)
    assert.equal(cw.pricedActive, false)
})

test('/runStats taskEvents 面：enabled/keyPrefix/maxEvents/ttlSec/eventDb/钳位在账（批⑤观测——flag 状态一眼确认，分不清"没开"和"没流量"的时代结束）', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST', url: '/core/chat/runStats',
        headers: {'user-info': ui}, payload: {},
    })
    const d = JSON.parse(res.payload).data
    const te = d.taskEvents
    assert.ok(te && typeof te === 'object', `taskEvents 面缺席：${JSON.stringify(d).slice(0, 200)}`)
    assert.equal(typeof te.enabled, 'boolean', '开没开必须是布尔')
    assert.equal(te.keyPrefix, 'llmtask:events', '键前缀缺省必须与服务端镜像件一致（双源会分叉）')
    assert.equal(te.subscribeWaitMaxMs, 5000, '钳位声明与 TASK_EVENT_WAIT_MAX_MS 同源')
    // 测试环境未配 env ⇒ enabled=false、eventDb 走缺省 12（三库分立的默认读数）
    assert.equal(te.enabled, false)
    assert.equal(te.eventDb, 12)
    // emit 活动计数（分诊单）：五计数在账且类型为数
    assert.ok(te.emit && typeof te.emit === 'object', 'emit 计数缺席——"没走到/写坏/在发"三形态又分不开了')
    for (const k of ['calls', 'emitted', 'failed', 'disabled', 'closed']) {
        assert.equal(typeof te.emit[k], 'number', `emit.${k} 必须是数（分诊靠它）`)
    }
})

test('/runStats orchestration 面：编排七开关齐报且类型严（批⑧观测——env 没铺到 vs 铺了没流量，一眼分诊）', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST', url: '/core/chat/runStats',
        headers: {'user-info': ui}, payload: {},
    })
    const d = JSON.parse(res.payload).data
    const oa = d.orchestration
    assert.ok(oa && typeof oa === 'object', `orchestration 面缺席：${JSON.stringify(d).slice(0, 200)}`)
    for (const k of ['enabled', 'autoFollow', 'layered', 'plannerEnabled']) {
        assert.equal(typeof oa[k], 'boolean', `orchestration.${k} 必须是布尔`)
    }
    assert.ok(['kafka', 'direct'].includes(oa.dispatch), 'dispatch 只许 kafka|direct 二值')
    assert.equal(typeof oa.synthGraceMs, 'number')
    assert.ok(oa.followSpawnCap > 0, '保险帽必须为正数（缺省 8）')
    // 测试环境无 env ⇒ 全默认关（开闸批的"关=现网"零漂移读数的面证明）
    assert.equal(oa.enabled, false); assert.equal(oa.layered, false); assert.equal(oa.autoFollow, false)
})

test('/runStats featureCatalog 面：enabled 布尔 + enabledChannels 数组 + 缺省全关（P6-dev 观测——env 没铺到 vs 铺了没人用一眼分诊）', async (t) => {
    const app = await build(t)
    const res = await app.inject({
        method: 'POST', url: '/core/chat/runStats',
        headers: {'user-info': ui}, payload: {},
    })
    const d = JSON.parse(res.payload).data
    const fc = d.featureCatalog
    assert.ok(fc && typeof fc === 'object', `featureCatalog 面缺席：${JSON.stringify(d).slice(0, 200)}`)
    assert.equal(typeof fc.enabled, 'boolean', 'featureCatalog.enabled 必须布尔')
    assert.ok(Array.isArray(fc.enabledChannels), 'enabledChannels 必须数组（W9：不硬编频道，读数面如实报配了哪些）')
    assert.equal(typeof fc.mainClientCode, 'string', 'mainClientCode 必须串（N1 部署实测值，缺省空）')
    assert.ok(fc.searchTopK > 0, 'searchTopK 正数（缺省 5）')
    // 测试环境无 env ⇒ 缺省全关（"关=现网零影响"读数面）
    assert.equal(fc.enabled, false)
    assert.deepEqual(fc.enabledChannels, [])
})
