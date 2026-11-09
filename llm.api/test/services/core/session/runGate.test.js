import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    decideAdmission,
    rejectResponse,
    rejectShouldAlert,
    GATE_REJECT_CODE,
} from '../../../../services/core/session/runGate.js'

/**
 * 并发闸的判定穷举。
 * 闸这种东西平时不出声，出事时一次判错就是"整站拒答"或"整站不打自开"，
 * 所以每条边界都要有用例，包括**看起来太简单而不用测**的那条（关闸）。
 */

describe('decideAdmission', () => {
    test('limit=0 就是关闸：admit 恒真，且 reason 说清是"没开"不是"有余量"', () => {
        for (const active of [0, 5, 999]) {
            const d = decideAdmission({active, limit: 0})
            assert.equal(d.admit, true)
            assert.equal(d.reason, 'gate-off')
            /** 关闸时观测字段仍然要在：读数不该因为功能没开就消失 */
            assert.equal(d.active, active)
        }
        assert.equal(decideAdmission({active: 3}).admit, true, '不配 limit 也等于关闸')
    })

    test('未到上限放行，到了上限就拒', () => {
        assert.equal(decideAdmission({active: 1, limit: 2}).admit, true)
        assert.equal(decideAdmission({active: 2, limit: 2}).admit, false)
        assert.equal(decideAdmission({active: 3, limit: 2}).admit, false)
        const d = decideAdmission({active: 2, limit: 2})
        assert.equal(d.code, GATE_REJECT_CODE)
        assert.equal(d.reason, 'global-full')
    })

    test('单用户上限：只拒同一个人，不影响别人', () => {
        const d = decideAdmission({active: 1, limit: 10, userActive: 2, perUserLimit: 2})
        assert.deepEqual({admit: d.admit, reason: d.reason}, {admit: false, reason: 'user-full'})
        assert.equal(decideAdmission({active: 1, limit: 10, userActive: 1, perUserLimit: 2}).admit, true)
    })

    /**
     * 顺序是有意的：总量满先拒。
     * 若先判个人额度，一个人就能靠"我还没超个人上限"把总闸吃穿——那是把闸改成先到先得的抢锁。
     */
    test('总量满优先于个人额度', () => {
        const d = decideAdmission({active: 5, limit: 5, userActive: 0, perUserLimit: 3})
        assert.equal(d.reason, 'global-full')
    })

    test('perUserLimit=0 表示不限个人（而不是"一个人都不许"）', () => {
        assert.equal(decideAdmission({active: 0, limit: 5, userActive: 99, perUserLimit: 0}).admit, true)
    })

    test('脏值不当成"开了闸"', () => {
        assert.equal(decideAdmission({active: 9, limit: 'abc'}).admit, true, 'NaN 视作关闸')
        assert.equal(decideAdmission({active: 9, limit: -1}).admit, true, '负数视作关闸，不是全拒')
    })
})

describe('rejectResponse：拒绝的对外形态', () => {
    test('HTTP 200 + code 4290，走本项目既有约定', () => {
        const r = rejectResponse({reason: 'global-full', retryAfterMs: 1500})
        assert.equal(r.httpStatus, 200)
        assert.equal(r.bodyCode, 4290)
        assert.equal(r.headers['Retry-After'], '2', 'Retry-After 是秒（RFC），不是毫秒')
    })

    test('两种拒绝的文案能区分开（用户看得懂自己被什么挡住了）', () => {
        assert.match(rejectResponse({reason: 'user-full'}).message, /你有多[个個]|你多个问题|等待其中一个/)
        assert.match(rejectResponse({reason: 'global-full'}).message, /繁忙/)
    })

    /** 给 0 会被读成"立刻重试"，那等于自己造重试风暴 */
    test('retryAfterMs=0 时干脆不给 Retry-After 头', () => {
        assert.deepEqual(rejectResponse({reason: 'global-full', retryAfterMs: 0}).headers, {})
    })
})

describe('rejectShouldAlert：把"被拒"和"出事"分开', () => {
    test('普通满额不告警：闸拒的是流量，不是故障', () => {
        assert.equal(rejectShouldAlert({admit: false, reason: 'global-full', active: 5, limit: 5}), false)
    })
    test('持续顶穿才响：在途远超上限说明上游大面积变慢或闸值配小了', () => {
        assert.equal(rejectShouldAlert({admit: false, reason: 'global-full', active: 8, limit: 5}), true)
    })
    test('个人额度满永不告警（那是一个人的行为，不是系统状态）', () => {
        assert.equal(rejectShouldAlert({admit: false, reason: 'user-full', active: 99, limit: 5}), false)
    })
    test('放行的不告警', () => {
        assert.equal(rejectShouldAlert({admit: true, reason: 'ok', active: 0, limit: 5}), false)
    })
})
