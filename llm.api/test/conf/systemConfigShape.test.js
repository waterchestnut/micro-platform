import {test, describe} from 'node:test'
import * as assert from 'node:assert'

/**
 * `conf/system.config.js` 的**形状**断言。
 *
 * 起因是一条今天才发现的既存缺陷（与本轮功能无关）：`upstreamRetry` 少了一个闭合 `},`，
 * 而那个括号被写到了 `llmUsageLive` 块之后 —— 括号总数是平的，`node --check` 过得去，
 * 于是 `llmUsageLive` 静静嵌进了 `upstreamRetry` 里面。
 * 后果是 `config.llmUsageLive === undefined`，而读它的代码写的是
 * `config.llmUsageLive?.enabled !== false` ⇒ **恒真**：
 * 实况账本"恰好是开着的"，但 `llmUsageLive_enabled=false` 这个开关**完全无效**。
 * 想临时关掉每 run 实时写库的人会以为自己关掉了。
 *
 * ⇒ 这类"括号错位 + 可选链默认值"的组合不会报错，只会让开关静默失效，
 *    唯一拦得住它的就是**对成品形状做断言**。
 */
global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {},
    tools: {},
}

/**
 * @description 带 query 重新求值配置模块（env 是在模块加载时读的）
 * @param {Object} env 临时环境变量
 * @returns {Promise<Object>} 配置对象
 */
async function loadConfig(env = {}) {
    const saved = {}
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k]
        if (v === undefined) {
            delete process.env[k]
        } else {
            process.env[k] = v
        }
    }
    try {
        const mod = await import(`../../conf/system.config.js?t=${Date.now()}-${Math.random()}`)
        return mod.default
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) {
                delete process.env[k]
            } else {
                process.env[k] = v
            }
        }
    }
}

describe('system.config 的形状（括号错位会让开关静默失效）', () => {
    test('llmUsageLive 必须在顶层：嵌进 upstreamRetry 时读方拿到 undefined，开关等于不存在', async () => {
        const c = await loadConfig()
        assert.ok(Object.prototype.hasOwnProperty.call(c, 'llmUsageLive'),
            'config.llmUsageLive 不在顶层 ⇒ 大概率是某个块少了闭合括号')
        assert.equal(typeof c.llmUsageLive?.enabled, 'boolean')
    })

    test('upstreamRetry 只该有它那四个键，不许吞掉别的配置块', async () => {
        const c = await loadConfig()
        /**
         * 与源仓不同是**刻意的**：模板的 chat 侧只接了"退避 + 熔断 + 首字节护栏"，
         * 档位回退（fallbackModel）需要换档 client map 与窗口可行性检查，模板没实现，
         * 所以 conf 里**不提供这个键**（见 conf/system.config.js 同位置的注释）。
         * 这里仍然断言**精确集合**而不是"包含"——放宽成"包含"就再也照不出"少写一个 } 把下一块吞进来"
         * 那个真实存在过的缺陷。
         */
        assert.deepEqual(Object.keys(c.upstreamRetry).sort(),
            ['baseMs', 'capMs', 'enabled', 'maxAttempts'])
    })

    test('模板不提供 fallbackModel：没实现的开关不该出现在配置面上', async () => {
        const c = await loadConfig()
        assert.equal(Object.prototype.hasOwnProperty.call(c.upstreamRetry, 'fallbackModel'), false,
            '出现了 fallbackModel 却没有对应实现 ⇒ 这是一个"配了没人读"的开关')
    })

    test('llmUsageLive_enabled=false 必须真的能关掉（这正是被嵌套吃掉的那条开关）', async () => {
        const on = await loadConfig({llmUsageLive_enabled: undefined})
        assert.equal(on.llmUsageLive.enabled, true)
        const off = await loadConfig({llmUsageLive_enabled: 'false'})
        assert.equal(off.llmUsageLive.enabled, false, '读到 true 说明 env 没有通路到配置对象')
    })

    test('数值型 env 必须是 number（字符串会在算术里静默变成 0/NaN）', async () => {
        const c = await loadConfig({upstreamRetry_maxAttempts: '7'})
        assert.equal(typeof c.upstreamRetry.maxAttempts, 'number')
        assert.equal(c.upstreamRetry.maxAttempts, 7)
    })
})

describe('upstreamBreaker 配置块', () => {
    test('默认必须是关的，且参数是数字', async () => {
        const c = await loadConfig({upstreamBreaker_enabled: undefined})
        assert.equal(c.upstreamBreaker.enabled, false)
        assert.equal(typeof c.upstreamBreaker.failureThreshold, 'number')
        assert.equal(typeof c.upstreamBreaker.openMs, 'number')
        assert.equal(c.upstreamBreaker.failureThreshold, 5)
        assert.equal(c.upstreamBreaker.openMs, 15000)
    })

    test('env 开的才是开的：字符串 "true" 之外不算启用', async () => {
        const on = await loadConfig({upstreamBreaker_enabled: 'true', upstreamBreaker_openMs: '20000'})
        assert.equal(on.upstreamBreaker.enabled, true)
        assert.equal(on.upstreamBreaker.openMs, 20000)
    })

    test('垃圾值交给 resolveBreakerConfig 兜住，不在配置层崩', async () => {
        const c = await loadConfig({upstreamBreaker_failureThreshold: 'abc'})
        assert.equal(Number.isNaN(c.upstreamBreaker.failureThreshold), true, 'parseInt 出 NaN 是预期，归一层负责退回默认')
    })
})

describe('cron 的 agentTask 恢复参数（模板默认不注册，但配置面要看得见每一个键）', () => {
    test('生效值与判据来源：默认 direct、默认不注册、窗口与阈值不成空区间', async () => {
        const c = await loadConfig({})
        const {resolveRecoverMode, resolveRecoverWindow, buildRecoverFilter} = await import('../../services/agent/recoverPolicy.js')
        assert.equal(c.cron.recoverMode, '', '未配时必须是空串，不能由配置层提前代入默认值')
        const eff = resolveRecoverMode({raw: c.cron.recoverMode})
        assert.equal(eff.mode, 'direct')
        assert.equal(eff.applied, false, '生效值来自默认，必须标出来')
        assert.equal(c.cron.recoverEnabled, false, '模板惯例：默认不注册（与 retentionEnabled/backfillEnabled 同例）')
        const win = resolveRecoverWindow({raw: c.cron.recoverWindowMs, stuckMs: c.cron.recoverStuckMs})
        assert.equal(win.applied, false)
        const f = buildRecoverFilter({stuckMs: c.cron.recoverStuckMs, windowMs: win.windowMs})
        assert.ok(f.updateTime.$gte.getTime() < f.updateTime.$lt.getTime(), '窗口区间为空 ⇒ 恢复天生空转')
        assert.ok(f.agentType.$nin.length > 0, '派发型必须在取数时就排除（源仓实测：否则新任务永远进不了本轮）')
        /** 执行租约与滞留阈值是一对：租约过长会让恢复把在跑的任务判成可救 */
        const {leaseSafety, DEFAULT_LEASE_MS} = await import('../../services/agent/execClaim.js')
        const lease = Number(c.agentTask.execLeaseMs)
        assert.ok(Number.isInteger(lease), 'redlock 要求时长是整数毫秒，非整数会直接抛错')
        const safe = leaseSafety({leaseMs: lease || DEFAULT_LEASE_MS, stuckMs: c.cron.recoverStuckMs})
        assert.equal(safe.ok, true, `出厂配置不安全：${safe.reason}`)
    })
})
