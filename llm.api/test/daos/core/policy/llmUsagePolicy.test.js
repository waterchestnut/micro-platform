import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    LEDGER_PROGRESS,
    DEFAULT_OLDER_THAN_MS,
    abandonedQuery,
    isAbandonedRun,
    validateOlderThan,
} from '../../../../daos/core/policy/llmUsagePolicy.js'

/**
 * `llmUsage` 判据的用例。
 * 重点是最后那组 **policy 与查询同语义** 的交叉断言：
 * dac 用 `abandonedQuery` 生成 mongo 条件，测试用 `isAbandonedRun` 判断单条——
 * 两者必须对同一份输入给同样答案，否则"查出来的遗弃"和"我说它是遗弃"就是两套规则。
 */
const NOW = 1794220000000
const now = () => NOW

describe('abandonedQuery', () => {
    test('默认查 processing 且带 cutoff', () => {
        const q = abandonedQuery({now})
        assert.equal(q.progress, 'processing')
        assert.ok(q.updateTime.$lt instanceof Date)
        assert.equal(q.updateTime.$lt.getTime(), NOW - DEFAULT_OLDER_THAN_MS)
    })

    test('olderThanMs 可覆盖', () => {
        const q = abandonedQuery({olderThanMs: 1000, now})
        assert.equal(q.updateTime.$lt.getTime(), NOW - 1000)
    })
})

describe('isAbandonedRun', () => {
    test('只有 processing 才算遗弃候选：finish/error/abort 都不是', () => {
        for (const p of ['finish', 'error', 'abort', '', undefined]) {
            assert.equal(isAbandonedRun({progress: p, updateTime: new Date(NOW - 99999999), now}), false,
                `${p} 不该被当成遗弃`)
        }
    })

    test('心跳没超阈值的不算（那是正常在途）', () => {
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: new Date(NOW - 5000), now}), false)
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: new Date(NOW - DEFAULT_OLDER_THAN_MS + 1), now}), false)
    })

    test('边界语义：正好等于阈值时不算遗弃（必须与查询的 $lt 同向）', () => {
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: new Date(NOW - DEFAULT_OLDER_THAN_MS), now}), false,
            '等于阈值时查询用 $lt 不会命中，predicate 也不能命中')
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: new Date(NOW - DEFAULT_OLDER_THAN_MS - 1), now}), true)
    })

    /**
     * 没有心跳时间的 processing 行按遗弃算。
     * 这不是偷懒：一行 processing 却连 updateTime 都拿不到，说明写入本身有问题——
     * **宁可多查出来让人看一眼，也不要悄悄漏掉真丢的轮次**。
     */
    test('updateTime 缺失/非法按遗弃处理', () => {
        assert.equal(isAbandonedRun({progress: 'processing', now}), true)
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: 'not-a-date', now}), true)
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: NaN, now}), true)
    })

    test('Date 与毫秒数两种形态都接受（mongo 给 Date，代码里常给数字）', () => {
        const t = NOW - DEFAULT_OLDER_THAN_MS - 10
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: new Date(t), now}), true)
        assert.equal(isAbandonedRun({progress: 'processing', updateTime: t, now}), true)
    })
})

describe('policy 与查询必须同语义（防两套规则漂移）', () => {
    /** 取一批时间点，逐个核对：mongo 条件命中等价于 predicate 为真 */
    const samples = [
        NOW - 1000,
        NOW - DEFAULT_OLDER_THAN_MS + 1,
        NOW - DEFAULT_OLDER_THAN_MS,
        NOW - DEFAULT_OLDER_THAN_MS - 1,
        NOW - 3600000,
    ]
    for (const t of samples) {
        test(`t=now-${NOW - t}ms`, () => {
            const q = abandonedQuery({now})
            const inQuery = t < q.updateTime.$lt.getTime()
            const byPredicate = isAbandonedRun({progress: 'processing', updateTime: new Date(t), now})
            assert.equal(byPredicate, inQuery, `predicate=${byPredicate} 与查询命中=${inQuery} 不一致`)
        })
    }

    test('常量与 schema 的进度取值一致（避免大小写/拼写分家）', () => {
        assert.equal(LEDGER_PROGRESS.PROCESSING, 'processing')
        assert.equal(DEFAULT_OLDER_THAN_MS, 600000)
    })
})

describe('validateOlderThan：阈值不能拍脑袋调小', () => {
    test('默认值通过', () => {
        assert.equal(validateOlderThan(DEFAULT_OLDER_THAN_MS).ok, true)
    })

    /** 这条断言是给"运维觉得 30 秒太慢、想调灵敏"准备的：那会把每次长生成都报成损失 */
    test('小于最长 run 墙钟 3 倍时拒绝', () => {
        const r = validateOlderThan(30000)
        assert.equal(r.ok, false)
        assert.match(r.reason, /误判成损失/)
    })

    test('非正数/非法值拒绝', () => {
        for (const v of [0, -1, 'abc', undefined, null]) {
            assert.equal(validateOlderThan(v).ok, false, `${v} 不该被接受`)
        }
    })
})
