import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {
    RECOVER_MODES, DEFAULT_RECOVER_MODE, resolveRecoverMode, recoverAction,
    DISPATCH_AGENT_TYPES, DEFAULT_RECOVER_WINDOW_MS, DEFAULT_RECOVER_STUCK_MS, resolveRecoverWindow, buildRecoverFilter,
} from '../../../services/agent/recoverPolicy.js'

/**
 * agentTask 恢复方式的决策。
 *
 * 这个模块之所以存在：**源仓把"我们的 consumer 停摆"这条本集群实测当成了普适前提**，
 * 代码里写死成"直接重执行"。换一套部署（消费者健康、只是排得慢）时，
 * 那个前提不成立，直接重执行就会让同一个任务跑两遍——而 agent 任务是有真实副作用的
 * （生成 PPT、上传 doc.api、花上游 token）。
 * 所以把选择权交回配置，同时把"两种模式都没解决双跑"这件事写在能被读到的地方。
 */

describe('resolveRecoverMode', () => {
    test('没设配置时回退到 direct（沿用已实测的行为，不偷偷改默认）', () => {
        const r = resolveRecoverMode({})
        assert.equal(r.mode, DEFAULT_RECOVER_MODE)
        assert.equal(r.mode, 'direct')
        assert.equal(r.applied, false)
        assert.equal(r.reason, 'not-set')
    })

    test('两个合法值都认，且 applied=true（"写了就生效"必须可查）', () => {
        for (const v of ['direct', 'requeue']) {
            const r = resolveRecoverMode({raw: v})
            assert.equal(r.mode, v)
            assert.equal(r.applied, true, `配置写了却没生效：${v}`)
            assert.equal(r.reason, 'from-config')
        }
    })

    test('大小写与空格不影响（env 是人写的，不是从这里长出来的）', () => {
        assert.equal(resolveRecoverMode({raw: ' REQUEUE '}).mode, 'requeue')
        assert.equal(resolveRecoverMode({raw: 'Direct'}).mode, 'direct')
    })

    test('拼错必须露出来：走回退但 applied=false 且 reason 带上原值', () => {
        const r = resolveRecoverMode({raw: 'reque'})
        assert.equal(r.mode, DEFAULT_RECOVER_MODE)
        assert.equal(r.applied, false)
        assert.equal(r.reason, 'invalid:reque')
        /**
         * 为什么这条最要紧：`FASTIFY_CLOSE_GRACE_DELAY` 那次就是"配置写了但不生效"
         * 静默运行了很久（v1.37）。这里靠 applied/reason 让调用方能吵出来。
         */
    })

    test('非字符串输入不崩（yaml/env 偶尔会给出对象或数字）', () => {
        for (const v of [undefined, null, 7, {}, []]) {
            const r = resolveRecoverMode({raw: v})
            assert.ok(['direct', 'requeue'].includes(r.mode), JSON.stringify(v))
            assert.equal(r.applied, false)
        }
    })

    test('fallback 可指定：别的部署想默认 requeue 不该改这个函数', () => {
        const r = resolveRecoverMode({raw: '', fallback: RECOVER_MODES.REQUEUE})
        assert.equal(r.mode, 'requeue')
        assert.equal(r.applied, false)
    })
})

describe('recoverAction：模式翻译成动作', () => {
    test('direct 执行、requeue 投递，没有第三种', () => {
        assert.equal(recoverAction({mode: 'direct'}), 'exec')
        assert.equal(recoverAction({mode: 'requeue'}), 'requeue')
        assert.equal(recoverAction({mode: '乱七八糟'}), 'exec', '兜底走默认动作，但上游 resolveRecoverMode 已经会告警')
        assert.equal(recoverAction({}), 'exec')
    })

    test('动作集合与模式集合一一对应（加模式时必须同时加动作，防漏）', () => {
        const modes = Object.values(RECOVER_MODES)
        const actions = new Set(modes.map(m => recoverAction({mode: m})))
        assert.equal(actions.size, modes.length, `有模式落到了同一个动作：${[...actions].join(',')}`)
    })
})

describe('resolveRecoverWindow：滞留多久的行还值得救（上界）', () => {
    test('没配时用默认 6 小时，并如实标 not-set', () => {
        const r = resolveRecoverWindow({})
        assert.equal(r.windowMs, DEFAULT_RECOVER_WINDOW_MS)
        assert.equal(r.windowMs, 6 * 60 * 60 * 1000)
        assert.equal(r.applied, false)
        assert.equal(r.reason, 'not-set')
    })

    test('合法值生效（运维要能放宽/收紧窗口，不该改代码）', () => {
        const r = resolveRecoverWindow({raw: 24 * 3600 * 1000})
        assert.equal(r.windowMs, 86400000)
        assert.equal(r.applied, true)
        assert.equal(r.reason, 'from-config')
        const r2 = resolveRecoverWindow({raw: ' 10800000 '})
        assert.equal(r2.windowMs, 3 * 3600 * 1000, 'env 读出来是字符串、可能带空格，不该影响生效')
        assert.equal(r2.applied, true)
    })

    test('窗口 <= 滞留阈值：必须走回退并说清原因（空区间看起来像"今天很干净"）', () => {
        const r = resolveRecoverWindow({raw: 10 * 60 * 1000, stuckMs: 30 * 60 * 1000})
        assert.equal(r.windowMs, DEFAULT_RECOVER_WINDOW_MS, '不该按那个会把扫描变成空集的值执行')
        assert.equal(r.applied, false)
        assert.match(r.reason, /^not-longer-than-stuck:/)
        assert.ok(r.reason.includes('600000'), `原因里要能看到原值，实际 ${r.reason}`)
    })

    test('0／负数／非数字／对象都回退，且 reason 带上原值', () => {
        for (const raw of [0, -1, 'abc', {}, [], '   ']) {
            const r = resolveRecoverWindow({raw})
            assert.equal(r.windowMs, DEFAULT_RECOVER_WINDOW_MS)
            assert.equal(r.applied, false, JSON.stringify(raw))
            assert.ok(/^(not-set|invalid:)/.test(r.reason), `${JSON.stringify(raw)} ⇒ ${r.reason}`)
        }
    })

    test('两个默认值本身自洽：默认窗口必须大于默认滞留阈值', () => {
        assert.ok(DEFAULT_RECOVER_WINDOW_MS > DEFAULT_RECOVER_STUCK_MS,
            '否则出厂配置就是一个空扫描')
    })
})

describe('buildRecoverFilter：三个条件各治一个 dev 实测到的病', () => {
    const NOW = Date.UTC(2026, 10, 11, 2, 0, 0)

    test('三条判据都在（缺任何一条都会让恢复轮重新变成空转或事故）', () => {
        const f = buildRecoverFilter({now: NOW, stuckMs: 30 * 60000, windowMs: 6 * 3600 * 1000})
        assert.equal(f.handleStatus, 0, '待救的判据')
        assert.deepEqual(f.agentType.$nin, [...DISPATCH_AGENT_TYPES],
            '派发型必须在**取数时**排除：写在循环里 continue 等于没写，那 10 个批次名额已经被它们占死')
        assert.equal(+f.updateTime.$lt, NOW - 30 * 60000, '滞留下界')
        assert.equal(+f.updateTime.$gte, NOW - 6 * 3600 * 1000, '滞留上界（窗口）：少了它就会去重跑半年前的任务')
    })

    test('窗口 <= 阈值 ⇒ 抛错，不返回一个空条件', () => {
        assert.throws(
            () => buildRecoverFilter({now: NOW, stuckMs: 30 * 60000, windowMs: 10 * 60000}),
            /recover-window-not-longer-than-stuck/,
            '静默的空区间会被读成"没有待恢复的任务"，这正是本次排查被拖长的原因'
        )
        assert.throws(() => buildRecoverFilter({now: NOW, stuckMs: 0, windowMs: 1}), /recover-scan-invalid-ms/)
        assert.throws(() => buildRecoverFilter({now: NOW, stuckMs: 1000, windowMs: NaN}), /recover-scan-invalid-ms/)
    })

    /**
     * 用三行样本对判据做一次真值检查。
     * `hit()` 只复刻本函数实际用到的三个算子（`$nin`、`$lt`、`$gte`）的语义，
     * 它是**判据的形状检查**，不是 mongo 的行为证明——后者由
     * `evals/platform-probes/exec-claim-probe.mjs` 在 dev 真库上做（§25 v1.84 记着两边的分工）。
     * 这样写是为了让"有人把 $gte 删了"或"有人把 dynamic 从名单里拿掉"当场变红。
     *
     * @param {Object} doc 任务行
     * @param {Object} f buildRecoverFilter 的结果
     * @returns {Boolean} 是否会被本轮扫到
     */
    function hit(doc, f) {
        return doc.handleStatus === f.handleStatus
            && !f.agentType.$nin.includes(doc.agentType)
            && doc.updateTime < f.updateTime.$lt
            && doc.updateTime >= f.updateTime.$gte
    }

    test('队首占位行与陈旧行都不该再进本轮，而刚滞留的行必须进', () => {
        const f = buildRecoverFilter({now: NOW, stuckMs: 30 * 60000, windowMs: 6 * 3600 * 1000})
        const mk = (agentType, minsAgo) => ({agentType, handleStatus: 0, updateTime: new Date(NOW - minsAgo * 60000)})
        // 实测里那种占死队首的派发型父任务（滞留一年多）
        assert.equal(hit(mk('dynamic', 60 * 24 * 400), f), false, '派发型仍进得来 ⇒ 恢复轮会继续空转')
        // 实测里 4922 条 grpc/grpcCall 陈旧行（最旧 2026-03-04）
        assert.equal(hit(mk('grpc', 60 * 24 * 220), f), false, '窗口外的陈旧行进得来 ⇒ 修复变成重跑半年前任务')
        // 真正要救的：刚被发版打断的
        assert.equal(hit(mk('grpc', 40), f), true, '40 分钟前滞留的非派发型行不该被排除')
        assert.equal(hit(mk('local', 31), f), true, '刚过阈值就该算候选')
        // 边界：正好等于下界/上界
        assert.equal(hit(mk('grpc', 6 * 60), f), true, '$gte 是闭区间')
        assert.equal(hit(mk('grpc', 30), f), false, '$lt 是开区间：还没到 stuckMs 不算滞留')
    })

    test('名单是唯一的：查询、告警、探针都读这一份', () => {
        assert.deepEqual([...DISPATCH_AGENT_TYPES].sort(), ['dynamic', 'parallel', 'sequential'],
            '这三个是 AgentTypeEnum 里的 dispatch 型；改动它等于改变恢复的可见范围，要连带跑 dev 探针')
        assert.ok(Object.isFrozen(DISPATCH_AGENT_TYPES), '名单被运行时改一处就会波及查询，必须冻结')
    })
})
