import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    resolveCloseGraceDelay,
    socketCloseAbortDecision,
    shutdownArchiveFields,
    shutdownArchiveDecision,
    DEFAULT_CLOSE_GRACE_MS,
    CLOSE_RESERVE_MS,
    PERSIST_VIA,
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

    test('preStop 必须从同一个窗口里扣：grace 60 + preStop 5 ⇒ 上限 60−5−10=45s（以前算成 50s，等于把这 5 秒用了两次）', () => {
        const r = resolveCloseGraceDelay({envValue: '90000', terminationGraceSeconds: 60, preStopSeconds: '5'})
        assert.equal(r.delayMs, 60000 - 5000 - CLOSE_RESERVE_MS)
        assert.match(r.reason, /preStop 5s/)
    })

    test('dev/prod 现行组合在计入 preStop 之后仍然合法：45000 恰好等于上限（贴线，不是有余量）', () => {
        const r = resolveCloseGraceDelay({envValue: '45000', terminationGraceSeconds: 60, preStopSeconds: '5'})
        assert.equal(r.delayMs, 45000)
        assert.equal(r.applied, true)
        assert.equal(r.reason, 'from-env')
    })

    test('preStop 是垃圾值时不能把预算变成 NaN；字符串数字要照用（清单里读出来就是字符串）', () => {
        const junk = resolveCloseGraceDelay({envValue: '90000', terminationGraceSeconds: 60, preStopSeconds: 'abc'})
        assert.equal(junk.delayMs, 60000 - CLOSE_RESERVE_MS, '垃圾 preStop 必须当成 0，不能污染算术')
        const ten = resolveCloseGraceDelay({envValue: '90000', terminationGraceSeconds: 60, preStopSeconds: '10'})
        assert.equal(ten.delayMs, 60000 - 10000 - CLOSE_RESERVE_MS)
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

describe('PERSIST_VIA（档案来源标记）', () => {
    /**
     * 这个枚举本身不值钱，值钱的是它让"这条档是谁写的"成为可读事实。
     * 源仓连续三轮验收（v1.40 的 0 字 abort、v1.43 的"档案比 abort 事件晚 1 秒"）
     * 都因为缺这个标记而无法归因，只能再花一次长流去猜。
     */
    test('三个 abort 站点各有各的标签，`unattributed` 只留给确实没带来源的', () => {
        assert.equal(PERSIST_VIA.LOOP_ENTRY, 'loop-entry')
        assert.equal(PERSIST_VIA.LOOP_EXIT, 'loop-exit')
        assert.equal(PERSIST_VIA.FINALIZE_INTERRUPTED, 'finalize-interrupted')
        assert.notEqual(PERSIST_VIA.LOOP_ENTRY, PERSIST_VIA.UNATTRIBUTED, '站点标签不许就是兜底值')
        assert.notEqual(PERSIST_VIA.LOOP_EXIT, PERSIST_VIA.UNATTRIBUTED, '同上')
    })

    test('取值互不相同，且没有一个是看起来合理的假来源', () => {
        const vs = Object.values(PERSIST_VIA)
        assert.equal(new Set(vs).size, vs.length, `取值必须互不相同：${vs.join(',')}`)
        assert.ok(vs.includes('unattributed'), '保留 unattributed：宁可读到"没区分"，也不给一个假来源')
        assert.ok(!vs.includes('unknown'), '不许用 unknown 当默认：它会让"我没接线"看起来像"数据本身不明"')
    })

    test('抢救、早停、回填是三个不同来源（顺序事故只能靠这三者区分）', () => {
        assert.equal(PERSIST_VIA.RESCUE, 'rescue')
        assert.equal(PERSIST_VIA.EARLY_STOP, 'early-stop')
        assert.equal(PERSIST_VIA.BACKFILL, 'backfill')
        /** 抢救先落、run 后跑完却被 persistTurn 幂等挡住——这种事故要能从档上读出来 */
        assert.notEqual(PERSIST_VIA.RESCUE, PERSIST_VIA.NORMAL)
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
