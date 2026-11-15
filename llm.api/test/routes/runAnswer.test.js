/**
 * @fileOverview POST /core/chat/answer 的路由级用例（PR-E 装配 commit 3）
 * @module test/routes/runAnswer
 * @description
 * 同 runStop/runSteer 的约定：整文件只 build 一次 app，只断言确定性路径。
 * 最要紧的三条：
 * ①requestState 是唯一入口凭证——**开不了的串与"不是你的 run"同一条 403**（防枚举成文纪律在凭证面的推广）；
 * ②body 里没有任何字段能指定投递目标（runCode 只能来自密封串）——把"给别人的 run 投答复"这条路
 *   在协议面上就焊死，而不是靠运行时校验；
 * ③真投递要活的 run 侧 router 才见分晓，路由只承诺"已投递"（先到先得的裁决在 run 侧）。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const USER = {userCode: 'e2e-answer-probe-user', realName: '答复探针'}

test('/core/chat/answer 路由行为（凭证即入口、防枚举、不承诺裁决）', async (t) => {
    const app = await build(t)
    const post = (payload, headers = {'user-info': b64(USER)}) => app.inject({method: 'POST', url: '/core/chat/answer', payload, headers})

    await t.test('缺身份 ⇒ 401', async () => {
        assert.equal((await post({requestState: 'x', inputResponses: {}}, {})).statusCode, 401)
    })
    await t.test('schema：缺 requestState 或缺 inputResponses ⇒ 400', async () => {
        assert.equal((await post({inputResponses: {}})).statusCode, 400)
        assert.equal((await post({requestState: 'blob'})).statusCode, 400)
    })
    await t.test('默认关 ⇒ 4003 明说未启用', async () => {
        const res = await post({requestState: 'blob', inputResponses: {}})
        const body = JSON.parse(res.payload)
        assert.equal(res.statusCode, 200)
        assert.equal(body.code, 4003, res.payload)
        assert.match(body.msg, /未启用/)
    })
    await t.test('开关开：坏凭证 与 他人 run 逐字同 403（凭证面的防枚举）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        cfg.askEnabled = true
        try {
            const junk = await post({requestState: 'not-a-valid-blob', inputResponses: {plan: 'A'}})
            assert.equal(junk.statusCode, 403, junk.payload)
            /** 自造一个"签名正确但 run 不归你"的串：密钥就是本进程的 cookieSecret，测试走真 open/真查账 */
            const MP = await import('../../services/core/session/mrtrPayload.js')
            const AT = await import('../../services/core/session/askUserTool.js')
            const sec = AT.answerSecret()
            if (!sec) {
                t.skip('cookieSecret 未配置（dev 环境该值应存在）——自造串无意义')
                return
            }
            const forged = MP.sealRequestState({runCode: 'e2e-run-belongs-to-other', askId: 'a-1', kind: 'question'}, {secret: sec})
            const other = await post({requestState: forged, inputResponses: {plan: 'A'}})
            assert.equal(other.statusCode, 403, other.payload)
            assert.deepEqual(JSON.parse(other.payload), JSON.parse(junk.payload), '两种被拒必须不可区分')
        } finally {
            cfg.askEnabled = false
        }
    })
    await t.test('查账故障 ⇒ 同文案 403 不 500（治理件不许成为新故障源）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        const AT = await import('../../services/core/session/askUserTool.js')
        const MP = await import('../../services/core/session/mrtrPayload.js')
        const sec = AT.answerSecret()
        cfg.askEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        try {
            const sealed = MP.sealRequestState({runCode: 'e2e-run-dbdown', askId: 'a-1', kind: 'question'}, {secret: sec || 'x'})
            llmUsageDac.findProcessingByMessageCode = async () => { throw new Error('simulated db down') }
            const res = await post({requestState: sealed, inputResponses: {}})
            assert.equal(res.statusCode, 403, `${res.statusCode} ${res.payload}`)
            const rb = JSON.parse(res.payload)
            assert.equal(rb.code, 4030)
            assert.equal(rb.msg, '无法处理该答复：凭证无效、已被使用或不属于当前用户', '查账故障走同一条拒案（不 500、不解释内部原因）')
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.askEnabled = false
        }
    })
    await t.test('owner 匹配 ⇒ 走投递：只承诺"已投递"，裁决推给该轮工具结果（success 与 4003 都如实）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        const AT = await import('../../services/core/session/askUserTool.js')
        const MP = await import('../../services/core/session/mrtrPayload.js')
        const sec = AT.answerSecret()
        cfg.askEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        llmUsageDac.findProcessingByMessageCode = async (mc) => ({messageCode: mc, userCode: USER.userCode})
        try {
            const sealed = MP.sealRequestState({runCode: 'e2e-owned-run', askId: 'a-7', kind: 'question'}, {secret: sec})
            const res = await post({requestState: sealed, inputResponses: {plan: 'A'}})
            const body = JSON.parse(res.payload)
            if (body.success === false) {
                assert.equal(body.code, 4003, `投递失败如实回：${res.payload}`)
                assert.match(body.msg, /未能投递/)
            } else {
                assert.equal(res.statusCode, 200, res.payload)
                assert.equal(body.data.askId, 'a-7')
                assert.equal(body.data.delivered, 'broadcast')
                assert.match(body.data.note, /先到先得|以该轮工具结果为准/, '响应不许承诺"你的答复被采用了"')
            }
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.askEnabled = false
        }
    })
})
