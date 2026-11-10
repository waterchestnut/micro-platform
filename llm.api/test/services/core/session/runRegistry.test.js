import {test, describe, beforeEach} from 'node:test'
import * as assert from 'node:assert'
import {
    admitRun,
    releaseRun,
    snapshot,
    resetForTest,
    attachArchive,
    detachArchive,
    archiveCount,
    archiveAllInflight,
} from '../../../../services/core/session/runRegistry.js'

/**
 * 并发闸的计数侧。
 * 这里最重要的一条是**不泄漏**：一个永久占着的格子会让闸"越用越紧"，
 * 症状是全站变慢/拒答，看起来完全不像自己写的 bug——所以 `leakGuard` 必须自己会说话。
 */
const CFG = {limit: 2, perUserLimit: 0, retryAfterMs: 1500}

beforeEach(() => {
    resetForTest()
})

describe('archives（停机抢救表）', () => {
    /**
     * 这一组用例守的是一条会静默失效的坑：
     * 闸默认是**关**的（`limits_concurrentRuns=0`），而 `runRegistry` 在关闸时刻意不登记。
     * 如果停机落档复用了那张表，默认配置下集合恒空 ⇒
     * "我们修好了停机丢档"这句话会在所有没开闸的环境里悄悄变成假的。
     */
    test('关闸时 archives 依然可用（抢救能力不能依赖闸开不开）', () => {
        const admitted = admitRun({messageCode: 'm1', userCode: 'u1', cfg: {limit: 0}})
        assert.equal(admitted.admit, true)
        assert.equal(snapshot().active, 0, '关闸时登记表必须是空的——正因如此才不能复用它')
        assert.equal(attachArchive('m1', async () => {}), true)
        assert.equal(archiveCount(), 1)
    })

    test('attach 需要 messageCode 与函数，缺一个就返回 false（静默挂不上是最难查的）', () => {
        assert.equal(attachArchive('', async () => {}), false)
        assert.equal(attachArchive('m1', null), false)
        assert.equal(attachArchive('m1', async () => {}), true)
        assert.equal(archiveCount(), 1)
    })

    test('detach 之后不再被抢救（正常收尾的 run 不该在关闭时被重复落档）', () => {
        let hits = 0
        attachArchive('m1', async () => { hits++ })
        assert.equal(detachArchive('m1'), true)
        assert.equal(detachArchive('m1'), false, '重复摘要能看出来')
        return archiveAllInflight({}).then(() => assert.equal(hits, 0))
    })

    test('archiveAllInflight 逐条回报结果，且一条失败不影响其他条', async () => {
        const done = []
        attachArchive('ok1', async () => { done.push('ok1') })
        attachArchive('boom', async () => { throw new Error('写库失败') })
        attachArchive('ok2', async () => { done.push('ok2') })
        const rs = await archiveAllInflight({perRunTimeoutMs: 1000, now: () => 0})
        assert.equal(rs.length, 3)
        assert.deepEqual(rs.map(r => `${r.messageCode}:${r.ok}`), ['ok1:true', 'boom:false', 'ok2:true'])
        assert.match(rs.find(r => r.messageCode === 'boom').error, /写库失败/)
        /** 失败的原文要带回来：只有 ok/false 的回报无法判断"落档为什么没落" */
        assert.deepEqual(done, ['ok1', 'ok2'])
    })

    test('单条卡住会被超时切断，而不是拖死整个关闭序列', async () => {
        attachArchive('hang', () => new Promise(() => {}))
        const t = Date.now()
        const out = await archiveAllInflight({perRunTimeoutMs: 60})
        assert.equal(out.length, 1)
        assert.equal(out[0].ok, false)
        assert.match(out[0].error, /timeout 60ms/)
        assert.ok(Date.now() - t >= 55, '确实等到了超时点，不是提前返回')
    })
})

describe('admitRun / releaseRun', () => {
    test('关闸时不登记：active 恒 0，不产生任何状态', () => {
        const r = admitRun({messageCode: 'm1', userCode: 'u1', cfg: {limit: 0}})
        assert.equal(r.admit, true)
        assert.equal(snapshot().active, 0, 'limit=0 就不该往表里写')
        assert.equal(snapshot().admitted, 0)
    })

    test('到量就拒，且拒掉的不占格子', () => {
        assert.equal(admitRun({messageCode: 'm1', userCode: 'u1', cfg: CFG}).admit, true)
        assert.equal(admitRun({messageCode: 'm2', userCode: 'u2', cfg: CFG}).admit, true)
        const third = admitRun({messageCode: 'm3', userCode: 'u3', cfg: CFG})
        assert.equal(third.admit, false)
        assert.equal(third.response.body.code, 4290)
        /** 四端的错误通道只认 `success:false`，缺了它拒绝会渲染成空回答 ⇒ 在这里也钉一次 */
        assert.equal(third.response.body.success, false)
        assert.equal(third.response.body.data.reason, 'global-full')
        assert.equal(snapshot().active, 2)
        assert.equal(snapshot().rejected, 1)
    })

    test('释放一格后立刻能再进一格（不是只进不出）', () => {
        admitRun({messageCode: 'm1', userCode: 'u1', cfg: CFG})
        admitRun({messageCode: 'm2', userCode: 'u2', cfg: CFG})
        assert.equal(admitRun({messageCode: 'm3', cfg: CFG}).admit, false)
        assert.equal(releaseRun('m1'), true)
        assert.equal(admitRun({messageCode: 'm3', cfg: CFG}).admit, true)
    })

    /** 重发同一个 messageCode 不能白占两格：闸会被自己的重试喂满 */
    test('同一 messageCode 重复登记只占一格', () => {
        admitRun({messageCode: 'dup', userCode: 'u1', cfg: CFG})
        admitRun({messageCode: 'dup', userCode: 'u1', cfg: CFG})
        assert.equal(snapshot().active, 1)
        assert.equal(snapshot().admitted, 1)
        releaseRun('dup')
        assert.equal(snapshot().active, 0)
    })

    test('release 幂等：重复注销不报错、不多减，但 overRelease 会记上一笔', () => {
        admitRun({messageCode: 'm1', cfg: CFG})
        assert.equal(releaseRun('m1'), true)
        assert.equal(releaseRun('m1'), false)
        const s = snapshot()
        assert.equal(s.active, 0)
        assert.equal(s.overRelease, 1, '重复注销要能单独查出来')
        /** 账仍然是平的：多减一次不该让 accountingGap 变形，否则它就无法在"在途中"当哨兵用 */
        assert.equal(s.accountingGap, 0)
    })

    test('没有 messageCode 时不登记（宁可不限流，也不留一个注销不掉的条目）', () => {
        const r = admitRun({messageCode: '', cfg: CFG})
        assert.equal(r.admit, true)
        assert.equal(r.decision.reason, 'no-message-code')
        assert.equal(snapshot().active, 0)
    })

    test('单用户额度按用户数，不误伤别人', () => {
        const cfg = {limit: 10, perUserLimit: 1}
        admitRun({messageCode: 'a1', userCode: 'u1', cfg})
        const same = admitRun({messageCode: 'a2', userCode: 'u1', cfg})
        assert.equal(same.admit, false)
        assert.equal(same.decision.reason, 'user-full')
        assert.equal(admitRun({messageCode: 'b1', userCode: 'u2', cfg}).admit, true)
    })

    test('snapshot 带 oldestMs：长跑的 run 能从读数里看出来（闸满了时这是关键线索）', async () => {
        admitRun({messageCode: 'm1', cfg: CFG})
        const t0 = snapshot().oldestMs
        assert.ok(t0 >= 0)
        await new Promise(r => setTimeout(r, 12))
        assert.ok(snapshot().oldestMs > t0)
    })

    /**
     * 哨兵必须**在在途中也成立**，否则它只能在事后报警，而"闸越用越紧"恰恰是要在用的时候发现。
     * 上一版的 `leakGuard` 做不到这点（正常在途时它就是负数），所以换成 `accountingGap`。
     */
    test('在途期间 accountingGap 恒为 0（这才是"账平"的判据）', () => {
        admitRun({messageCode: 'g1', userCode: 'u1', cfg: CFG})
        admitRun({messageCode: 'g2', userCode: 'u2', cfg: CFG})
        assert.equal(snapshot().active, 2)
        assert.equal(snapshot().accountingGap, 0, '两个还在跑，账仍然平')
        releaseRun('g1')
        assert.equal(snapshot().accountingGap, 0)
        releaseRun('g2')
        assert.equal(snapshot().accountingGap, 0)
    })

    /** 这条是"异常路径也要注销"的机制证明：路由的 finally 靠的是 release 可安全重入 */
    test('正常/异常/断开三种收尾走同一个 release，状态都归零', () => {
        for (const path of ['ok', 'throw', 'abort']) {
            admitRun({messageCode: `m-${path}`, userCode: 'u1', cfg: CFG})
            try {
                if (path === 'throw') {
                    throw new Error('上游炸了')
                }
            } catch (e) {
                    /** 路由会吞掉它并下发 error 帧，这里只关心"收尾照样走到 finally" */
                    assert.match(e.message, /上游炸了/)
            } finally {
                releaseRun(`m-${path}`)
            }
        }
        const s = snapshot()
        assert.equal(s.active, 0)
        assert.equal(s.released, 3)
        assert.equal(s.accountingGap, 0, '登记 3 次、注销 3 次、表里 0 个 ⇒ 账平')
        assert.equal(s.overRelease, 0, '三条收尾路径都只注销各自那一个')
    })
})
