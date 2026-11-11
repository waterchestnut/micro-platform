import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {recoverOneCandidate, REQUIRED_DEPS} from '../../../services/agent/recoverCandidate.js'

/**
 * 恢复轮处理"一条候选"的行为测试。
 *
 * **这个文件存在的理由就是一条 dev 实测的 bug**（§25 v1.84）：
 * 上一版这段逻辑写在 `tasks/agentTaskRecover.js` 的循环里，那个文件一 import 就连 mongo，
 * 于是它的每一条分支都没被测试执行过——守卫全是读源码文本。
 * dev 第一次真跑 direct 分支就抛 `TypeError: Assignment to constant variable.`
 * （里层 `const claim` 遮蔽外层 `let claim`，而三条成功路径都有 `claim = null`），
 * 结果是：任务被正常执行了，`触发` 计数与"恢复触发"日志却没有，
 * 而且 catch 里那条"异常时释放认领"永远读到 null —— **守卫绿着一片，分支是死的**。
 *
 * 所以下面这些用例的共同点：**它们真的把分支跑一遍**，断言的是调用次序与副作用，
 * 而不是文件里出现了某串字符。
 */

/**
 * 按 **pino 的真实语义**格式化一行日志（dev 实测出来的行为，不是我以为的）：
 * - 第一个参数是字符串、消息里有 `%s/%d/%o` 等占位符 ⇒ 按位插值，多余的参数**被丢掉**；
 * - 第一个参数是对象 ⇒ 当作 merge 字段，第二个参数才是消息。
 * 为什么要这么麻烦：如果假日志器照单全收（把第二个参数也记下来），
 * 那"`logger.error(msg, err)` 丢掉错误详情"这个真实缺陷就永远测不出来——
 * 这与本仓 §25 v1.83 记的那次"假 redlock 抛了个正好叫 LockedError 的类"是同一类错误。
 *
 * @param {Array} args logger.info(...) 的原始参数
 * @returns {String} 实际会落到日志里的那一行
 */
function pinoLike(args) {
    const [first, ...rest] = args
    if (first !== null && typeof first === 'object') {
        return `${JSON.stringify(first)} ${typeof rest[0] === 'string' ? rest[0] : ''}`.trim()
    }
    let i = 0
    const msg = String(first).replace(/%[sdifoOj]/g, (m) => (i < rest.length ? String(rest[i++]) : m))
    /** 没有占位符接通的多余参数：pino 不输出，这里也不输出 */
    return msg
}

/**
 * @description 造一份记录调用的假依赖（顺序也记下来，顺序本身就是判据）
 * @param {Object} [opt] 选项
 * @returns {Object} {deps, calls, logs}
 */
function fakeDeps(opt = {}) {
    const calls = []
    const logs = {info: [], warn: [], error: []}
    const lock = opt.lock === null ? null : {token: 'lk-1', expiration: Date.now() + 60000}
    const claimObj = opt.claim || {state: opt.state || 'granted', lock, reason: opt.reason || 'acquired', ms: 1}
    const deps = {
        acquireClaim: async (p) => {
            calls.push({at: 'acquireClaim', agentCode: p.agentCode, leaseMs: p.leaseMs})
            if (opt.acquireThrows) {
                throw opt.acquireThrows
            }
            return claimObj
        },
        releaseClaim: async (p) => {
            calls.push({at: 'releaseClaim', sameLock: p.lock === claimObj.lock, hadLock: Boolean(p.lock)})
            return {ok: true, reason: 'released'}
        },
        updateTask: async (patch, filter) => {
            const tags = patch.tags || []
            calls.push({
                at: 'updateTask',
                agentCode: filter.agentCode,
                recoverCount: tags.find(t => t.key === 'recoverCount')?.value,
            })
            if (opt.updateThrows) {
                throw opt.updateThrows
            }
            return {modifiedCount: 1}
        },
        getParent: async (code) => {
            calls.push({at: 'getParent', code})
            return opt.parent || null
        },
        send: async (task) => {
            calls.push({at: 'send', agentCode: task.agentCode})
            if (opt.sendThrows) {
                throw opt.sendThrows
            }
        },
        exec: async (task, o) => {
            calls.push({at: 'exec', agentCode: task.agentCode, handedClaim: o?.claim === claimObj, hasLock: Boolean(o?.claim?.lock)})
            if (opt.execThrows) {
                throw opt.execThrows
            }
            return opt.execRet === undefined ? {handleStatus: 0} : opt.execRet
        },
        log: {
            info: (...a) => logs.info.push(pinoLike(a)),
            warn: (...a) => logs.warn.push(pinoLike(a)),
            error: (...a) => logs.error.push(pinoLike(a)),
        },
    }
    if (opt.execSyncThrows) {
        /** 专门用来造"还没返回 promise 就抛"的形态（async 函数做不到，它会变成 rejection） */
        deps.exec = () => {
            calls.push({at: 'exec', agentCode: 'sync-thrown', handedClaim: false, hasLock: false})
            throw opt.execSyncThrows
        }
    }
    return {deps, calls, logs, claimObj}
}

/**
 * @description 让 exec 的 then/catch 链跑完（那条链是 fire-and-forget，不等就等于没测）
 * @returns {Promise<void>} 空
 */
const flush = async () => {
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setImmediate(r))
    }
}

/** 一条普通的候选任务（无父级、额度未用） */
const task = (over = {}) => ({agentCode: 'AG-1', title: '测试任务', tags: [], handleStatus: 0, ...over})

/**
 * @description 取调用序列
 * @param {Array} calls 记录
 * @returns {String} 逗号连接的序列
 */
const seq = (calls) => calls.map(c => c.at).join('>')

describe('direct 模式（dev 上真炸过的那条路径）', () => {
    test('整条分支跑通且不抛错——这就是那条 TypeError 的回归位', async () => {
        const {deps, calls} = fakeDeps()
        const r = await recoverOneCandidate({task: task(), mode: 'direct', leaseMs: 5000, deps})
        assert.equal(r.outcome, 'triggered', JSON.stringify(r))
        assert.equal(r.recoverCount, 1)
        assert.ok(!calls.some(c => c.at === 'releaseClaim'), 'direct 已把认领交出去，本函数再放就是误删别人的锁')
    })

    test('顺序：先取认领，再写 recoverCount，最后才执行（跳过时不许烧额度）', async () => {
        const {deps, calls} = fakeDeps()
        await recoverOneCandidate({task: task(), mode: 'direct', leaseMs: 5000, deps})
        assert.equal(seq(calls), 'acquireClaim>updateTask>exec', `实际顺序 ${seq(calls)}`)
    })

    test('认领是**交接**给执行侧的同一个对象（不是重新取一次锁）', async () => {
        const {deps, calls} = fakeDeps()
        await recoverOneCandidate({task: task(), mode: 'direct', leaseMs: 5000, deps})
        const e = calls.find(c => c.at === 'exec')
        assert.equal(e.handedClaim, true, '必须把同一个 claim 交出去，否则执行侧会和自己争用同一把锁')
        assert.equal(e.hasLock, true, '交出去的对象里要真有锁，执行侧的 finally 才有东西可放')
    })

    test('leaseMs 原样透传给认领（租约长度是配置说了算，不是模块默认）', async () => {
        const {deps, calls} = fakeDeps()
        await recoverOneCandidate({task: task(), mode: 'direct', leaseMs: 123456, deps})
        assert.equal(calls.find(c => c.at === 'acquireClaim').leaseMs, 123456)
    })

    test('执行结果异步落日志（fire-and-forget 也要能被观测到）', async () => {
        const {deps, logs} = fakeDeps({execRet: {handleStatus: 2}})
        await recoverOneCandidate({task: task(), mode: 'direct', deps, leaseMs: 1000})
        await flush()
        assert.ok(logs.info.some(l => l.includes('恢复执行完成') && l.includes('status=2')), logs.info.join(' | '))
    })

    test('执行侧异步失败：恢复轮本身不失败，但错误文本要落在日志消息里', async () => {
        /**
         * 两件事分开看：
         * - `execAgentTask` 的 promise 被 reject ⇒ 认领已经交出去了，由执行侧的 finally 收尾，
         *   恢复轮不该为此再报一次"恢复失败"（那会把一次执行故障放大成两条互斥的结论）；
         * - 但错误文本必须出现在**消息本身**里：pino 的 `logger.error(msg, err)` 在没有 `%s`
         *   占位符时会把第二个参数丢掉（dev 实测那条"恢复失败"只剩一行、堆栈全无）。
         *   所以判据是"消息里带文本"，不是"调用了 error"。
         */
        const {deps, logs} = fakeDeps({execThrows: new Error('boom-执行炸了')})
        const r = await recoverOneCandidate({task: task(), mode: 'direct', deps})
        await flush()
        assert.equal(r.outcome, 'triggered', '异步失败不该改变本轮已经触发成功的事实')
        assert.ok(logs.error.some(l => l.includes('boom-执行炸了')), `错误文本被丢了：${JSON.stringify(logs.error)}`)
    })
})

describe('拿不到认领时的处置', () => {
    test('held ⇒ blocked，且一个数据动作都没做（recoverCount 不烧）', async () => {
        const {deps, calls, logs} = fakeDeps({state: 'held'})
        const r = await recoverOneCandidate({task: task(), mode: 'direct', deps, leaseMs: 1000})
        assert.equal(r.outcome, 'blocked')
        assert.equal(r.state, 'held')
        assert.match(r.reason, /^recover-need-claim:held$/)
        assert.equal(seq(calls), 'acquireClaim', `跳过的行不该再有任何副作用：${seq(calls)}`)
        assert.ok(logs.info.some(l => l.includes('恢复跳过')), '日志要说出为什么跳过')
    })

    test('unavailable 也跳过（恢复是额外安全网，没保护时不动手）', async () => {
        const {deps, calls} = fakeDeps({state: 'unavailable', reason: 'lock-layer-unreachable:x'})
        const r = await recoverOneCandidate({task: task(), mode: 'direct', deps, leaseMs: 1000})
        assert.equal(r.outcome, 'blocked')
        assert.match(r.reason, /^recover-need-claim:unavailable$/)
        assert.equal(calls.filter(c => c.at === 'updateTask').length, 0)
    })

    test('两种跳过都要留得下不同的日志（"没救"与"救不了"不能同形）', async () => {
        const a = fakeDeps({state: 'held'})
        const b = fakeDeps({state: 'unavailable'})
        await recoverOneCandidate({task: task(), mode: 'direct', deps: a.deps})
        await recoverOneCandidate({task: task(), mode: 'direct', deps: b.deps})
        const la = a.logs.info.join('|')
        const lb = b.logs.info.join('|')
        assert.ok(la.includes('state=held') && lb.includes('state=unavailable'), `${la} / ${lb}`)
    })
})

describe('requeue 模式', () => {
    test('投递后自己放锁，且不交给执行侧', async () => {
        const {deps, calls} = fakeDeps()
        const r = await recoverOneCandidate({task: task(), mode: 'requeue', deps, leaseMs: 1000})
        assert.equal(r.outcome, 'requeued')
        assert.equal(seq(calls), 'acquireClaim>updateTask>send>releaseClaim', `实际 ${seq(calls)}`)
        assert.equal(calls.find(c => c.at === 'releaseClaim').sameLock, true, '放的必须是刚取到的那把锁')
    })

    test('send 抛错 ⇒ 已取到的认领被释放（不能占到租约到期）', async () => {
        const {deps, calls} = fakeDeps({sendThrows: new Error('kafka-down')})
        await assert.rejects(() => recoverOneCandidate({task: task(), mode: 'requeue', deps}), /kafka-down/)
        const rel = calls.find(c => c.at === 'releaseClaim')
        assert.ok(rel, `send 失败后没有释放认领：${seq(calls)}`)
        assert.equal(rel.sameLock, true)
    })
})

describe('异常路径的释放（这条在 dev 上曾是死代码）', () => {
    test('记数写库失败 ⇒ 释放刚取到的认领并上抛', async () => {
        const {deps, calls} = fakeDeps({updateThrows: new Error('mongo-write-concern')})
        await assert.rejects(() => recoverOneCandidate({task: task(), mode: 'direct', deps}), /mongo-write-concern/)
        const rel = calls.find(c => c.at === 'releaseClaim')
        assert.ok(rel, `写库失败后没有释放：${seq(calls)}`)
        assert.equal(rel.hadLock, true, '释放时必须真的拿着锁')
        assert.equal(rel.sameLock, true)
    })

    test('exec 同步抛错 ⇒ 也释放（顺序是"先调用成功、再交出手"）', async () => {
        const {deps, calls} = fakeDeps({execSyncThrows: new Error('sync-boom')})
        await assert.rejects(() => recoverOneCandidate({task: task(), mode: 'direct', deps}), /sync-boom/)
        const rel = calls.find(c => c.at === 'releaseClaim')
        assert.ok(rel, `同步抛错时漏了释放：${seq(calls)}`)
        assert.equal(rel.hadLock, true)
    })

    test('取锁本身失败 ⇒ 不该去放一把不存在的锁', async () => {
        const {deps, calls} = fakeDeps({acquireThrows: new Error('redis-down')})
        await assert.rejects(() => recoverOneCandidate({task: task(), mode: 'direct', deps}), /redis-down/)
        assert.equal(calls.filter(c => c.at === 'releaseClaim').length, 0)
    })
})

describe('还没轮到它的那些情况', () => {
    test('额度用完 ⇒ 连认领都不取（每轮少 10 次无意义往返）', async () => {
        const {deps, calls} = fakeDeps()
        const r = await recoverOneCandidate({
            task: task({tags: [{key: 'recoverCount', value: '2'}]}), maxRecover: 2, mode: 'direct', deps,
        })
        assert.equal(r.outcome, 'quota-exhausted')
        assert.equal(calls.length, 0, `不该有任何副作用：${seq(calls)}`)
    })

    test('同父前置兄弟未完成 ⇒ 不取认领', async () => {
        const {deps, calls} = fakeDeps({
            parent: {subAgents: [{agentCode: 'A', handleStatus: 0}, {agentCode: 'AG-1', handleStatus: 0}]},
        })
        const r = await recoverOneCandidate({task: task({parentCode: 'P1'}), mode: 'direct', deps})
        assert.equal(r.outcome, 'waiting-siblings')
        assert.equal(seq(calls), 'getParent', `实际 ${seq(calls)}`)
    })

    test('前置兄弟都已终结 ⇒ 放行到认领这一步', async () => {
        const {deps, calls} = fakeDeps({
            parent: {subAgents: [{agentCode: 'A', handleStatus: 2}, {agentCode: 'AG-1', handleStatus: 0}]},
        })
        const r = await recoverOneCandidate({task: task({parentCode: 'P1'}), mode: 'direct', deps})
        assert.equal(r.outcome, 'triggered')
        assert.ok(seq(calls).startsWith('getParent>acquireClaim'), seq(calls))
    })
})

describe('依赖注入的边界（防止"测试里悄悄用了真库"）', () => {
    test('少给任何一个依赖都立刻报出缺哪个', async () => {
        for (const k of REQUIRED_DEPS) {
            const {deps} = fakeDeps()
            const partial = {...deps}
            delete partial[k]
            /** `recoverOneCandidate` 是 async：里面的 throw 是 rejection，所以断言必须用 rejects */
            await assert.rejects(
                () => recoverOneCandidate({task: task(), deps: partial}),
                (e) => e.message === `recover-candidate-missing-dep:${k}`,
                `缺 ${k} 时没有明确报错`
            )
        }
    })

    test('没有 agentCode 的行走不通（不静默跳过一条候选）', async () => {
        const {deps} = fakeDeps()
        await assert.rejects(() => recoverOneCandidate({task: {}, deps}), /recover-candidate-no-agent-code/)
    })

    test('maxRecover 传了非正数时按 2 处理（配置面漏了也不裸奔）', async () => {
        const {deps} = fakeDeps({state: 'granted'})
        const r = await recoverOneCandidate({
            task: task({tags: [{key: 'recoverCount', value: '2'}]}), maxRecover: 0, mode: 'direct', deps,
        })
        assert.equal(r.outcome, 'quota-exhausted')
    })
})

describe('假日志器本身也必须受现实约束', () => {
    /**
     * 这一组钉的是**测试替身**，不是产品代码。理由是本仓已经栽过两次
     * （§25 v1.83：假 redlock 抛了个真库里不存在的 `LockedError`，于是 33 条用例一起自洽地错）：
     * 替身比现实宽松时，绿灯证明的是替身，不是行为。
     */
    test('没有占位符时第二个参数被丢掉（pino 的真实行为，dev 实测过）', () => {
        assert.equal(pinoLike(['只看这一行', new Error('堆栈不见了')]), '只看这一行')
    })

    test('写成 `%s` 就能带出来（所以修法是插值而不是换日志器）', () => {
        assert.equal(pinoLike(['失败: %s', 'boom']), '失败: boom')
    })

    test('首参是对象时按 pino 的 merge 语义处理，第二参才是消息', () => {
        const line = pinoLike([{agentCode: 'AG-1'}, '恢复失败'])
        assert.ok(line.includes('恢复失败') && line.includes('AG-1'), line)
    })

    test('多余的占位符不报错、原样留下（不会因为测试替身而假绿）', () => {
        assert.equal(pinoLike(['a %s %s', 'only-one']), 'a only-one %s')
    })
})
