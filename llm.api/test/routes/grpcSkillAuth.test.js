/**
 * @fileOverview 远程技能治理的拒绝路径集成测试（PR-E0.1 ①③④ 的真机读数）
 * @module test/routes/grpcSkillAuth
 * @description
 * 纯函数测的是判据本身；这个文件测的是**判据真的挂在了请求路径上**，并且给出的是 4xx 而不是 500。
 * 后者值得单独测，因为本仓有一条成文纪律（`messageAccess.test.js:46`、§2D.2）：
 * "拒绝被记成服务端故障"会把越权探测伪装成异常，运维在监控里看不见有人在试。
 *
 * 约定同 `messageAccess.test.js`：**整个文件只 build 一次 app**
 * （`daos/core/schema/index.js` 是顶层 await 的连接单例，第二次 build 会拿到已关闭的连接）。
 *
 * 这些用例都断言"被拒"，所以**不会向库里写任何技能**：权限检查在任何写库之前，
 * dev 的 `grpcSkill_adminUserCodes` 默认为空 ⇒ 任何 userCode 在这里都是非管理员。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {build} from '../helper.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const OUTSIDER = {userCode: 'e2e-non-admin-user-0000000000', realName: '探针'}

/** 一份"结构上合法"的注册载荷：让请求走到权限判定，而不是先被 ajv 挡在 400 */
const VALID_BODY = {
    /** `GrpcSkill` 的 schema 把 skillCode 标了 required（服务层其实会自己生成），
     *  所以载荷必须带上它——这是**既有契约**，本次不动它，只在测试里如实满足 */
    skillCode: 'e2e-probe-skill-code-0000000000000000',
    skillName: 'e2e-probe-skill',
    skillMD: [
        '---',
        'name: e2e-probe-skill',
        'description: 探针技能 (v1)',
        'author: xxzx',
        'version: 1.0.0',
        'tags: [probe]',
        '---',
        '',
        '# 探针技能',
        '',
        '## When to Use This Skill',
        '仅用于自动化测试。',
        '',
        '## Instructions',
        '不做任何事。',
        '',
    ].join('\n'),
    grpcHost: 'ucenter-grpc.online:13001',
    clientCode: 'xxzx',
    channels: ['xxzx_common'],
}

test('远程技能写入口的拒绝路径', async (t) => {
    const app = await build(t)

    await t.test('无 user-info 头注册技能 ⇒ 401（不是 500）', async () => {
        const res = await app.inject({method: 'POST', url: '/core/grpc-skill/add', payload: VALID_BODY})
        assert.equal(res.statusCode, 401, `缺身份应是 401，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        const body = JSON.parse(res.payload)
        assert.equal(body.code, -1)
        assert.match(body.msg, /userCode|身份/)
    })

    await t.test('非管理员注册 ⇒ 403，且不是 500、不是 200', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/grpc-skill/add',
            headers: {'user-info': b64(OUTSIDER)}, payload: VALID_BODY,
        })
        assert.equal(res.statusCode, 403, `非管理员注册应 403，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        assert.match(JSON.parse(res.payload).msg, /管理员|无权/)
    })

    /**
     * 这条测的是**顺序**：内容校验（格式、白名单、注入扫描）必须排在权限之后。
     * 反过来的话，任何登录用户都能用"格式错误的注册请求"把校验规则一条条试出来
     * （错误信息不同 = 免费的规则指纹），而这次修的正是要把注册面收给管理员。
     */
    await t.test('非管理员 + 内容非法 ⇒ 仍然是 403，不是内容错误（权限先行，不给陌生人反馈格式）', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/grpc-skill/add',
            headers: {'user-info': b64(OUTSIDER)},
            payload: {...VALID_BODY, skillMD: '没有 frontmatter 也没有章节', grpcHost: 'http://evil.example'},
        })
        assert.equal(res.statusCode, 403, `应先在权限处拒掉，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        assert.ok(!/frontmatter|YAML/i.test(res.payload), `响应里泄露了内容校验的细节：${res.payload.slice(0, 160)}`)
    })

    await t.test('审核入口（作者不能自批）：非管理员调 review ⇒ 403', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/grpc-skill/ipmi/review',
            headers: {'user-info': b64(OUTSIDER)},
            payload: {skillCode: 'e2e-nonexistent-skill-code', to: 'approved'},
        })
        assert.equal(res.statusCode, 403, `实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        /**
         * 这条断言测的是**顺序**：非管理员拿一个不存在的 skillCode 也必须得到 403，
         * 不能因为"技能不存在"先报错而变成 404/500 —— 那样状态码就成了存在性预言机，
         * 陌生人可以拿它把库里有哪些技能一个个问出来。上一版正是这个形状（实测 500）。
         */
        assert.ok(!/不存在/.test(res.payload), `响应泄露了"技能不存在"，等于给了存在性反馈：${res.payload.slice(0, 160)}`)
    })

    await t.test('审核目标态非法 ⇒ 在 schema 层就挡掉（400），根本不进服务', async () => {
        const res = await app.inject({
            method: 'POST', url: '/core/grpc-skill/ipmi/review',
            headers: {'user-info': b64(OUTSIDER)},
            payload: {skillCode: 'e2e-nonexistent-skill-code', to: 'pending'},
        })
        /**
         * 期望 400 而不是 403：`to` 的 enum 在**路由 schema** 里就写死了三个合法值，
         * 所以非法目标态根本走不到服务层。服务层那条 `invalid-target` 判定仍然存在
         * （`skillGovernance.test.js` 里有用例），它是纵深防御，不是第一道门。
         */
        assert.equal(res.statusCode, 400, `非法目标态应在 schema 层挡掉，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        assert.ok(!/不存在/.test(res.payload), '非法目标态也不该泄露技能是否存在')
    })

    /**
     * `grpc-skill-my` 的归属钩子以前是裸 throw ⇒ 一律 500。
     * 这里用"不存在的 skillCode"走同一条中性分支：必须是 403，且文案不区分"不存在"与"不是你的"（防枚举）。
     */
    await t.test('grpc-skill-my 归属校验：不存在与不是你的都给 403，且同一句文案', async () => {
        const res = await app.inject({
            method: 'GET', url: '/core/grpc-skill-my/detail?skillCode=e2e-nonexistent-skill-code',
            headers: {'user-info': b64(OUTSIDER)},
        })
        assert.equal(res.statusCode, 403, `越权/不存在应是 403，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        assert.match(JSON.parse(res.payload).msg, /^技能不存在$|技能不存在/)
    })

    await t.test('grpc-skill-my 缺 skillCode ⇒ 400（不再是 500）', async () => {
        const res = await app.inject({
            method: 'GET', url: '/core/grpc-skill-my/detail?skillCode=',
            headers: {'user-info': b64(OUTSIDER)},
        })
        assert.ok(res.statusCode === 400 || res.statusCode === 403,
            `缺参数应是 4xx，实际 ${res.statusCode}：${res.payload.slice(0, 200)}`)
        assert.notEqual(res.statusCode, 500, '500 会把"你没传参"记成服务端故障')
    })
})
