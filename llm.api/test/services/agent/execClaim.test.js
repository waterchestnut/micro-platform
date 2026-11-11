import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import {
    claimResource, acquireClaim, extendClaim, releaseClaim, claimDecision, shouldRenew, leaseSafety,
    DEFAULT_LEASE_MS, CLAIM_RESOURCE_PREFIX,
} from '../../../services/agent/execClaim.js'
import {buildRecoverFilter, DEFAULT_RECOVER_WINDOW_MS} from '../../../services/agent/recoverPolicy.js'

/**
 * agentTask 执行认领。
 *
 * 这个模块是**包在本仓既有的 redlock 上**的，不是第二套锁实现
 * （`daos/redlock.js` + `updateAgentTaskWithLock` 已经存在，`safeUnlock` 还处理过过期后 release 卡死的坑）。
 * 所以下面最值得测的三件事是：
 * 1. 三值状态：`granted` / `held`（被占）/ `unavailable`（问不到）——后两者压成一个布尔就会让"没救"看起来像"救不了"；
 * 2. 角色相反的失败姿态：executor 继续、recover 跳过；
 * 3. 不许有"假装成功"的分支：没有 extend 能力要说不能续，已过期的锁不许再 release。
 */

/** 底层客户端关掉时 redlock 内部可能抛的错（本模块只用它构造"探测也失败"的场景） */
class ClientClosedError extends Error {}

/**
 * @description 造一个假锁
 * @param {Object} [opt] 选项
 * @returns {Object} 锁对象与调用记录
 */
function fakeLock(opt = {}) {
    const calls = {extend: 0, release: 0}
    const lock = {
        calls,
        expiration: opt.expiration ?? (Date.now() + 60000),
        resource: opt.resource || 'execAgentTask:AG-1',
    }
    if (!opt.noExtend) {
        lock.extend = async (ms) => {
            calls.extend++
            if (opt.throwOnExtend) {
                throw new ClientClosedError('Connection is closed.')
            }
            lock.expiration = Date.now() + Number(ms)
            return lock
        }
    }
    if (!opt.noRelease) {
        lock.release = async () => {
            calls.release++
            if (opt.throwOnRelease) {
                throw new ClientClosedError('Connection is closed.')
            }
            return true
        }
    }
    return lock
}

/**
 * redlock 5.0.0-beta.2 的真实形状（dev 实测，不是我从文档记忆里写的）：
 * **争用与"连不上"抛的是同一个 `ExecutionError`**，消息也相同，`attempts` 里读不出票型。
 * 所以测试必须用这个形状，而不是我第一版假库抛的那个"正好叫 LockedError"的类——
 * 那样测试和假库会自洽地验证一个真实库里不存在的机制。
 */
class ExecutionError extends Error {}

/**
 * @description 造一个假 redlock（clients 支持 get，供可达性探测）
 * @param {Object} [opt] 选项
 * @returns {Object} {redlock, calls}
 */
function fakeRedlock(opt = {}) {
    const calls = {acquire: [], locks: 0}
    const client = {
        async get() {
            if (opt.clientDown) {
                throw new Error('Connection is closed.')
            }
            return null
        },
    }
    const redlock = {
        calls,
        clients: new Set([client]),
        async acquire(resources, duration, settings) {
            calls.acquire.push({resources: resources.slice(), duration, settings})
            if (opt.locked) {
                throw new ExecutionError('The operation was unable to achieve a quorum during its retry window.')
            }
            if (opt.broken) {
                throw new ExecutionError('The operation was unable to achieve a quorum during its retry window.')
            }
            const lock = opt.makeLock ? opt.makeLock(resources[0]) : fakeLock({resource: resources[0]})
            calls.locks++
            return lock
        },
    }
    return {redlock, calls}
}

/**
 * @description 造一个注入 redlock 的取用函数
 * @param {Object|null} redlock 实例
 * @returns {Function} getter
 */
const getterOf = (redlock) => async () => redlock

describe('资源命名', () => {
    test('资源名带任务号，且与更新互斥的 updateAgentTask: 前缀不同', () => {
        assert.equal(claimResource('AG-9'), `${CLAIM_RESOURCE_PREFIX}:AG-9`)
        assert.notEqual(claimResource('AG-9'), 'updateAgentTask:AG-9',
            '两种生命周期共用一个资源名会互相误伤：更新互斥是 5s 量级，执行认领是分钟量级')
    })
})

describe('acquireClaim：三值状态', () => {
    test('拿到锁是 granted，并带上锁对象与耗时', async () => {
        const {redlock, calls} = fakeRedlock()
        const r = await acquireClaim({agentCode: 'AG-1', getRedlock: getterOf(redlock), leaseMs: 5000})
        assert.equal(r.state, 'granted')
        assert.ok(r.lock, 'granted 必须把锁交回去，否则调用方无法续期/释放')
        assert.equal(calls.acquire[0].duration, 5000)
        assert.deepEqual(calls.acquire[0].resources, ['execAgentTask:AG-1'])
        assert.equal(typeof r.ms, 'number')
    })

    test('资源被占是 held（不是 unavailable）', async () => {
        const {redlock} = fakeRedlock({locked: true})
        const r = await acquireClaim({agentCode: 'AG-2', getRedlock: getterOf(redlock)})
        assert.equal(r.state, 'held')
        assert.match(r.reason, /^locked:/)
        assert.equal(r.probe, 'reachable', '分态的依据是可达性探测，不是错误类名——真实库里两者抛的是同一个 ExecutionError')
    })

    test('客户端坏了是 unavailable，且与 held 分得开（靠探测而不是猜）', async () => {
        /**
         * 真实库里"被占"和"连不上"抛的是同一个 `ExecutionError`、同一句消息（dev 实测）。
         * 所以这里必须让探测也失败，才能得到 unavailable——
         * 只换个错误类名就分态，是在测试我的假库而不是在测试行为。
         */
        const {redlock} = fakeRedlock({broken: true, clientDown: true})
        const r = await acquireClaim({agentCode: 'AG-3', getRedlock: getterOf(redlock)})
        assert.equal(r.state, 'unavailable')
        assert.match(r.reason, /^lock-layer-unreachable:/)
        assert.equal(r.probe, 'unreachable')
    })

    test('探测无从下手时不许当成"被占"（unknown 与 held 不是一回事）', async () => {
        const {redlock} = fakeRedlock({broken: true})
        /** 把 clients 换成拿不到可探测对象的样子 */
        redlock.clients = new Set([{}])
        const r = await acquireClaim({agentCode: 'AG-3b', getRedlock: getterOf(redlock)})
        assert.equal(r.state, 'unavailable')
        assert.equal(r.probe, 'unknown')
    })

    test('取锁必须显式带 retryCount:0（争用 2187ms → 1ms 是实测结论，不是调优偏好）', async () => {
        const {redlock, calls} = fakeRedlock()
        await acquireClaim({agentCode: 'AG-rr0', getRedlock: getterOf(redlock), leaseMs: 4000})
        assert.deepEqual(calls.acquire[0].settings, {retryCount: 0},
            `丢了它就会把 2 秒争用等待加回执行路径，实际传的是 ${JSON.stringify(calls.acquire[0].settings)}`)
    })

    test('锁层根本不存在 ⇒ unavailable/no-lock-layer', async () => {
        const r = await acquireClaim({agentCode: 'AG-4', getRedlock: getterOf(null)})
        assert.equal(r.state, 'unavailable')
        assert.equal(r.reason, 'no-lock-layer')
    })

    test('getRedlock 自己抛错也不能冒泡到调用方', async () => {
        const r = await acquireClaim({
            agentCode: 'AG-5',
            getRedlock: async () => {
                throw new Error('模块加载失败')
            },
        })
        assert.equal(r.state, 'unavailable')
        assert.match(r.reason, /^get-lock-layer:/, `异常必须被收进 reason，实际 ${r.reason}`)
        assert.equal(r.lock, null)
    })

    test('没有 agentCode 时直接判不可用，不去拿一个猜测的资源名', async () => {
        const {redlock, calls} = fakeRedlock()
        const r = await acquireClaim({agentCode: '', getRedlock: getterOf(redlock)})
        assert.equal(r.state, 'unavailable')
        assert.equal(r.reason, 'no-agent-code')
        assert.equal(calls.acquire.length, 0, '一次都不该打')
    })

    test('非法 leaseMs 退回默认值（不能让 undefined 变成 0ms 的租约）', async () => {
        for (const bad of [0, -5, NaN, 'abc', undefined, null]) {
            const {redlock, calls} = fakeRedlock()
            const r = await acquireClaim({agentCode: `AG-${String(bad)}`, getRedlock: getterOf(redlock), leaseMs: bad})
            assert.equal(r.state, 'granted', String(bad))
            assert.equal(calls.acquire.at(-1).duration, DEFAULT_LEASE_MS,
                `非法 leaseMs=${String(bad)} 必须退回默认 ${DEFAULT_LEASE_MS}，实际 ${calls.acquire.at(-1).duration}`)
        }
    })
})

describe('extendClaim：不许假装续期成功', () => {
    test('正常续期会把过期时间推后', async () => {
        const lock = fakeLock({expiration: Date.now() + 100})
        const r = await extendClaim({lock, leaseMs: 9000})
        assert.equal(r.ok, true)
        assert.equal(lock.calls.extend, 1)
        assert.ok(lock.expiration > Date.now() + 8000)
    })

    test('锁对象缺 extend 能力 ⇒ ok:false，而不是静默当成续上了', async () => {
        /**
         * 这条是本轮最容易写错的地方：如果"没有 extend"被当成成功，
         * 租约会在无人察觉时到期，认领保护形同虚设——**恢复照样可能双跑**。
         */
        const lock = fakeLock({noExtend: true})
        const r = await extendClaim({lock, leaseMs: 9000})
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'extend-unsupported')
    })

    test('extend 抛错 ⇒ ok:false 且带原因', async () => {
        const lock = fakeLock({throwOnExtend: true})
        const r = await extendClaim({lock, leaseMs: 9000})
        assert.equal(r.ok, false)
        assert.match(r.reason, /^extend-failed:/)
    })

    test('没有锁时不做事（也不报错）', async () => {
        const r = await extendClaim({lock: null})
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'no-lock')
    })
})

describe('releaseClaim：沿用 safeUnlock 的教训', () => {
    test('已过期的锁**不再 release**（redlock 会进重试路径，能把收尾卡住）', async () => {
        const lock = fakeLock({expiration: Date.now() - 1})
        const r = await releaseClaim({lock})
        assert.equal(r.ok, true)
        assert.equal(r.skipped, true)
        assert.equal(r.reason, 'already-expired')
        assert.equal(lock.calls.release, 0, '一次都不该调')
    })

    test('正常释放会调用 release', async () => {
        const lock = fakeLock()
        const r = await releaseClaim({lock})
        assert.equal(r.reason, 'released')
        assert.equal(lock.calls.release, 1)
    })

    test('release 抛错只降级并告警，不影响任务结果', async () => {
        const warns = []
        const lock = fakeLock({throwOnRelease: true})
        const r = await releaseClaim({lock, logger: {warn: (m) => warns.push(m)}})
        assert.equal(r.ok, false)
        assert.match(r.reason, /^release-failed:/)
        assert.equal(warns.length, 1)
    })

    test('没拿到锁时释放是 no-op（executor 在 held 下继续跑就是这个情形）', async () => {
        const r = await releaseClaim({lock: null})
        assert.equal(r.ok, true)
        assert.equal(r.skipped, true)
    })
})

describe('claimDecision：两种角色相反的失败姿态（本模块的全部要点）', () => {
    test('executor：granted/held/unavailable 都继续执行', () => {
        /**
         * 正常路径本来就是被派下来跑的。因为拿不到锁就不执行，
         * 等于把一个可选的去重机制升级成新的故障模式（用户任务直接不动）——那比它想防的双跑更糟。
         */
        for (const state of ['granted', 'held', 'unavailable']) {
            assert.equal(claimDecision({role: 'executor', state}).proceed, true, state)
        }
        assert.match(claimDecision({role: 'executor', state: 'held'}).reason, /unprotected/)
        assert.match(claimDecision({role: 'executor', state: 'unavailable'}).reason, /no-claim-layer/)
    })

    test('recover：只有 granted 才动作', () => {
        assert.equal(claimDecision({role: 'recover', state: 'granted'}).proceed, true)
        for (const state of ['held', 'unavailable', '??']) {
            const d = claimDecision({role: 'recover', state})
            assert.equal(d.proceed, false, `recover 在 ${state} 下不许执行——这正是认领存在的目的`)
            assert.match(d.reason, new RegExp(`recover-need-claim:${state}`))
        }
    })

    test('漏传 role 默认 executor（不能把正常路径变成"要认领才跑"）', () => {
        assert.equal(claimDecision({state: 'held'}).proceed, true)
        assert.equal(claimDecision({}).proceed, true)
    })
})

describe('leaseSafety：两个必须一起想的数（接线前的硬前提）', () => {
    test('租约与滞留阈值的关系：阈值至少要 2 倍于租约', () => {
        assert.equal(leaseSafety({leaseMs: 15 * 60 * 1000, stuckMs: 30 * 60 * 1000}).ok, true, '刚好 2 倍应通过')
        const tooSmall = leaseSafety({leaseMs: 15 * 60 * 1000, stuckMs: 20 * 60 * 1000})
        assert.equal(tooSmall.ok, false)
        assert.match(tooSmall.reason, /^stuck-too-small:/)
    })

    test('非法值不能算"安全"', () => {
        for (const bad of [0, -1, NaN, 'x', null]) {
            assert.equal(leaseSafety({leaseMs: bad, stuckMs: 30 * 60 * 1000}).ok, false, `lease=${String(bad)}`)
            assert.equal(leaseSafety({leaseMs: 1000, stuckMs: bad}).ok, false, `stuck=${String(bad)}`)
        }
    })

    test('undefined 走默认参数、null 不走（JS 默认参数只对 undefined 生效）', () => {
        /**
         * 这条不是为测 JS，而是把"配置缺失"与"配置写了个空值"分开：
         * 前者按默认判定（合理），后者是**写坏了的值**，必须报不安全。
         * 混起来的话，一个把 env 误设成空的部署会看起来"检查通过"。
         */
        assert.equal(leaseSafety({leaseMs: undefined, stuckMs: 30 * 60 * 1000}).ok, true, '未传=按默认租约判定')
        assert.equal(leaseSafety({leaseMs: null, stuckMs: 30 * 60 * 1000}).ok, false, '显式 null 必须判不安全')
    })

    test('margin<=1 时退回 2（不能让"余量为 0 甚至负"通过检查）', () => {
        assert.equal(leaseSafety({leaseMs: 1000, stuckMs: 1500, margin: 1}).ok, false)
        assert.equal(leaseSafety({leaseMs: 1000, stuckMs: 1500, margin: 0}).ok, false)
        assert.equal(leaseSafety({leaseMs: 1000, stuckMs: 2000, margin: 0}).ok, true)
    })

    test('跨文件不变量：现行配置默认值必须真的满足这条关系', async () => {
        /**
         * 这才是这条判定的意义所在：`DEFAULT_LEASE_MS` 在 execClaim 里，
         * 滞留阈值在 `conf/system.config.js` 的 `cron.recoverStuckMs` 里——**两个文件各改一半**
         * 就能让保护静默失效，所以断言必须横跨两边，而不是只测函数本身。
         */
        global.llm = global.llm || {logger: {info() {}, warn() {}, error() {}}, config: {}, tools: {}}
        const mod = await import(`../../../conf/system.config.js?t=${Date.now()}-${Math.random()}`)
        const stuckMs = mod.default.cron.recoverStuckMs
        const r = leaseSafety({leaseMs: DEFAULT_LEASE_MS, stuckMs})
        assert.equal(r.ok, true, `现行默认值不安全：lease=${DEFAULT_LEASE_MS}, stuck=${stuckMs} ⇒ ${r.reason}`)
        /**
         * 上面那对是"模块默认 × 配置默认"，还不够：运行期真正用的是
         * `agentTask.execLeaseMs` 与 `cron.recoverStuckMs` 这两个**配置值**。
         * 两个键都在配置里，改任何一个都只会在部署时暴露——所以这里也得判一次。
         */
        const leaseCfg = Number(mod.default.agentTask.execLeaseMs)
        assert.equal(typeof leaseCfg, 'number', 'execLeaseMs 必须是数字')
        assert.ok(Number.isInteger(leaseCfg), 'redlock 要求时长是整数毫秒，非整数会直接抛错')
        const r2 = leaseSafety({leaseMs: leaseCfg, stuckMs})
        assert.equal(r2.ok, true, `配置层这一对不安全：lease=${leaseCfg}, stuck=${stuckMs} ⇒ ${r2.reason}`)
    })
})

describe('shouldRenew：别让每帧都打锁层', () => {
    test('用掉一半租约才续', () => {
        assert.equal(shouldRenew({sinceRenewMs: 0, leaseMs: 1000}), false)
        assert.equal(shouldRenew({sinceRenewMs: 499, leaseMs: 1000}), false)
        assert.equal(shouldRenew({sinceRenewMs: 500, leaseMs: 1000}), true)
        assert.equal(shouldRenew({sinceRenewMs: 9999, leaseMs: 1000}), true)
    })

    test('leaseMs 非法时不续（不能拿 NaN 去比较）', () => {
        for (const bad of [0, -1, NaN, 'abc', undefined]) {
            assert.equal(shouldRenew({sinceRenewMs: 99999, leaseMs: bad}), false, String(bad))
        }
    })

    test('ratio 越界退回 0.5', () => {
        assert.equal(shouldRenew({sinceRenewMs: 500, leaseMs: 1000, ratio: 0}), true)
        assert.equal(shouldRenew({sinceRenewMs: 100, leaseMs: 1000, ratio: 5}), false)
    })

    test('默认租约是正数', () => {
        assert.equal(typeof DEFAULT_LEASE_MS, 'number')
        assert.ok(DEFAULT_LEASE_MS > 0)
    })
})

describe('接线状态（两侧必须同批接，半接线等于假保护）', () => {
    /**
     * v1.82 时这里钉的是"两侧都没接"；v1.84 接完之后钉的是"两侧都接了"。
     * 保留这条的原因不是记录历史，而是它防的那个错误还在：
     * **只接恢复侧**时，恢复会去尊重一个没人持有的租约——永远抢到、永远判"可救"，
     * 日志还写着"已按认领判定安全"。那比不接更糟。
     */
    /**
     * @description 读本仓源码
     * @param {String} rel 相对本测试文件的路径
     * @returns {String} 内容
     */
    const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

    test('执行侧已接：execAgentTask 是包装层，核心流程在 execAgentTaskCore', () => {
        const src = read('../../../services/agent/index.js')
        for (const name of ['acquireClaim', 'extendClaim', 'releaseClaim', 'claimDecision']) {
            assert.ok(src.includes(name), `执行侧少了 ${name} 的引用`)
        }
        assert.match(src, /export async function execAgentTask\(agentTaskInfo, opts = \{\}\)/,
            '认领必须挂在导出的包装层上，否则六个调用方各接一遍')
        assert.match(src, /async function execAgentTaskCore\(agentTaskInfo\)/, '核心流程应改名为 execAgentTaskCore')
        assert.ok(/finally \{[\s\S]{0,400}releaseClaim\(/.test(src), '释放必须在 finally：否则抛错就把锁占到租约到期')
    })

    test('恢复侧已接，且与执行侧同时（不许只有一边）', () => {
        /**
         * 恢复侧现在是两层的：`tasks/agentTaskRecover.js` 取数并把副作用注入，
         * `services/agent/recoverCandidate.js` 才是真正做认领判定与交接的地方。
         * 所以"接没接"要同时看两个文件——只看任务文件会漏掉"注入了但从没调用"这种半接。
         */
        const wiresTask = /recoverOneCandidate\(/.test(read('../../../tasks/agentTaskRecover.js'))
        const holdsClaim = /deps\.acquireClaim\(/.test(read('../../../services/agent/recoverCandidate.js'))
        const inExec = /acquireClaim/.test(read('../../../services/agent/index.js'))
        assert.equal(inExec && holdsClaim && wiresTask, true,
            `接线状态不一致：executor=${inExec}, candidate=${holdsClaim}, task=${wiresTask}——半接线等于假保护`)
    })

    /**
     * 下面这些原先是"读源码文本"的守卫（认领早于 recoverCount、交接给执行侧、异常时释放、
     * 跳过必须由 decision 把门），本轮**全部改成真跑分支的断言**，位置在
     * `test/services/agent/recoverCandidate.test.js`。
     * 迁移动机是一条 dev 实测的 bug（§25 v1.84）：那段代码里的 `const claim` 遮蔽了外层 `let claim`，
     * 每次真恢复都抛 TypeError，而**这些文本守卫全部绿灯**——
     * 它们只证明了字在，没证明分支走得通。守卫留着只会给人一种已经验证过的错觉。
     */

    test('执行侧同样要由 decision 把门并如实记录未获保护', () => {
        /**
         * 为什么这一条还是文本断言：`services/agent/index.js` 一 import 就会连 mongo
         * （它的调用方都是 dac/处理器），所以执行侧包装层**没有行为测试**，只能靠文本守卫。
         * 这条限制写在这里而不是藏在心里：文本守卫只证明"字在"，不证明"分支走得通"——
         * 本轮 dev 上那条 TypeError 就是被同类守卫放过去的（见上面那段迁移说明）。
         * 真要补上行为测试，就得把包装层也照 `recoverCandidate` 那样做依赖注入，那是另一刀。
         */
        const src = read('../../../services/agent/index.js')
        assert.match(src, /claimDecision\(\{role: 'executor', state: got\.state\}\)/,
            '执行侧也要按结果决策（虽然它的结论永远是继续）')
        assert.match(src, /if \(got\.state !== 'granted'\)[\s\S]{0,300}logger\.warn/,
            '未获认领保护必须留下日志：这一轮执行是无防护的，事后要能查出来')
    })

    test('启动时校验"租约 vs 滞留阈值"这对比值（运维改配置时测试看不见）', () => {
        const src = read('../../../tasks/agentTaskRecover.js')
        assert.match(src, /const leaseCheck = leaseSafety\(\{/, '开机必须算一次')
        assert.match(src, /if \(!leaseCheck\.ok\)[\s\S]{0,240}logger\.warn/, '不满足必须吵')
    })

    test('续期用真实时间戳判定，不许拿常量自己比自己（那会恒真）', () => {
        const src = read('../../../services/agent/index.js')
        assert.match(src, /let lastRenewAt = Date\.now\(\)/, '要有上次续期时刻')
        assert.match(src, /sinceRenewMs: Date\.now\(\) - lastRenewAt/,
            '拿 leaseMs/2 当分子、leaseMs 当分母是一条恒真的装饰判断，测不出任何东西')
        assert.match(src, /renewTimer\.unref\?\.\(\)/, '后台定时器不能把进程钉在关闭流程里')
    })
})

describe('扫描判据（2026-11-11 dev 实测的病，不许悄悄长回来）', () => {
    /**
     * 实测到的事：候选 5211 条、批次上限 10、按 updateTime 升序取前 N，
     * 队首是一批永不收敛的派发型行（只在循环里 `continue`、从不被更新），
     * 于是新滞后的任务永远进不了本轮——近 7 天 103 条滞留行 `recoverCount` 全为 0，
     * 轮次日志 `触发=0, 跳过=0`。认领保护接得再对，也保护不到一条扫不到的路径。
     */
    /**
     * @description 读本仓源码
     * @param {String} rel 相对本测试文件的路径
     * @returns {String} 内容
     */
    const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    const task = read('../../../tasks/agentTaskRecover.js')

    /**
     * 注释里提到 `1800000` 是**讲解**（"别再各写一遍"），不是判据本身。
     * 所以那些"不许出现 X"的断言只该看代码行——否则下一条解释性注释就会把守卫弄红，
     * 而被人改掉的通常是注释，不是缺陷。
     *
     * @param {String} src 源码
     * @returns {String} 去掉注释行之后的源码
     */
    const stripComments = (src) => src.split(/\r?\n/).filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    const code = stripComments(task)

    test('扫描用的就是 buildRecoverFilter（判据有唯一出处）', () => {
        assert.match(task, /const filter = buildRecoverFilter\(\{/, '判据必须来自策略层')
        assert.match(task, /complexFilter: filter,/, '取数必须用那份判据，而不是自己再拼一个条件')
    })

    test('循环里不再留第二份派发型判据（两处各写一遍就有"哪份说了算"）', () => {
        assert.doesNotMatch(code, /includes\(task\.agentType\)/,
            '排除必须发生在取数时；写在循环里，那 10 个批次名额已经被占掉了才跳过')
        assert.doesNotMatch(code, /\['sequential',\s*'parallel',\s*'dynamic'\]/,
            '名单只允许存在于 recoverPolicy.DISPATCH_AGENT_TYPES')
    })

    test('滞留阈值与窗口的默认值不在任务里各写一遍（三份默认值必然漂移）', () => {
        assert.doesNotMatch(code, /1800000/, '硬编码的 30 分钟兜底')
        assert.doesNotMatch(code, /30 \* 60 \* 1000/, '同上，另一种写法')
        assert.match(task, /const STUCK_MS = Number\(config\.cron\?\.recoverStuckMs\) \|\| DEFAULT_RECOVER_STUCK_MS/,
            '滞留阈值只在这里解析一次，日志、leaseSafety、窗口解析都引用它')
    })

    test('窗口解析失败会吵（空区间看起来就是"今天很干净"）', () => {
        assert.match(task, /const windowCfg = resolveRecoverWindow\(\{/, '启动时解析一次')
        assert.match(task, /windowCfg\.reason\.startsWith\('invalid:'\)[\s\S]{0,200}logger\.warn/,
            '配错值必须 warn，与 recoverMode 同等待遇')
        assert.match(task, /params\.windowMs !== undefined && !windowResolved\.applied[\s\S]{0,160}logger\.warn/,
            'HTTP 入参传了个无效窗口也要说出来，不能静默按默认跑')
    })

    test('每轮都报"窗口外滞留"，两个出口共用一份格式（含扫到 0 条的那些轮）', () => {
        assert.match(task, /function roundLine\(p\) \{[\s\S]{0,260}窗口外滞留=\$\{p\.stale\}/,
            '轮次日志必须由一个构造函数产出')
        const uses = (task.match(/roundLine\(\{/g) || []).length
        assert.equal(uses, 2, `roundLine 应当被两个出口各用一次（空轮与正常轮），实际 ${uses} 次`)
        /**
         * 这串文案只允许出现在构造函数里一次。
         * （上一版我写成"不许再出现这串文案"，结果被 `roundLine` 自己的函数体判红——
         * 负向断言如果不说清"在哪出现算违规"，它挡住的会是修好的人而不是写坏的人。）
         */
        const hits = task.split('agentTask 恢复轮结束:').length - 1
        assert.equal(hits, 1, `轮次日志文案应当只在 roundLine 里出现一次，实际 ${hits} 次`)
        const fnAt = task.indexOf('function roundLine(p)')
        const litAt = task.indexOf('agentTask 恢复轮结束:')
        assert.ok(fnAt > 0 && litAt > fnAt && litAt - fnAt < 400, '唯一那次必须在 roundLine 内部')
        assert.match(task, /const stale = await agentTaskDac\.getCount\(\{[\s\S]{0,320}updateTime: \{\$lt: filter\.updateTime\.\$gte\}/,
            '计数必须用同一条判据的补集（窗口左边界），否则两个数字说的不是同一件事')
    })

    test('陈旧行确实被窗口挡住：用真判据对三行样本（形状检查，非 mongo 行为证明）', () => {
        const stuckMs = 30 * 60 * 1000
        const f = buildRecoverFilter({stuckMs, windowMs: DEFAULT_RECOVER_WINDOW_MS})
        const inWindow = (minsAgo) => {
            const t = Date.now() - minsAgo * 60000
            return t < +f.updateTime.$lt && t >= +f.updateTime.$gte
        }
        assert.equal(inWindow(45), true, '刚滞留的必须看得见')
        assert.equal(inWindow(7 * 60), false, '超出 6 小时窗口的不救（实测这类行有 4922 条 grpc 的）')
        assert.equal(inWindow(5), false, '还没到滞留阈值的不算候选')
        assert.ok(f.agentType.$nin.includes('dynamic') && f.agentType.$nin.includes('sequential'),
            '实测占死队首的就是这两类')
    })
})
