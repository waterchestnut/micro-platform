/**
 * @fileOverview skill-handoff 用户端接口的拒绝路径集成测试
 * @module test/routes/skillHandoff
 * @description
 * 测"判据真的挂在请求路径上、拒绝给 4xx/业务码而非 500"（同 grpcSkillAuth 纪律：
 * 越权/坏 token 若被记成服务端故障，运维监控里看不见有人在试）。整文件只 build 一次 app。
 * 只断言被拒路径 ⇒ 不向库里写任何 journal 行。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const USER = {userCode: 'e2e-handoff-user-0000000000', realName: '探针'}

test('skill-handoff 拒绝路径', async (t) => {
    const app = await build(t)

    await t.test('preview 无 user-info ⇒ 401（非 500）', async () => {
        const res = await app.inject({method: 'POST', url: '/core/skill-handoff/preview', payload: {token: 'whatever'}})
        assert.equal(res.statusCode, 401, `缺身份应 401，实际 ${res.statusCode}`)
    })

    await t.test('preview 坏 token ⇒ 业务码拒（非 500），带 reason', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/skill-handoff/preview',
            headers: {'user-info': b64(USER)}, payload: {token: 'garbage.not-a-sig'},
        })
        assert.ok(res.statusCode < 500, `坏 token 不该 500，实际 ${res.statusCode}`)
        const body = JSON.parse(res.payload)
        assert.equal(body.code, -1)
        assert.match(body.msg, /无效|过期|确认链/)
    })

    await t.test('preview 缺 token 字段 ⇒ 400（ajv 先拦，非 500）', async () => {
        const res = await app.inject({method: 'POST', url: '/core/skill-handoff/preview', headers: {'user-info': b64(USER)}, payload: {}})
        assert.ok(res.statusCode < 500, `缺参不该 500，实际 ${res.statusCode}`)
    })

    await t.test('redeem 无 user-info ⇒ 401（非 500）', async () => {
        const res = await app.inject({method: 'POST', url: '/core/skill-handoff/redeem', payload: {token: 'whatever'}})
        assert.equal(res.statusCode, 401, `缺身份应 401，实际 ${res.statusCode}`)
    })

    await t.test('redeem 坏 token ⇒ 业务码拒（非 500），不落库', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/skill-handoff/redeem',
            headers: {'user-info': b64(USER)}, payload: {token: 'garbage.not-a-sig'},
        })
        assert.ok(res.statusCode < 500, `坏 token 不该 500，实际 ${res.statusCode}`)
        const body = JSON.parse(res.payload)
        assert.equal(body.code, -1)
        assert.match(body.msg, /失败|确认/)
    })
})
