/**
 * @fileOverview read_attachment 工具的用例（纯件 + deps 注入真跑）
 * @module test/services/core/attachment/readAttachmentTool.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
    READ_ATTACHMENT_TOOL_NAME, buildReadAttachmentTools, isReadAttachmentTool,
    executeReadAttachmentTool, DEFAULT_MAX_CHARS, MAX_CHARS_LIMIT,
} from '../../../../services/core/attachment/readAttachmentTool.js'

const TC = (args) => ({id: 't-1', function: {name: READ_ATTACHMENT_TOOL_NAME, arguments: typeof args === 'string' ? args : JSON.stringify(args)}})
const CTX = {rootCode: 'r1', agentCode: 'c1', agentRole: 'child'}
const body = (msg) => JSON.parse(msg.content)

function deps({params = {attachments: [{fileCode: 'f1', name: 'a.pdf'}]}, extract = {text: '正文', docType: 'pdf'}, throwOn = {}} = {}) {
    return {
        getRootParams: async () => {
            if (throwOn.root) throw new Error('库挂了')
            return params
        },
        extractText: async (fileCode) => {
            if (throwOn.extract) throw new Error('doc.api 502')
            return typeof extract === 'function' ? extract(fileCode) : extract
        },
    }
}

describe('注册面形状', () => {
    test('schema：fileCode 必填唯一参数；谓词精确匹配', () => {
        const t = buildReadAttachmentTools()[0]
        assert.equal(t.function.name, READ_ATTACHMENT_TOOL_NAME)
        assert.deepEqual(t.function.parameters.required, ['fileCode'])
        assert.ok(isReadAttachmentTool('read_attachment'))
        assert.ok(!isReadAttachmentTool('read_artifact'))
        assert.ok(!isReadAttachmentTool(undefined))
    })
})

describe('executeReadAttachmentTool 判定链（deps 真跑）', () => {
    test('参数不是 JSON ⇒ success:false 且点名解析失败（不猜模型意图）', async () => {
        const m = await executeReadAttachmentTool({toolCall: TC('{oops'), taskContext: CTX, deps: deps()})
        const b = body(m)
        assert.equal(b.success, false)
        assert.match(b.error, /解析失败/)
        assert.equal(m.tool_call_id, 't-1')
    })
    test('普通轮（无 taskContext）⇒ deny no-task-context 且 **不发 extract**（拒绝在 IO 之前）', async () => {
        let extracted = 0
        const d = deps({extract: () => { extracted++; return {text: ''} }})
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: null, deps: d}))
        assert.equal(b.authorization, 'no-task-context')
        assert.equal(extracted, 0)
    })
    test('清单外 fileCode ⇒ not-in-snapshot，extract 零调用（红线在 IO 前）', async () => {
        let extracted = 0
        const d = deps({extract: () => { extracted++; return {text: ''} }})
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f9'}), taskContext: CTX, deps: d}))
        assert.equal(b.authorization, 'not-in-snapshot')
        assert.match(b.error, /授权红线/)
        assert.equal(extracted, 0)
    })
    test('root 读抛 ⇒ root-unreadable（不知道站危险面）', async () => {
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({throwOn: {root: true}})}))
        assert.equal(b.authorization, 'root-unreadable')
    })
    test('root 行不存在（params=null）⇒ 同样 root-unreadable，不许混成"没有附件"', async () => {
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({params: null})}))
        assert.equal(b.authorization, 'root-unreadable')
    })
    test('root 有行但无附件 ⇒ no-snapshot（与 unreadable 话术不同）', async () => {
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({params: {}})}))
        assert.equal(b.authorization, 'no-snapshot')
    })
    test('放行正路：成功体带 fileCode/docType/viaOcr/chars 与三层截断标', async () => {
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({extract: {text: '你好世界', docType: 'docx', viaOcr: true, truncated: false}})}))
        assert.equal(b.success, true)
        assert.deepEqual(b.data, {
            fileCode: 'f1', docType: 'docx', viaOcr: true, text: '你好世界', chars: 4,
            truncatedByDocApi: false, truncatedByLlm: false, sourceChars: 4,
        })
    })
    test('llm 侧钳制：超 maxChars 截断+truncatedByLlm+sourceChars 如实', async () => {
        const long = 'x'.repeat(DEFAULT_MAX_CHARS + 100)
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({extract: {text: long}})}))
        assert.equal(b.data.text.length, DEFAULT_MAX_CHARS)
        assert.equal(b.data.truncatedByLlm, true)
        assert.equal(b.data.sourceChars, long.length)
    })
    test('limits.maxChars 超硬上限 ⇒ 钳到 MAX_CHARS_LIMIT（参数说多少都不算）', async () => {
        const huge = 'y'.repeat(MAX_CHARS_LIMIT + 10)
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({extract: {text: huge}}), limits: {maxChars: 99999999}}))
        assert.equal(b.data.text.length, MAX_CHARS_LIMIT)
    })
    test('extract 抛 ⇒ success:false 且把 doc.api 的话透传（不吞 502）', async () => {
        const b = body(await executeReadAttachmentTool({toolCall: TC({fileCode: 'f1'}), taskContext: CTX, deps: deps({throwOn: {extract: true}})}))
        assert.equal(b.success, false)
        assert.match(b.error, /doc\.api 502/)
    })
})
