/**
 * @fileOverview 根路由的响应形态测试
 * @module test/routes/root
 * @description
 * 原用例断言响应体就是 `{root:true}`，但 `plugins/format-reply.js` 的 `preSerialization`
 * 会把所有返回值统一包装成 `{data, statusCode, code}`，因此该用例长期为红。
 * 这里断言**真实契约**：包装后的信封 + 原始载荷。信封形态是前端解析的前提，
 * 值得用一条测试钉住，而不是靠约定俗成。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

test('default root route', async (t) => {
    const app = await build(t)

    const res = await app.inject({
        url: '/',
    })

    assert.equal(res.statusCode, 200)
    assert.deepStrictEqual(JSON.parse(res.payload), {
        data: {root: true},
        statusCode: 200,
        code: 0,
    }, '根路由应返回统一响应信封 {data, statusCode, code}')
})
