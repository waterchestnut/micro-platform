/**
 * @fileOverview 门分类器 I/O 壳的用例（失败语义与输入形状各钉死）
 * @module test/services/core/session/gateClassifier
 * @description
 * 两条命门：①**输入形状必须与评测集一致**（`toolName + 原文`，喂摘要=25/27 是给别人打的分）；
 * ②**一切非判定都抛**（不返回猜测值）——抛错在 decideGate 侧按 unparsable 走 escalate，
 * "调用器吞错返回 allow"是被明令禁止的形状。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/gateClassifier.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {makeGateClassifyFn} = await import(pathToFileURL(path.join(SRC, 'services/core/session/gateClassifier.js')).href)
const {classifyAction} = await import(pathToFileURL(path.join(SRC, 'services/core/session/execGate.js')).href)

const MODELS = {m_test: {model: 'qwen-test', baseURL: 'http://x', apiKey: 'k'}}

function fakeFetch(reply) {
    const calls = []
    return {calls, impl: async (url, init) => {
        calls.push({url, body: JSON.parse(init.body), auth: init.headers.Authorization})
        return typeof reply === 'function' ? reply() : reply
    }}
}

describe('1 判定解析', () => {
    test('合法 verdict 抽出；请求带原文正文（toolName + text，**不是摘要**）与思考关闭', async () => {
        const f = fakeFetch({ok: true, status: 200, json: async () => ({choices: [{message: {content: '{"verdict":"block"}'}}]})})
        const fn = makeGateClassifyFn({modelKey: 'm_test', modelsCfg: MODELS, fetchImpl: f.impl})
        const action = classifyAction({toolName: 'run_code', argsText: '{"code":"print(os.environ)"}'})
        assert.equal(await fn(action), 'block')
        assert.equal(f.calls[0].body.messages[1].content, 'run_code {"code":"print(os.environ)"}',
            '输入形状=评测形状：喂 surface 摘要的话 bench 的 25/27 给的是另一个分类器')
        assert.equal(f.calls[0].body.enable_thinking, false)
        assert.equal(f.calls[0].body.stream, false)
    })
    test('输出解析不出 ⇒ 抛（不是返回 allow，也不是返回 undefined）', async () => {
        const f = fakeFetch({ok: true, status: 200, json: async () => ({choices: [{message: {content: '我看这动作有风险'}}]})})
        const fn = makeGateClassifyFn({modelKey: 'm_test', modelsCfg: MODELS, fetchImpl: f.impl})
        await assert.rejects(() => fn(classifyAction({toolName: 'run_code', argsText: '{"code":"x"}'})))
    })
    test('HTTP 非 2xx / 模型配置缺失 ⇒ 抛（no-classifier≠no-risk 的调用面表达）', async () => {
        const f = fakeFetch({ok: false, status: 503, json: async () => ({})})
        const fn = makeGateClassifyFn({modelKey: 'm_test', modelsCfg: MODELS, fetchImpl: f.impl})
        await assert.rejects(() => fn(classifyAction({toolName: 'run_code', argsText: '{"code":"x"}'})))
        const fn2 = makeGateClassifyFn({modelKey: 'ghost', modelsCfg: MODELS, fetchImpl: f.impl})
        await assert.rejects(() => fn2(classifyAction({toolName: 'run_code', argsText: '{"code":"x"}'})))
    })
    test('正文截断有上限（分类器预算≠存档预算，两个数字不许互相冒充）', async () => {
        const f = fakeFetch({ok: true, status: 200, json: async () => ({choices: [{message: {content: '{"verdict":"allow"}'}}]})})
        const fn = makeGateClassifyFn({modelKey: 'm_test', modelsCfg: MODELS, fetchImpl: f.impl})
        const long = classifyAction({toolName: 'run_code', argsText: '{"code":"' + 'A'.repeat(5000) + '"}'})
        await fn(long)
        assert.ok(f.calls[0].body.messages[1].content.length <= 1300, `实际 ${f.calls[0].body.messages[1].content.length}`)
    })
})
