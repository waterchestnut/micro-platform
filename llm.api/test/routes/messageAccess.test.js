/**
 * @fileOverview /core/message/list 的可见性拒绝路径集成测试
 * @module test/routes/messageAccess
 * @description
 * 只断言**确定性**的三条路径，不依赖库里具体有哪些会话：
 * - 无身份 → 401（此前是裸 throw ⇒ 500，把越权探测伪装成服务异常）
 * - 查询不属于自己的会话 → 403
 * - 空 filter → 200 但 total=0（收敛而不是返回全站）
 *
 * **为什么整个文件只 build 一次 app**：`plugins/lifecycle.js` 在 `onClose` 里会释放
 * 模块级共享的 mongodb 连接与 Redis 客户端；而 `daos/core/schema/index.js` 是顶层
 * `await createConnection` 的单例。同一进程内第二次 build 会拿到已关闭的连接，
 * 报 `Client must be connected before running operations`。
 * 生产不受影响（一进程一实例，close 后即退出；fastify-cli `-w` 与 PM2 都是重启进程）。
 * ⇒ **约定：需要多个 app 实例的测试请分文件，不要在一个文件里多次 build。**
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const GUEST = {userCode: 'e2e-nonexistent-user-000000', realName: '探针'}

test('/core/message/list 可见性拒绝路径', async (t) => {
    const app = await build(t)

    await t.test('无 user-info 头时返回 401，不是 500', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/list',
            payload: {filter: {}, pageIndex: 1, pageSize: 5},
        })
        assert.equal(res.statusCode, 401, `缺身份应是 401，实际 ${res.statusCode}：${res.payload}`)
        const body = JSON.parse(res.payload)
        assert.equal(body.code, -1)
        assert.match(body.msg, /userCode|身份/)
    })

    await t.test('查询不属于当前用户的会话时返回 403，不是 500', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/list',
            headers: {'user-info': b64(GUEST)},
            payload: {filter: {conversationCode: 'some-other-users-conversation'}, pageIndex: 1, pageSize: 5},
        })
        assert.equal(res.statusCode, 403, `越权应是 403，实际 ${res.statusCode}：${res.payload}`)
        assert.match(JSON.parse(res.payload).msg, /无权/)
    })

    await t.test('空 filter 被收敛：无可见会话的用户得到 0 条而不是全站数据', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/core/message/list',
            headers: {'user-info': b64(GUEST)},
            payload: {filter: {}, pageIndex: 1, pageSize: 5},
        })
        assert.equal(res.statusCode, 200, `应正常返回空集，实际 ${res.statusCode}：${res.payload}`)
        const body = JSON.parse(res.payload)
        assert.equal(body.data.total, 0)
        assert.deepEqual(body.data.rows, [])
    })
})
