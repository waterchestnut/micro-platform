import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'

/**
 * gRPC 截止（deadline）的行为测试。
 *
 * 为什么必须有截止：`mentorContact.loadContactCodes` 的 fail-closed 完全依赖"调用出错"，
 * 而 grpc-js 不给 deadline 就是无限等——ucenter 连接在但不返回时既不 resolve 也不 reject，
 * 发消息的人会永久卡住。**没有截止的 fail-closed 等于 fail-never。**
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '../../..')

/* 该模块在加载期读 llm.config.ucenterConfig 并同步解析 proto，故先注入最小全局再动态导入 */
global.llm = global.llm || {
    baseDir: srcDir + path.sep,
    logger: {info() {}, warn() {}, error() {}},
    config: {debug: false},
    tools: {},
}
global.llm.config.ucenterConfig = {grpcHost: '127.0.0.1:1', grpcTimeoutMs: 1234, maxMessageLength: 1024}

const {callWithDeadline, pickUserCodes} = await import('../../../grpc/clients/userInfo.js')

/**
 * @description 造一个假 client：记录收到的参数，按脚本回调 err 或 response
 * @param {Object} script 每个方法要回调什么
 * @returns {{client: Object, calls: Array}} client 与调用记录
 */
function fakeClient(script) {
    const calls = []
    const client = {}
    for (const [method, outcome] of Object.entries(script)) {
        client[method] = (request, metadata, options, callback) => {
            calls.push({method, request, metadata, options})
            setImmediate(() => callback(outcome.err || null, outcome.response || null))
        }
    }
    return {client, calls}
}

describe('callWithDeadline：截止是 fail-closed 的前提', () => {
    test('deadline 等于"注入的现在 + timeoutMs"，且四参形态被固定下来', async () => {
        const {client, calls} = fakeClient({ping: {response: {ok: 1}}})
        const now = 1700000000000
        const ret = await callWithDeadline(client, 'ping', {a: 1}, 2500, now)

        assert.deepEqual(ret, {ok: 1})
        assert.equal(calls.length, 1)
        assert.equal(calls[0].method, 'ping')
        assert.deepEqual(calls[0].request, {a: 1})
        assert.ok(calls[0].metadata, '要带 Metadata（第四参形态要求第三参是 metadata）')
        assert.ok(calls[0].options.deadline instanceof Date, 'deadline 必须是 Date')
        assert.equal(calls[0].options.deadline.getTime(), now + 2500)
    })

    test('不传 timeoutMs 时用配置里的 grpcTimeoutMs（默认值可被环境覆盖）', async () => {
        const {client, calls} = fakeClient({ping: {response: {}}})
        const now = 1700000000000
        await callWithDeadline(client, 'ping', {}, undefined, now)
        assert.equal(calls[0].options.deadline.getTime(), now + 1234)
    })

    test('服务端报错时 Promise 被 reject——这正是 mentorContact 走 fail-closed 的那条形', async () => {
        const err = Object.assign(new Error('Deadline exceeded'), {code: 4})
        const {client} = fakeClient({getMentorTeachers: {err}})
        await assert.rejects(() => callWithDeadline(client, 'getMentorTeachers', {userCode: 'U1'}, 10, 0),
            (e) => e.code === 4 && /Deadline exceeded/.test(e.message))
    })

    test('响应缺失 userCodes 时按空集合处理，不抛错', () => {
        assert.deepEqual(pickUserCodes(undefined), [])
        assert.deepEqual(pickUserCodes({}), [])
        assert.deepEqual(pickUserCodes({userCodes: []}), [])
        assert.deepEqual(pickUserCodes({userCodes: ['A', 'B']}), ['A', 'B'])
    })

    /**
     * 现状锁定：截止**只**加在 u2u 热路径的两个方法上。
     * 其余方法（getUserDetail / getUserList / hasPriv ...）没有截止，
     * 给它们加会改变既有调用方的行为，不在本次改动里顺手做。
     * 真要扩的时候这条会红——那时应该显式更新它，并说明是谁的超时语义被改了。
     */
    test('现状：callWithDeadline 目前只用于两个 mentor 方法', () => {
        const text = fs.readFileSync(path.join(srcDir, 'grpc/clients/userInfo.js'), 'utf8')
        const uses = [...text.matchAll(/callWithDeadline\(client, '([A-Za-z]+)'/g)].map(m => m[1])
        assert.deepEqual(uses.sort(), ['getMentorStudents', 'getMentorTeachers'])
    })
})
