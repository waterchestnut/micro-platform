/**
 * @fileOverview POST /core/chat/stop 的路由级用例（PR-D 装配 commit 1）
 * @module test/routes/runStop
 * @description
 * 只断言**确定性**路径（同 messageAccess 的约定：整文件只 build 一次 app）。
 * 真"停掉一个在途 run"要活 run + 多副本环境，属 dev 探针窗口，不在这假做。
 * 最要紧的一条：**"不存在" 与 "不是你的" 必须不可区分**（同码同文案——本仓成文的防枚举纪律）。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const USER = {userCode: 'e2e-stop-probe-user', realName: '探针'}

test('/core/chat/stop 路由行为（默认关 + 防枚举）', async (t) => {
    const app = await build(t)
    const post = (payload, headers = {'user-info': b64(USER)}) => app.inject({method: 'POST', url: '/core/chat/stop', payload, headers})

    await t.test('缺身份 ⇒ 401（内部路径不默认已鉴权）', async () => {
        const res = await post({messageCode: 'm-x'}, {})
        assert.equal(res.statusCode, 401, res.payload)
    })

    await t.test('schema 把关：缺 messageCode ⇒ 400', async () => {
        const res = await post({})
        assert.equal(res.statusCode, 400, res.payload)
    })

    await t.test('默认关 ⇒ 明说未启用（4003），不是拒绝', async () => {
        const res = await post({messageCode: 'm-whatever'})
        assert.equal(res.statusCode, 200)
        const body = JSON.parse(res.payload)
        assert.equal(body.success, false)
        assert.equal(body.code, 4003, `关着应回"未启用"口径：${res.payload}`)
        assert.match(body.msg, /未启用/)
    })

    await t.test('开关开 + 幽灵号 ⇒ 与"不是你的"同码同文案（防枚举）', async () => {
        const RC = await import('../../services/core/session/runControl.js')
        const cfg = globalThis.llm.config.controlConfig
        cfg.stopEnabled = true
        try {
            const ghost = await post({messageCode: 'e2e-ghost-run-not-exist'})
            assert.equal(ghost.statusCode, 403, ghost.payload)
            const gb = JSON.parse(ghost.payload)
            assert.equal(gb.code, 4030)
            const other = await post({messageCode: 'e2e-stop-belongs-to-someone-else'})
            assert.equal(other.statusCode, 403)
            /** 防枚举的判据是**两种情形逐字同响应**（统一文案里并列列出"不存在/已结束/不属于你"是 grpcSkill 先例的正确做法） */
            assert.deepEqual(JSON.parse(other.payload), gb, '两种拒绝必须逐字同码同文案')
        } finally {
            cfg.stopEnabled = false
            RC.resetHandlesForTest()
        }
    })

    await t.test('查账故障 ⇒ 按"停止不了"回，不 500（治理件不许成为新故障源）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        cfg.stopEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        llmUsageDac.findProcessingByMessageCode = async () => { throw new Error('simulated db down') }
        try {
            const res = await post({messageCode: 'm-dbdown'})
            assert.equal(res.statusCode, 403, `查账失败应落"无法停止"而不是 500：${res.statusCode} ${res.payload}`)
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.stopEnabled = false
        }
    })
})
