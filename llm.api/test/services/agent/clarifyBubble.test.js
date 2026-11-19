/**
 * @fileOverview 澄清冒泡判据的用例（纯件穷举）
 * @module test/services/agent/clarifyBubble.test
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
    CLARIFY_TOOL_NAME, CLARIFY_SECTION_MARK,
    buildClarifyRequestTools, isClarifyRequestTool, parseClarifyRequest,
    extractClarifyRequests, decideFinalizeWithClarify, matchClarifyAnswers, buildClarifyRequeueParams,
} from '../../../services/agent/clarifyBubble.js'

describe('工具注册面', () => {
    test('schema：question 必填；谓词精确匹配', () => {
        const t = buildClarifyRequestTools()[0]
        assert.equal(t.function.name, CLARIFY_TOOL_NAME)
        assert.deepEqual(t.function.parameters.required, ['question'])
        assert.ok(isClarifyRequestTool(CLARIFY_TOOL_NAME))
        assert.ok(!isClarifyRequestTool('ask_user'), '与 ask_user 是两个工具，谓词不许互相放行')
    })
})

describe('parseClarifyRequest 校验', () => {
    test('正常：串与对象两形都收', () => {
        assert.deepEqual(parseClarifyRequest(JSON.stringify({question: '用哪个环境？'})), {ok: true, question: '用哪个环境？', options: []})
        assert.deepEqual(parseClarifyRequest({question: 'q', options: ['a', 'b']}), {ok: true, question: 'q', options: ['a', 'b']})
    })
    test('坏 JSON/怪形状 ⇒ 拒且给原因（不硬猜）', () => {
        assert.deepEqual(parseClarifyRequest('{oops'), {ok: false, reason: 'bad-json'})
        assert.deepEqual(parseClarifyRequest(null), {ok: false, reason: 'bad-shape'})
        assert.deepEqual(parseClarifyRequest('"str"'), {ok: false, reason: 'bad-shape'})
    })
    test('question 空/纯空白/超长 ⇒ 拒（超长不截断——模型重写一句短的更诚实）', () => {
        assert.equal(parseClarifyRequest({question: '  '}).reason, 'empty-question')
        assert.equal(parseClarifyRequest({question: 'x'.repeat(501)}).reason, 'question-too-long')
    })
    test('options 形状族：非数组/超条数/单项超长各归各的原因；空白项被滤', () => {
        assert.equal(parseClarifyRequest({question: 'q', options: 'a'}).reason, 'options-not-array')
        assert.equal(parseClarifyRequest({question: 'q', options: Array(7).fill('a')}).reason, 'options-too-many')
        assert.equal(parseClarifyRequest({question: 'q', options: ['x'.repeat(101)]}).reason, 'option-text-too-long')
        assert.deepEqual(parseClarifyRequest({question: 'q', options: ['', '  ', 'ok']}).options, ['ok'])
    })
})

describe('extractClarifyRequests（只认终局成功行）', () => {
    test('handleStatus 2+question ⇒ 收；-1 失败行带的"想问"不算澄清（失败叙事归仲裁）', () => {
        const got = extractClarifyRequests([
            {agentCode: 'c1', handleStatus: 2, handleRet: {clarify: {question: '选 A 还是 B？', options: ['A', 'B']}}, title: 't1'},
            {agentCode: 'c2', handleStatus: -1, handleRet: {clarify: {question: '为什么不给我密码？'}}},
            {agentCode: 'c3', handleStatus: 2, handleRet: {content: '没问题直接干完了'}},
            {agentCode: 'c4', handleStatus: 2, handleRet: {clarify: {question: '  '}}},
        ])
        assert.deepEqual(got, [{agentCode: 'c1', question: '选 A 还是 B？', options: ['A', 'B'], title: 't1'}])
    })
    test('options 缺失给空数组；children 非数组不炸', () => {
        assert.deepEqual(extractClarifyRequests([{agentCode: 'c', handleStatus: 2, handleRet: {clarify: {question: 'q'}}}]),
            [{agentCode: 'c', question: 'q', options: [], title: ''}])
        assert.deepEqual(extractClarifyRequests(undefined), [])
    })
})

describe('decideFinalizeWithClarify（finalize 截胡表）', () => {
    const fin = {action: 'synthesize', dispatch: {needSynthesis: true}, counts: {usable: 2, total: 2}}
    const req = (c, q) => ({agentCode: c, question: q, options: [], title: ''})

    test('非 synthesize 档原样直通（澄清不借 retry/report 的道出题）', () => {
        const other = {mode: 'passthrough', fin: {action: 'report'}, requests: [], answeredCodes: [], clarifyCounts: {}, cap: 2}
        assert.deepEqual(decideFinalizeWithClarify(other), {mode: 'passthrough', fin: {action: 'report'}})
        assert.deepEqual(decideFinalizeWithClarify({fin: null, requests: [req('c1', 'q')]}), {mode: 'passthrough', fin: null})
    })
    test('synthesize+有申报 ⇒ await：hold 带 requests/capped/sealedAt 三件', () => {
        const d = decideFinalizeWithClarify({fin, requests: [req('c1', '选哪个环境？')]})
        assert.equal(d.mode, 'await')
        assert.deepEqual(d.hold.requests, [{agentCode: 'c1', question: '选哪个环境？', options: [], title: ''}])
        assert.deepEqual(d.hold.capped, [])
        assert.ok(d.hold.sealedAt)
    })
    test('answered 收缩：已答复的不再挂（答复后重跑又申报同一 child 才算——answeredCodes 由端点累积）', () => {
        const d = decideFinalizeWithClarify({fin, requests: [req('c1', 'q')], answeredCodes: ['c1']})
        assert.deepEqual(d, {mode: 'passthrough', fin})
        const d2 = decideFinalizeWithClarify({fin, requests: [req('c1', 'q'), req('c2', 'q2')], answeredCodes: ['c1']})
        assert.equal(d2.hold.requests.length, 1)
        assert.equal(d2.hold.requests[0].agentCode, 'c2')
    })
    test('cap：超限申报进 capped 如实列出；全部超限 ⇒ synthesize-degraded 带 note（不静默丢）', () => {
        const d = decideFinalizeWithClarify({fin, requests: [req('c1', 'q')], clarifyCounts: {c1: 2}, cap: 2})
        assert.equal(d.mode, 'synthesize-degraded')
        assert.equal(d.note, 'clarify-cap-exhausted')
        const mix = decideFinalizeWithClarify({fin, requests: [req('c1', 'q1'), req('c2', 'q2')], clarifyCounts: {c2: 2}, cap: 2})
        assert.equal(mix.mode, 'await')
        assert.deepEqual(mix.hold.capped, [{agentCode: 'c2', question: 'q2'}])
    })
    test('缺 agentCode 的畸形申报不挂起（无主的问题没人能答）', () => {
        assert.deepEqual(decideFinalizeWithClarify({fin, requests: [req('', 'q')]}), {mode: 'passthrough', fin})
    })
})

describe('matchClarifyAnswers（答复对表，允许部分答复）', () => {
    const hold = {requests: [{agentCode: 'c1', question: 'q1'}, {agentCode: 'c2', question: 'q2'}]}
    test('答一留一：matched 带原问题，missing 点名没答的', () => {
        const m = matchClarifyAnswers({hold, answers: [{agentCode: 'c1', response: ' 用生产 '} ]})
        assert.deepEqual(m.matched, [{agentCode: 'c1', question: 'q1', response: '用生产'}])
        assert.deepEqual(m.missing, ['c2'])
        assert.deepEqual(m.unknown, [])
        assert.equal(m.empty, false)
    })
    test('清单外/空答复 ⇒ unknown（如实列出但不拦合法部分）', () => {
        const m = matchClarifyAnswers({hold, answers: [{agentCode: 'c9', response: 'x'}, {agentCode: 'c1', response: ''}, {agentCode: 'c2', response: 'y'}]})
        assert.deepEqual(m.unknown, ['c9', 'c1(空答复)'])
        assert.equal(m.matched.length, 1)
    })
    test('全无有效答复 ⇒ empty（端点据此拒整请求）', () => {
        assert.equal(matchClarifyAnswers({hold, answers: [{agentCode: 'zz', response: 'x'}]}).empty, true)
        assert.equal(matchClarifyAnswers({hold: null, answers: []}).empty, true)
    })
})

describe('buildClarifyRequeueParams（注入段替换不叠加）', () => {
    test('首轮：原 query 保持+追加澄清段', () => {
        const r = buildClarifyRequeueParams({query: '调研 X', response: '用 2025 数据', round: 1})
        assert.ok(r.query.startsWith('调研 X'))
        assert.ok(r.query.includes(`${CLARIFY_SECTION_MARK} · 第 1 轮】`))
        assert.ok(r.query.includes('用 2025 数据'))
    })
    test('次轮：旧澄清段被整段替换，不累积成楼（多轮材料由答复文本自己带）', () => {
        const once = buildClarifyRequeueParams({query: '调研 X', response: 'A', round: 1}).query
        const twice = buildClarifyRequeueParams({query: once, response: 'B', round: 2}).query
        assert.equal(twice.split(CLARIFY_SECTION_MARK).length - 1, 1, '澄清段标记必须恰有 1 个')
        assert.ok(twice.includes('B'))
        assert.ok(!twice.includes('用户答复：A'), '旧答复文本不该残留在结构段里')
        assert.ok(twice.startsWith('调研 X'))
    })
    test('空 response 也不炸（端点已滤过，这里兜形）', () => {
        assert.ok(buildClarifyRequeueParams({query: 'q', response: '', round: 1}).query.includes(CLARIFY_SECTION_MARK))
    })
})
