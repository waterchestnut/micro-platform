/**
 * @fileOverview /core/chat/completion（R8 订阅接入非交互档）的拒绝路径与接线锚
 * @module test/routes/chatCompletion
 * @description
 * 确定性路径集成：401（无身份，先于执行）、400（未配置频道）——两条都不触达 execChat，
 * 不烧模型配额；聚合成功路径（真跑 execChat）不在本文件断言，由源码锚钉接线形状：
 * 无 streamCallback（非交互档的定义特征）、messageCode 透传、aborted 防御、异常补档同线。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const GUEST = {userCode: 'e2e-nonexistent-user-000000', realName: '探针'}

test('/core/chat/completion 拒绝路径', async (t) => {
    const app = await build(t)
    const body = {query: '探针问题', conversationCode: 'completion-probe-0001', options: {}}

    await t.test('无 user-info 头 → 401（与 /stream 同身份线）', async () => {
        const res = await app.inject({method: 'POST', url: '/core/chat/completion', payload: body})
        assert.equal(res.statusCode, 401, `缺身份应 401，实际 ${res.statusCode}：${res.payload}`)
    })

    await t.test('未配置的频道 → 400（与 /stream 同频道校验线）', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/chat/completion',
            headers: {'user-info': b64(GUEST)},
            payload: {query: 'x', conversationCode: 'completion-probe-0002', options: {channel: 'no_such_channel_zzz'}},
        })
        assert.equal(res.statusCode, 400, `非法频道应 400，实际 ${res.statusCode}：${res.payload}`)
        assert.match(JSON.parse(res.payload).msg || '', /频道/)
    })

    await t.test('body schema 复用 chatStreamBodySchema（conversationCode 必填方言一致）', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/chat/completion',
            headers: {'user-info': b64(GUEST)},
            payload: {query: 'x'},
        })
        assert.equal(res.statusCode, 400, `缺 conversationCode 应被 schema 400：${res.payload}`)
    })
})

test('/core/chat/completion 接线锚（源码级，非交互档的定义特征不许悄悄长出流）', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const route = fs.readFileSync(path.join(here, '../../routes/core/chat/root.js'), 'utf8').replace(/\r/g, '')
    const start = route.indexOf("fastify.post('/completion'")
    assert.ok(start > 0, 'completion 路由在位')
    const block = route.slice(start, route.indexOf("fastify.post('/stream'", start))

    assert.ok(block.includes('execChat(request.userInfo'), '执行入口单源=execChat（不另造第二套主循环）')
    assert.ok(!/streamCallback\s*:/.test(block), '非交互档：绝不传 streamCallback（传了=长出第二条 SSE 线）')
    assert.ok(!block.includes('createSseChannel'), '非交互档：不建 SSE 通道')
    assert.ok(!block.includes('admitRun'), '非交互档：不接 chat 并发闸（cron 短任务，边界入账）')
    assert.ok(block.includes('messageCode'), 'messageCode 透传（调用方对账锚 + 档案同键）')
    assert.ok(block.includes("!== 'aborted'"), 'aborted 终态防御在位')
    assert.ok(block.includes('archiveUncaughtErrorTurn'), '异常补档与 /stream 同线（服务端调用炸了档案也要能回查）')
    assert.ok(block.includes('auditBody'), '未声明字段观测与 /stream 同线')
})
