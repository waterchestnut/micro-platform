/**
 * @fileOverview POST /core/chat/steer 的路由级用例（PR-D 装配 commit 2）
 * @module test/routes/runSteer
 * @description
 * 同 runStop/messageAccess 的约定：整文件只 build 一次 app，只断言确定性路径。
 * 本文件最要紧的三条：
 * ①防枚举与 /stop 同纪律（两个幽灵号逐字同响应）；
 * ②**判序**：坏 text 也查不到"存在性"信号——归属核验在内容校验之前（先内容后归属=空文本探测器）；
 * ③说话人不可冒充：路由只从 body 取 messageCode/text/mode/steerCode，身份字段一律取 `request.userInfo`
 *   （ESM 冻结导出没法 monkey-patch 投递侧，这条钉在接线源码锚 `steerWiringAnchors` 里）。
 * 真"注入到一次活的迭代边界"要活 run + 多副本，属 dev 窗口，不在这假做。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const USER = {userCode: 'e2e-steer-probe-user', realName: '插话探针'}

test('/core/chat/steer 路由行为（默认关 + 防枚举 + 身份覆盖）', async (t) => {
    const app = await build(t)
    const post = (payload, headers = {'user-info': b64(USER)}) => app.inject({method: 'POST', url: '/core/chat/steer', payload, headers})

    await t.test('缺身份 ⇒ 401（内部路径不默认已鉴权）', async () => {
        const res = await post({messageCode: 'm-x', text: '嗨'}, {})
        assert.equal(res.statusCode, 401, res.payload)
    })

    await t.test('schema 把关：缺 text 或缺 messageCode ⇒ 400', async () => {
        assert.equal((await post({messageCode: 'm-1'})).statusCode, 400)
        assert.equal((await post({text: '嗨'})).statusCode, 400)
    })

    await t.test('默认关 ⇒ 4003 明说未启用（配置问题不伪装成权限问题）', async () => {
        const res = await post({messageCode: 'm-whatever', text: '嗨'})
        assert.equal(res.statusCode, 200)
        const body = JSON.parse(res.payload)
        assert.equal(body.success, false)
        assert.equal(body.code, 4003, res.payload)
        assert.match(body.msg, /未启用/)
    })

    await t.test('开关开 + 两个幽灵号 ⇒ 逐字同 403（防枚举与 /stop 同纪律）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        cfg.steerEnabled = true
        try {
            const g1 = await post({messageCode: 'e2e-ghost-steer-a', text: '嗨'})
            const g2 = await post({messageCode: 'e2e-ghost-steer-b', text: '嗨'})
            assert.equal(g1.statusCode, 403, g1.payload)
            assert.deepEqual(JSON.parse(g2.payload), JSON.parse(g1.payload), '两种被拒情形必须不可区分')
            assert.equal(JSON.parse(g1.payload).code, 4030)
            /** 归属在前、内容在后：坏 text 的幽灵号也只能拿到 403，拿不到 400 的存在性信号 */
            const bad = await post({messageCode: 'e2e-ghost-steer-a', text: '   '})
            assert.equal(bad.statusCode, 403, `判序错位：坏内容不该泄露归属核验的结果：${bad.payload}`)
            /** mode 非法同样被 mailbox 闸拒（从严纠错的裁定在路由上也成立） */
            const evil = await post({messageCode: 'e2e-ghost-steer-a', text: '嗨', mode: 'yolo'})
            assert.equal(evil.statusCode, 403, evil.payload)
        } finally {
            cfg.steerEnabled = false
        }
    })

    await t.test('查账故障 ⇒ 同文案 403 不 500（治理件不许成为新故障源）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        cfg.steerEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        llmUsageDac.findProcessingByMessageCode = async () => { throw new Error('simulated db down') }
        try {
            const res = await post({messageCode: 'm-dbdown', text: '嗨'})
            assert.equal(res.statusCode, 403, `${res.statusCode} ${res.payload}`)
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.steerEnabled = false
        }
    })

    await t.test('hard 未开闸 ⇒ 400 从严拒（不降级成 soft）；开闸后与 soft 同一条投递路', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        cfg.steerEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        llmUsageDac.findProcessingByMessageCode = async (mc) => ({messageCode: mc, userCode: USER.userCode})
        try {
            cfg.hardSteerEnabled = false
            const off = await post({messageCode: 'e2e-owned-run', text: '停一下听我说', mode: 'hard'})
            assert.equal(off.statusCode, 400, `hard 关着必须明拒：${off.payload}`)
            const ob = JSON.parse(off.payload)
            assert.match(ob.msg, /hard 插话未启用/)
            assert.match(ob.msg, /未入队/, '文案要说清"这条没进去"，不许让用户以为排队了')
            /** soft 同参数必须照走（拒的是 hard 不是整条链） */
            const soft = await post({messageCode: 'e2e-owned-run', text: '停一下听我说', mode: 'soft'})
            assert.ok(soft.statusCode === 200 && JSON.parse(soft.payload).code !== 4000, `soft 不该被 hard 闸连坐：${soft.payload}`)
            cfg.hardSteerEnabled = true
            const on = await post({messageCode: 'e2e-owned-run', text: '停一下听我说', mode: 'hard'})
            const nb = JSON.parse(on.payload)
            if (nb.success === false) {
                assert.equal(nb.code, 4003, `开闸后只剩通道问题：${on.payload}`)
            } else {
                assert.equal(on.statusCode, 200, on.payload)
            }
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.steerEnabled = false
            cfg.hardSteerEnabled = false
        }
    })

    await t.test('归属过了才谈投递：假账本放行后走真 publishSteer，两种结局都必须如实（不 500、不撒谎）', async () => {
        const cfg = globalThis.llm.config.controlConfig
        const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
        cfg.steerEnabled = true
        const orig = llmUsageDac.findProcessingByMessageCode
        llmUsageDac.findProcessingByMessageCode = async (mc) => ({messageCode: mc, userCode: USER.userCode})
        try {
            const res = await post({messageCode: 'e2e-owned-run', text: '换成表格\n立刻', mode: 'SOFT', userCode: 'someone-else', realName: '冒充者'})
            const body = JSON.parse(res.payload)
            if (body.success === false) {
                assert.equal(res.statusCode, 200, `投递失败该如实回 200+4003 而不是 ${res.statusCode}`)
                assert.equal(body.code, 4003, res.payload)
                assert.match(body.msg, /未能投递/)
            } else {
                assert.equal(res.statusCode, 200, res.payload)
                assert.equal(body.data.messageCode, 'e2e-owned-run')
                assert.equal(body.data.delivered, 'broadcast')
                assert.match(body.data.note, /steer_ack/, '响应文案必须把"注入与否"推给事件，不许承诺生效')
            }
        } finally {
            llmUsageDac.findProcessingByMessageCode = orig
            cfg.steerEnabled = false
        }
    })
})
