/**
 * @fileOverview /core/message/tool-result 的确定性拒绝路径
 * @module test/routes/messageToolResult
 * @description
 * 只断言**不依赖库里具体数据**的四条：缺身份 401、缺 ref 400、messageCode 不存在 404、
 * 以及"拒绝与不存在的对外码同形"这一条能离线确定的部分（同一句文案）。
 *
 * **本文件只 build 一次 app**（`plugins/lifecycle.js` 的 onClose 会释放共享的 mongo/redis 连接，
 * 同进程第二次 build 拿到的是已关闭连接 ⇒ `Client must be connected`）。见 messageAccess.test.js 头。
 *
 * 覆盖不到、也不假装覆盖的一条：**"存在但不属于你"也回 404**。它需要一个真实的别人的 messageCode，
 * 本地测试库里没有可依赖的这种数据 ⇒ 该分支由 dev 现网探针核（`tool-result-probe.mjs`
 * 只取别人的 messageCode 与 ref、不取正文），这里留话而不是拿假数据凑绿。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const GUEST = {userCode: 'e2e-nonexistent-user-000000', realName: '探针'}

test('/core/message/tool-result 的拒绝路径', async (t) => {
    const app = await build(t)

    await t.test('无身份 ⇒ 401，不是 500', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/tool-result',
            payload: {messageCode: 'no-such-code', ref: 'no-such-ref'},
        })
        assert.equal(res.statusCode, 401, `无身份应是 401，实际 ${res.statusCode}：${res.payload}`)
        assert.match(JSON.parse(res.payload).msg, /userCode|身份/)
    })

    await t.test('缺 ref ⇒ 400（schema 的 required 真的在挡）', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/tool-result',
            headers: {'user-info': b64(GUEST)},
            payload: {messageCode: 'no-such-code'},
        })
        assert.equal(res.statusCode, 400, `缺必填应是 400，实际 ${res.statusCode}：${res.payload}`)
    })

    await t.test('messageCode 不存在 ⇒ 404（先判身份，再判存在性）', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/tool-result',
            headers: {'user-info': b64(GUEST)},
            payload: {messageCode: 'e2e-does-not-exist-' + Date.now(), ref: 'r-1'},
        })
        assert.equal(res.statusCode, 404, `未知标识应是 404，实际 ${res.statusCode}：${res.payload}`)
        assert.match(JSON.parse(res.payload).msg, /消息不存在/)
    })

    await t.test('留档不存在 ⇒ 404，且文案指出"未裁剪的结果在 result 里"', async () => {
        /**
         * 这一条与上一条同码，但走的是**不同分支**（前者是行查不到，这里是行在、ref 查不到）。
         * 现在还不能在这里造出"行在"的数据，所以断言的是判据本身：
         * `buildToolResultPayload` 在无 entry 时给的码必须是 404 —— 两个分支同码由纯函数与路由各钉一半。
         */
        const {buildToolResultPayload} = await import('../../tools/overflow.js')
        const r = buildToolResultPayload({entry: null, ref: 'x'})
        assert.equal(r.statusCode, 404)
        assert.ok(r.error.includes('留档'))
    })
})
