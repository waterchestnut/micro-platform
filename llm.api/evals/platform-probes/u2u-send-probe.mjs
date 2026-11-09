/**
 * @fileOverview u2u 关系校验的 HTTP 层探针（PR-E0.7 写侧，需本机 llm.api + 本机 ucenter grpc）
 * @module evals/platform-probes/u2u-send-probe
 * @description
 * `contact-probe.mjs` 证明的是判定本身；这个探针证明**闸门确实挂在 HTTP 入口上**：
 * 越权的 `targetUserCode` 在路由层就被拒（403），而不是等写完消息才发现。
 *
 * 用法（在 `src/` 下）：
 *   # 终端1：cd xxzx.ucenter.api/src; $env:GRPC_PORT='13001'; node grpc/server.js
 *   # 终端2：cd src; $env:PORT='12008'; $env:ucenterConfig_grpcHost='127.0.0.1:13001'; npx fastify start -l warn app.js
 *   # 终端3：node evals/platform-probes/u2u-send-probe.mjs
 *
 * 写数据说明：只有"有关系"那一组会真的落一条 u2u 消息（dev 的仿真账号之间，内容已标注可忽略）；
 * 越权组与不存在组都在落库之前被拒，不产生数据。
 */
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12008'
const TEACHER = process.env.PROBE_TEACHER || 'ZMLJS001'
const STUDENT = process.env.PROBE_STUDENT || '20200008'
const STRANGER = 'u2u-probe-stranger-000000'
const NONEXIST = 'u2u-probe-nonexistent-0000'

/**
 * @description 把用户信息编成网关同款 user-info 头
 * @param {String} userCode 工号
 * @param {String} realName 姓名
 * @returns {String} base64 后的 JSON
 */
const userInfoHeader = (userCode, realName) =>
    Buffer.from(JSON.stringify({userCode, realName})).toString('base64')

/**
 * @description 发一条 u2u 消息并返回状态码与响应摘要
 * @param {String} asUserCode 以谁的身份发
 * @param {String} asName 身份姓名
 * @param {String} targetUserCode 发给谁
 * @param {String} content 内容
 * @returns {Promise<{status: Number, body: String}>} 响应
 */
async function send(asUserCode, asName, targetUserCode, content) {
    const r = await fetch(`${BASE}/core/chat/u2u/message/send`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'user-info': userInfoHeader(asUserCode, asName)},
        body: JSON.stringify({targetUserCode, content}),
    })
    return {status: r.status, body: (await r.text().catch(() => '')).slice(0, 220)}
}

const out = (name, pass, detail) => console.log(JSON.stringify({probe: 'u2u-send', name, pass, ...detail}))
const results = []

/**
 * @description 记录一条断言
 * @param {String} name 断言名
 * @param {Boolean} pass 是否通过
 * @param {Object} detail 现场数据
 * @returns {void}
 */
function record(name, pass, detail) {
    results.push(pass)
    out(name, pass, detail)
}

const strangerRet = await send(TEACHER, '探针教师', STRANGER, '探针：越权应被拒，不会落库')
record('越权目标被拒（403）', strangerRet.status === 403, strangerRet)

const nonexistRet = await send(TEACHER, '探针教师', NONEXIST, '探针：不存在的目标')
record('不存在的目标也是 403 且不泄露"存在性"', nonexistRet.status === 403, nonexistRet)

const selfRet = await send(TEACHER, '探针教师', TEACHER, '探针：自己给自己')
record('自己与自己被拒（403）', selfRet.status === 403, selfRet)

const noIdRet = await (async () => {
    const r = await fetch(`${BASE}/core/chat/u2u/message/send`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({targetUserCode: STUDENT, content: '探针：无身份'}),
    })
    return {status: r.status, body: (await r.text().catch(() => '')).slice(0, 220)}
})()
record('无身份是 401 而不是 500', noIdRet.status === 401, noIdRet)

const okRet = await send(TEACHER, '探针教师', STUDENT, '探针：关系校验放行测试（dev 仿真账号之间，可忽略）')
/** 响应信封是 {data, statusCode, code}，这里只看载荷确实出来了（不要用截断后的文本去猜 code 字段） */
record('有关系的师生可正常发送（200 且有 messageCode）', okRet.status === 200 && /"messageCode"/.test(okRet.body), okRet)

const failed = results.filter(x => !x).length
console.log(JSON.stringify({
    probe: 'u2u-send',
    note: '结论',
    断言数: results.length,
    失败: failed,
    判定: failed ? '❌ 有不通过的断言' : '✅ 闸门挂在 HTTP 入口上：越权 403、无身份 401、有关系放行',
}))
process.exit(failed ? 1 : 0)
