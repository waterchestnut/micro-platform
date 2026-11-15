/**
 * @fileOverview PR-E 首块纯判据的用例（signedBlob 底座 + MRTR 契约）
 * @module test/services/core/session/mrtrPayload
 * @description
 * 重点钉：①D28 凭据禁令的**方向是拒不是纠**（字段名/format 双探测）；②"原样回显"≠"随便塞"
 * （未知键必拒——续体里冒出来的键下一轮会以假乱真）；③密封续体篡改必现；④审批在角色细则
 * 裁定前保守到只认发起人；先到先得的提示语给得出"已被谁答"。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/mrtrPayload.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const SB = await import(pathToFileURL(path.join(SRC, 'tools/signedBlob.js')).href)
const E = await import(pathToFileURL(path.join(SRC, 'services/core/session/mrtrPayload.js')).href)
const {makeSignedBlob, readSignedBlob} = SB
const {MRTR_RESULT_TYPE, validateInputRequests, sealRequestState, openRequestState, buildAwaitInputPayload, validateAnswerPayload, decideAnswerAdmission} = E

const SEC = 'unit-test-secret'

describe('1 signedBlob 底座', () => {
    test('往返：make→read 原样；篡改一个字符 ⇒ 签名拒', () => {
        const tok = makeSignedBlob(SEC, {a: 1, 中: '文'})
        assert.deepEqual(readSignedBlob(SEC, tok).value, {a: 1, 中: '文'})
        const dot = tok.lastIndexOf('.')
        const tampered = tok.slice(0, dot - 1) + (tok[dot - 1] === 'A' ? 'B' : 'A') + tok.slice(dot)
        const bad = readSignedBlob(SEC, tampered)
        assert.equal(bad.ok, false)
        assert.match(bad.reason, /签名不匹配/)
    })
    test('换密钥 ⇒ 拒；空密钥 ⇒ 拒；坏格式 ⇒ 拒（不抛）', () => {
        const tok = makeSignedBlob(SEC, {x: 1})
        assert.equal(readSignedBlob('other-secret', tok).ok, false)
        assert.equal(readSignedBlob('', tok).ok, false)
        assert.equal(readSignedBlob(SEC, 'nodothere').ok, false)
        assert.equal(readSignedBlob(SEC, '').ok, false)
    })
    test('maxAgeMs：iat 超龄拒、缺 iat 判废（要新鲜度就得有签发时间）', () => {
        const tok = makeSignedBlob(SEC, {iat: 1000})
        assert.equal(readSignedBlob(SEC, tok, {now: 1000 + 50, maxAgeMs: 10}).ok, false)
        assert.equal(readSignedBlob(SEC, tok, {now: 1000 + 5, maxAgeMs: 10}).ok, true)
        const noIat = makeSignedBlob(SEC, {z: 1})
        assert.equal(readSignedBlob(SEC, noIat, {maxAgeMs: 10}).ok, false)
        assert.equal(readSignedBlob(SEC, noIat).ok, true, '不要求新鲜度时缺 iat 合法（默认不限龄是裁定）')
    })
})

describe('2 validateInputRequests：出题侧与 D28', () => {
    const form = (over = {}) => ({mode: 'form', message: '选个格式？', requestedSchema: {type: 'object', properties: {fmt: {type: 'string', enum: ['csv', 'xlsx']}}, required: ['fmt']}, ...over})
    test('合法 form / url 与缺省 mode=form', () => {
        assert.equal(validateInputRequests([form()]).ok, true)
        assert.equal(validateInputRequests([form({mode: undefined})]).value[0].mode, 'form')
        assert.equal(validateInputRequests([{message: '去这里授权', mode: 'url', url: 'https://example.com/oauth'}]).ok, true)
    })
    test('D28：凭据字段名/format=password 进 form ⇒ 拒且点名（不是把 mode 悄悄改成 url）', () => {
        const bad = form({requestedSchema: {type: 'object', properties: {fmt: {type: 'string'}, dbPassword: {type: 'string'}}}})
        const r = validateInputRequests([bad])
        assert.equal(r.ok, false)
        assert.match(r.error, /dbPassword/)
        assert.match(r.error, /form 模式/)
        const fmtBad = form({requestedSchema: {type: 'object', properties: {v: {type: 'string', format: 'password'}}}})
        assert.match(validateInputRequests([fmtBad]).error, /v/)
        const noMode = validateInputRequests([{message: 'x', requestedSchema: {type: 'object', properties: {apiKey: {type: 'string'}}}}])
        assert.equal(noMode.ok, false, '缺省 mode 也照样过凭据闸——禁令不看门牌看内容')
    })
    test('空数组 / mode 非法 / url 模式缺链接 / 超量 都拒', () => {
        assert.equal(validateInputRequests([]).ok, false)
        assert.equal(validateInputRequests([{message: 'x', mode: 'carrier-pigeon'}]).ok, false)
        assert.equal(validateInputRequests([{message: 'x', mode: 'url'}]).ok, false)
        assert.equal(validateInputRequests([{message: 'x', mode: 'url', url: 'ftp://no'}]).ok, false)
        assert.equal(validateInputRequests(Array.from({length: 9}, () => form())).ok, false)
    })
})

describe('3 requestState 密封与 await_input 载荷', () => {
    test('seal→open 往返带 iat；篡改 ⇒ error 带原因', () => {
        const sealed = sealRequestState({checkpointCode: 'ck-1', runCode: 'm-9'}, {secret: SEC, now: 5000})
        const r = openRequestState(sealed, {secret: SEC, now: 5000})
        assert.equal(r.ok, true)
        assert.deepEqual(r.value, {checkpointCode: 'ck-1', runCode: 'm-9', iat: 5000})
        assert.equal(openRequestState(sealed + 'x', {secret: SEC}).ok, false)
    })
    test('buildAwaitInputPayload：resultType 固定、seq 非负整、缺 state 直接抛（编程错不是运行失败）', () => {
        const p = buildAwaitInputPayload({inputRequests: [{mode: 'form'}], requestState: 'abc.def', checkpointSeq: 7})
        assert.equal(p.resultType, MRTR_RESULT_TYPE)
        assert.equal(p.checkpointSeq, 7)
        assert.throws(() => buildAwaitInputPayload({requestState: 'x', checkpointSeq: -1}), /非负整数/)
        assert.throws(() => buildAwaitInputPayload({checkpointSeq: 1}), /requestState/)
    })
})

describe('4 validateAnswerPayload：原样回显 ≠ 随便塞', () => {
    const schema = {type: 'object', properties: {fmt: {type: 'string', enum: ['csv', 'xlsx']}, note: {type: 'string'}}, required: ['fmt']}
    const okCase = (responses) => {
        const sealed = sealRequestState({runCode: 'm-1'}, {secret: SEC})
        return validateAnswerPayload({inputResponses: responses, requestState: sealed, schema, secret: SEC})
    }
    test('合法：required 齐、类型对、enum 内', () => {
        assert.equal(okCase({fmt: 'csv'}).ok, true)
        assert.equal(okCase({fmt: 'xlsx', note: '带备注'}).ok, true)
    })
    test('未知键拒（防止往续体上下文里加料）；缺 required 报清单；类型/enum 不符拒', () => {
        assert.match(okCase({fmt: 'csv', injected: 'x'}).error, /之外的键.*injected/)
        assert.match(okCase({note: 'n'}).error, /缺必答字段.*fmt/)
        assert.match(okCase({fmt: 42}).error, /期望 string，收到 number/)
        assert.match(okCase({fmt: 'pdf'}).error, /不在候选内/)
    })
    test('requestState 不合法 ⇒ 直接拒在续体（不先看 responses）', () => {
        const r = validateAnswerPayload({inputResponses: {fmt: 'csv'}, requestState: 'garbage', schema, secret: SEC})
        assert.equal(r.ok, false)
        assert.match(r.error, /requestState 校验失败/)
    })
    test('无 schema 时只验续体与对象形状（url 模式回传可以没有表单）', () => {
        const sealed = sealRequestState({runCode: 'm-2'}, {secret: SEC})
        assert.equal(validateAnswerPayload({inputResponses: {status: 'authorized'}, requestState: sealed, secret: SEC}).ok, true)
    })
})

describe('5 decideAnswerAdmission：先到先得与审批保守', () => {
    test('已被答 ⇒ admit:false 且 notice 指名道姓（其余人要看见是谁抢了）', () => {
        const r = decideAnswerAdmission({answerer: 'u-b', alreadyAnsweredBy: 'u-a'})
        assert.equal(r.admit, false)
        assert.equal(r.reason, 'already-answered')
        assert.match(r.notice, /u-a/)
    })
    test('question：发起人/参与者可答，外人不可', () => {
        assert.equal(decideAnswerAdmission({kind: 'question', answerer: 'u-i', initiator: 'u-i'}).admit, true)
        assert.equal(decideAnswerAdmission({kind: 'question', answerer: 'u-p', initiator: 'u-i', participants: ['u-p']}).admit, true)
        assert.equal(decideAnswerAdmission({kind: 'question', answerer: 'u-x', initiator: 'u-i', participants: ['u-p']}).reason, 'not-participant')
    })
    test('approval：裁定前只认发起人（§2F.4 未决 ⇒ 能点的人越少越安全）', () => {
        assert.equal(decideAnswerAdmission({kind: 'approval', answerer: 'u-i', initiator: 'u-i'}).admit, true)
        const r = decideAnswerAdmission({kind: 'approval', answerer: 'u-p', initiator: 'u-i', participants: ['u-p']})
        assert.equal(r.admit, false)
        assert.match(r.notice, /发起人/)
    })
    test('空 answerer ⇒ no-answerer（匿名不配碰任何续体）', () => {
        assert.equal(decideAnswerAdmission({answerer: '', initiator: 'u'}).reason, 'no-answerer')
    })
})

describe('6 纯件纪律', () => {
    test('mrtrPayload 只依赖 signedBlob；signedBlob 只依赖 node:crypto', () => {
        for (const [rel, want] of [
            ['services/core/session/mrtrPayload.js', ['../../../tools/signedBlob.js']],
            ['tools/signedBlob.js', ['node:crypto']],
        ]) {
            const code = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
            assert.deepEqual([...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort(), [...want].sort(), rel)
        }
    })
    /**
     * 变异 R1 教的一课：把 timingSafeEqual 换成 `!==` **功能测试测不出**（拒绝篡改的结果一样，
     * 差的只是计时侧信道强度）。防"看起来等价"的降级只能靠源码断言——安全属性有时是写法本身。
     */
    test('签名比对必须走 timingSafeEqual（功能测试看不见的降级，源码断言看得见）', () => {
        const code = fs.readFileSync(path.join(SRC, 'tools/signedBlob.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        assert.match(code, /crypto\.timingSafeEqual/, '验签路径丢了 timingSafeEqual')
        assert.ok(!/if\s*\(String\(sig\)\s*!==|sig\s*!==\s*expect/.test(code), '出现了对签名的普通字符串比较')
    })
})
