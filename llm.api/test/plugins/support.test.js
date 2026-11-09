/**
 * @fileOverview plugins/support.js 的装饰器回归测试
 * @module test/plugins/support
 * @description
 * 原用例断言 `fastify.someSupport()`——那是 fastify-cli 模板自带的示例装饰器，
 * 本仓的 `plugins/support.js` 早已改成 `sysConfig` 与 `env`，`someSupport` 不存在。
 * 也就是说这个用例**长期是红的**，而它红着的时候，"全量测试全绿"的记录并不成立。
 * 现在断言真实存在的两个装饰器。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import Fastify from 'fastify'
import Support from '../../plugins/support.js'

test('support 装饰出 sysConfig 与 env', async () => {
    const fastify = Fastify()
    fastify.register(Support)

    await fastify.ready()

    assert.equal(typeof fastify.sysConfig, 'object', 'sysConfig 应是配置对象')
    assert.equal(typeof fastify.env, 'function', 'env 应是函数')
    assert.ok(['development', 'production'].includes(fastify.env()), `env() 返回值异常：${fastify.env()}`)
    // 与配置源一致，而不是硬编码期望值
    assert.equal(fastify.env(), fastify.sysConfig.debug ? 'development' : 'production')

    await fastify.close()
})
