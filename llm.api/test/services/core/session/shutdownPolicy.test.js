import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    resolveCloseGraceDelay,
    socketCloseAbortDecision,
    shutdownArchiveFields,
    shutdownArchiveDecision,
    DEFAULT_CLOSE_GRACE_MS,
    CLOSE_RESERVE_MS,
} from '../../../../services/core/session/shutdownPolicy.js'

/**
 * 停机路径的决策测试。
 * 每条用例都对应一个**已经实测发生过**的错误，不是拿来凑覆盖率的：
 * 尤其第一条——它就是"P-10 至今没有现场证据"的一半原因。
 */

describe('resolveCloseGraceDelay', () => {
    test('env 是字符串 "45000" 时必须变成数字 45000（旧写法传字符串，close-with-grace 当成无上限）', () => {
        const r = resolveCloseGraceDelay({envValue: '45000'})
        assert.equal(typeof r.delayMs, 'number', 'delayMs 必须是 number：close-with-grace 只认 typeof === "number"')
        assert.equal(r.delayMs, 45000)
        assert.equal(r.applied, true)
        assert.equal(r.reason, 'from-env')
    })

    test('这条是"实测 104s"的直接对应物：字符串进、不换算 ⇒ 没有延迟', () => {
        /** 旧代码的形状：`process.env.X || 25000`，值一直是 string，从没被 Number 化 */
        const oldValueShape = '45000'
        assert.notEqual(typeof oldValueShape, 'number')
        /** 新代码的形状：一定是 number */
        assert.equal(typeof resolveCloseGraceDelay({envValue: oldValueShape}).delayMs, 'number')
    })

    test('没设 env ⇒ 用默认 25000，且 reason 说清是默认', () => {
        const r = resolveCloseGraceDelay({})
        assert.equal(r.delayMs, DEFAULT_CLOSE_GRACE_MS)
        assert.equal(r.reason, 'default')
        assert.equal(r.applied, true)
    })

    test('env 写了非数字（比如 45s）不能静默变成"无上限"，要退回默认并 applied:false', () => {
        const r = resolveCloseGraceDelay({envValue: '45s'})
        assert.equal(r.delayMs, DEFAULT_CLOSE_GRACE_MS)
        assert.equal(r.applied, false)
        assert.match(r.reason, /不是正整数毫秒/)
    })

    test('0 / 负数 / 带单位 都退回默认并 applied:false；空串等价"没设"', () => {
        for (const v of ['0', '-5', '45000ms']) {
            const r = resolveCloseGraceDelay({envValue: v})
            assert.equal(typeof r.delayMs, 'number', `v=${v} 必须是 number`)
            assert.ok(r.delayMs > 0, `v=${v} 应当有正宽限`)
            assert.equal(r.applied, false, `v=${v} 应报 applied:false，否则又是"写了不生效"`)
        }
        /** 空串/空格/未设 = 没配置，这不算错误：applied true、reason 'default' */
        for (const v of ['', '  ', undefined, null]) {
            const r = resolveCloseGraceDelay({envValue: v})
            assert.equal(r.applied, true, `v=${JSON.stringify(v)} 应视为未设置`)
            assert.equal(r.reason, 'default')
        }
    })

    test('宽限超过 grace 减余量 ⇒ 钳制（"两个必要条件"里被忽略的那一半）', () => {
        const r = resolveCloseGraceDelay({envValue: '90000', terminationGraceSeconds: 60})
        assert.equal(r.delayMs, 60000 - CLOSE_RESERVE_MS)
        assert.match(r.reason, /clamped/)
    })

    test('grace 60 配 env 45000 ⇒ 原样采纳（这就是 dev/prod 现在的组合）', () => {
        const r = resolveCloseGraceDelay({envValue: '45000', terminationGraceSeconds: 60})
        assert.equal(r.delayMs, 45000)
        assert.equal(r.reason, 'from-env')
    })

    test('grace 未知（没配）时不钳制，但默认 25000 仍小于 k8s 默认 30s', () => {
        const r = resolveCloseGraceDelay({})
        assert.equal(r.delayMs, 25000)
        assert.ok(r.delayMs < 30000)
    })

    test('grace 只有 30s 时，默认 25000 也要被钳到 20000：宁可宽限短、也要把落档跑完', () => {
        const r = resolveCloseGraceDelay({terminationGraceSeconds: 30})
        assert.equal(r.delayMs, 20000)
        assert.match(r.reason, /clamped/)
    })
})

describe('socketCloseAbortDecision', () => {
    test('关闭期间的断开**不打断**在途 run（发版不该被记成"用户自己取消"）', () => {
        const r = socketCloseAbortDecision({closing: true, destroyed: true})
        assert.equal(r.abort, false)
        assert.equal(r.reason, 'shutdown-draining')
    })

    test('非关闭期的 destroyed ⇒ 仍是用户打断（保持现有语义，不改行为）', () => {
        const r = socketCloseAbortDecision({closing: false, destroyed: true})
        assert.equal(r.abort, true)
        assert.equal(r.reason, 'client-disconnect')
    })

    test('正常收尾的 close（没 destroyed）不打断', () => {
        assert.deepEqual(socketCloseAbortDecision({closing: false, destroyed: false}),
            {abort: false, reason: 'orderly-close'})
    })

    test('已经打断过就幂等，不再改判', () => {
        assert.deepEqual(socketCloseAbortDecision({closing: true, destroyed: true, aborted: true}),
            {abort: false, reason: 'already-aborted'})
    })
})

describe('shutdownArchiveFields / Decision', () => {
    test('progress=abort 且原因另存 interruptedBy（一个字段不许表达两件事）', () => {
        const f = shutdownArchiveFields({answerContent: '写了一半', elapsedMs: 1234})
        assert.equal(f.progress, 'abort')
        assert.equal(f.interruptedBy, 'process-lost')
        assert.equal(f.answerChars, 4)
        assert.equal(f.elapsedMs, 1234)
        assert.equal(f.error, 'shutdown:sigterm')
    })

    test('零正文不写空气泡（否则用户看到一条没内容的气泡，账本也分不出有没有救回）', () => {
        assert.deepEqual(shutdownArchiveDecision({answerChars: 0}), {write: false, reason: 'no-content'})
        assert.deepEqual(shutdownArchiveDecision({answerChars: 12, persisted: true}),
            {write: false, reason: 'already-persisted'})
        assert.deepEqual(shutdownArchiveDecision({answerChars: 12}), {write: true, reason: 'partial-content'})
    })

    test('正文字数用 String.length 计（与 message.answer 的 $strLenCP 同口径，别混 token）', () => {
        assert.equal(shutdownArchiveFields({answerContent: '一二三'}).answerChars, 3)
    })
})
