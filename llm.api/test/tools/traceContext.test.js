/**
 * @fileOverview traceId 传播的离线单测
 * @module test/tools/traceContext
 * @description
 * 钉住三件事：**traceId 只有一个真值（messageCode）**、**入站值不可信必须脱敏**、
 * **日志字段里没有用户内容**。第二和第三条都是安全边界，不是风格偏好。
 */
import {test} from 'node:test'
import * as assert from 'node:assert'
import {
    sanitizeTraceId,
    buildTrace,
    traceFields,
    traceHeaders,
    withTrace,
    TRACE_HEADER,
    CONVERSATION_HEADER,
} from '../../tools/traceContext.js'

const BASE = {
    messageCode: 'a1b2c3d0dc0411f1b5ad7b900b400792',
    conversationCode: 'conv-2026_11-09',
    userCode: 'teacher-001',
    channel: 'xxzx_common',
    llmModel: 'relay_common_pro',
    reqId: 'req-42',
}

/* ========================= 真值唯一 ========================= */

test('traceId 就是 messageCode：不引入第二个标识符', () => {
    const trace = buildTrace(BASE)
    assert.equal(trace.traceId, BASE.messageCode)
    assert.equal(traceFields(trace).traceId, BASE.messageCode)
    assert.equal(traceHeaders(trace)[TRACE_HEADER], BASE.messageCode)
})

test('缺 messageCode 直接抛错，而不是生成一个临时 id', () => {
    /** 静默造 id 会让"同一个数两处存"的问题重新出现，宁可起不来 */
    assert.throws(() => buildTrace({}), /messageCode/)
    assert.throws(() => buildTrace({messageCode: ''}), /messageCode/)
})

/* ========================= 入站脱敏 ========================= */

test('sanitizeTraceId：CRLF 与任意注入字符被剥掉，不留下半个头', () => {
    const evil = 'abc\r\nX-Injected: 1'
    const out = sanitizeTraceId(evil)
    /** 白名单是 `[A-Za-z0-9._:-]`：冒号本身是合法头字符（W3C traceparent 之类会用到），空格与换行都会被剥掉 */
    assert.equal(out, 'abcX-Injected:1')
    assert.ok(!/[\r\n]/.test(out), '换行必须彻底消失，否则就是头注入')
    assert.ok(!out.includes(' '), '空格也不该进头值')
})

test('sanitizeTraceId：超长截到 64 字符，不拿头当数据塞', () => {
    const long = 'x'.repeat(500)
    assert.equal(sanitizeTraceId(long).length, 64)
})

test('sanitizeTraceId：非字符串与清洗后为空都给 null（不留空串）', () => {
    for (const bad of [undefined, null, 123, {}, [], '']) {
        assert.equal(sanitizeTraceId(bad), null, JSON.stringify(bad))
    }
    assert.equal(sanitizeTraceId('!!!???'), null, '全是非法字符时等于没有')
})

test('sanitizeTraceId：合法形态原样通过', () => {
    for (const ok of ['req-42', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', 'trace_2026.11.09:1']) {
        assert.equal(sanitizeTraceId(ok), ok)
    }
})

test('buildTrace：入站 traceId 脱敏后单独存放，绝不覆盖 traceId', () => {
    const trace = buildTrace({...BASE, inboundTraceId: 'evil\r\nvalue'})
    assert.equal(trace.traceId, BASE.messageCode, '真值不受入站影响')
    assert.equal(trace.inboundTraceId, 'evilvalue')
    const trace2 = buildTrace({...BASE, inboundTraceId: 12345})
    assert.equal(trace2.inboundTraceId, null, '非字符串入站等于没有')
})

/* ========================= 出站头 ========================= */

test('traceHeaders：只带可关联的两个头，空值不发空头', () => {
    const h = traceHeaders(buildTrace(BASE))
    assert.deepEqual(Object.keys(h).sort(), [CONVERSATION_HEADER, TRACE_HEADER].sort())

    const bare = traceHeaders(buildTrace({messageCode: 'm-1'}))
    assert.deepEqual(Object.keys(bare), [TRACE_HEADER], '没有会话标识时不该出现会话头')
})

test('traceHeaders：不回显入站 traceId 给上游', () => {
    const trace = buildTrace({...BASE, inboundTraceId: 'other-system-id'})
    const h = traceHeaders(trace)
    assert.equal(Object.values(h).includes('other-system-id'), false, '别人的号不该进我们的上游请求')
    assert.equal(traceFields(trace).inboundTraceId, 'other-system-id', '但自己的日志要留住它，否则接不上对家的排障')
})

test('traceHeaders：includeConversation=false 时只留 traceId（给不想暴露会话标识的出口）', () => {
    const h = traceHeaders(buildTrace(BASE), {includeConversation: false})
    assert.deepEqual(Object.keys(h), [TRACE_HEADER])
})

/* ========================= 日志字段 ========================= */

test('traceFields：键固定且**不含任何用户内容**（正文/问题/工具参数都不许进日志）', () => {
    const fields = traceFields(buildTrace(BASE))
    assert.deepEqual(Object.keys(fields).sort(),
        ['channel', 'conversationCode', 'model', 'reqId', 'traceId', 'userCode'].sort())
    const banned = ['query', 'answer', 'content', 'messages', 'arguments', 'prompt']
    for (const b of banned) {
        assert.equal(b in fields, false, `日志字段不该有 ${b}`)
    }
})

test('traceFields：缺项不写空键，避免日志里一堆无意义字段', () => {
    const fields = traceFields(buildTrace({messageCode: 'm-2'}))
    assert.deepEqual(fields, {traceId: 'm-2'})
})

/* ========================= withTrace ========================= */

test('withTrace：正常走 pino child，binding 就是 traceFields', () => {
    const seen = []
    const logger = {child: (bindings) => { seen.push(bindings); return {tag: 'child'} }}
    const trace = buildTrace(BASE)
    const tlog = withTrace(logger, trace)
    assert.deepEqual(tlog, {tag: 'child'})
    assert.equal(seen[0].traceId, trace.traceId)
})

test('withTrace：logger 不支持 child 时原样返回，不阻断主链路', () => {
    const plain = {info() {}}
    assert.equal(withTrace(plain, buildTrace(BASE)), plain)
    assert.equal(withTrace(null, buildTrace(BASE)), null)
})

test('withTrace：child 自己抛错也必须兜住（观测能力坏掉不该让回答失败）', () => {
    const boom = {child: () => { throw new Error('transport down') }}
    assert.equal(withTrace(boom, buildTrace(BASE)), boom)
})
