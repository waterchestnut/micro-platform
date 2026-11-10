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
