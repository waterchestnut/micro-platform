/**
 * @fileOverview 凭据来源审计与启动闸门的用例（PR-E0.2）
 * @module test/tools/secretSources
 * @description
 * 结构与移植性约定（2026-11-14 起）：**机制用例一律吃 FIXTURE**（注入清单），真实 SECRET_DEFAULTS 只用于
 * 第四节的"清单↔源码双向对账"——这样同一个文件在源仓与底座 fork（清单为空 = 无字面量兜底的实况）都逐字可跑。
 * 钉死的语义：
 * 1. "配了空串"必须算没配；
 * 2. 审计输出**永不含值**（这是安全件，不是普通报表）；
 * 3. **默认关 ⇒ 与改造前逐字一致**（只 warn 不抛）；
 * 4. 清单与源码对账是双向的（漏登记 ⇒ 红；登记了但源码已没有 ⇒ 也红）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    SECRET_DEFAULTS, auditSecretSources, summarizeAudit, formatAuditForLog, reportSecretSources,
    decideSecretsPosture, assertSecretEnvPresent,
} from '../../tools/secretSources.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SECRET_DEFAULT_ENVS = SECRET_DEFAULTS.map((d) => d.env)

/** 机制用例的注入清单：真实清单是运维事实，机制不该长在其上（fork/底座空清单也要能测全套机制） */
const FIXTURE = [
    {env: 'fx_alpha_apiKey', field: 'alpha.apiKey', file: 'test-fixture'},
    {env: 'fx_beta_password', field: 'beta.password', file: 'test-fixture'},
    {env: 'fx_gamma_secret', field: 'gamma.secret', file: 'test-fixture'},
]
const FX = FIXTURE.map((d) => d.env)
const fullFx = (v = 'v') => Object.fromEntries(FX.map((e) => [e, v]))

describe('1 auditSecretSources：只回答"env 有没有配"', () => {
    test('全部配齐 ⇒ allSet，且没有任何一项被标记为用兜底', () => {
        const a = auditSecretSources(fullFx(), FIXTURE)
        assert.equal(summarizeAudit(a).allSet, true)
        assert.equal(summarizeAudit(a).usingCodeDefault, 0)
    })
    test('缺一个 ⇒ 那一个标记为用兜底，其余不受影响', () => {
        const env = fullFx()
        delete env.fx_gamma_secret
        assert.deepEqual(summarizeAudit(auditSecretSources(env, FIXTURE)).envNames, ['fx_gamma_secret'])
    })
    test('空串与纯空白 ⇒ 算没配（删兜底那天最容易踩的坑）', () => {
        for (const v of ['', '   ', '\t']) {
            const env = fullFx()
            env.fx_beta_password = v
            const row = auditSecretSources(env, FIXTURE).find((r) => r.env === 'fx_beta_password')
            assert.equal(row.setInEnv, false, `值 ${JSON.stringify(v)} 不该被当成"已配置"`)
        }
    })
    test('非字符串（数字/对象）⇒ 也算没配，不抛', () => {
        for (const v of [0, 1, {}, [], true]) {
            const env = fullFx()
            env.fx_beta_password = v
            assert.equal(auditSecretSources(env, FIXTURE).find((r) => r.env === 'fx_beta_password').setInEnv, false)
        }
    })
    test('整个 env 不传 / 传 null ⇒ 全部兜底，且不抛', () => {
        assert.equal(summarizeAudit(auditSecretSources(null, FIXTURE)).usingCodeDefault, FIXTURE.length)
        assert.equal(summarizeAudit(auditSecretSources(undefined, FIXTURE)).usingCodeDefault, FIXTURE.length)
    })
    test('真实清单为空（fork 实况：无字面量兜底）⇒ 审计返回空数组、allSet，机制不炸', () => {
        const a = auditSecretSources({})
        assert.ok(Array.isArray(a))
        assert.equal(a.length, SECRET_DEFAULTS.length)
        assert.equal(summarizeAudit(a).allSet, SECRET_DEFAULTS.length === 0 || summarizeAudit(a).usingCodeDefault === 0)
    })
})

describe('2 日志安全：审计工具自己绝不带出密钥值', () => {
    test('把真值灌进 env，格式化结果里不许出现任何值', () => {
        const SECRET = 'sk-SUPERSECRET-00000000000000000000'
        const line = formatAuditForLog(auditSecretSources(fullFx(SECRET), FIXTURE))
        assert.ok(!line.includes(SECRET), `日志里出现了 env 的值：${line}`)
    })
    /**
     * 上一版只测了"审计行里不许出现我传进去的那份 env 的值"，于是把 `formatAuditForLog` 改成
     * 追加 `JSON.stringify(process.env)` 时**断言照样绿**——因为它泄漏的是进程环境，不是我注入的假 env。
     * 这条补的是那个洞：**任何**出现在 process.env 里的凭据都不许进日志。
     */
    test('哨兵值：格式化函数若去读 process.env，必须被这条抓住', () => {
        const SENTINEL = 'SENTINEL-DO-NOT-LEAK-7zQx'
        const probeEnv = SECRET_DEFAULTS[0]?.env || 'fx_sentinel_probe_not_a_real_config'
        const prev = process.env[probeEnv]
        process.env[probeEnv] = SENTINEL
        try {
            const line = formatAuditForLog(auditSecretSources({}, SECRET_DEFAULTS))
            assert.ok(!line.includes(SENTINEL), `日志泄漏了进程环境里的值：${line.slice(0, 160)}`)
        } finally {
            if (prev === undefined) {
                delete process.env[probeEnv]
            } else {
                process.env[probeEnv] = prev
            }
        }
    })
    test('格式化函数不得读 process.env（治理工具自己伸手拿凭据，就是新的泄漏面）', () => {
        const src = fs.readFileSync(path.join(SRC, 'tools/secretSources.js'), 'utf8')
        const at = src.indexOf('export function formatAuditForLog')
        const body = src.slice(at, src.indexOf('\n}', at) + 2)
        assert.ok(!/process\.env/.test(body), 'formatAuditForLog 里出现了 process.env')
    })
    test('全部配齐时给的是"无兜底"这一句；有兜底时指得出是哪几个 env', () => {
        assert.match(formatAuditForLog(auditSecretSources(fullFx(), FIXTURE)), /全部来自 env/)
        const env = fullFx()
        delete env.fx_alpha_apiKey
        const line = formatAuditForLog(auditSecretSources(env, FIXTURE))
        assert.match(line, /fx_alpha_apiKey/)
        assert.match(line, /1 项正在用代码兜底/)
    })
})

describe('3 reportSecretSources：该 warn 才 warn，且不许崩', () => {
    test('有兜底 ⇒ warn 一次，内容是审计行', () => {
        const seen = []
        const audit = reportSecretSources({warn: (m) => seen.push(m)}, {}, FIXTURE)
        assert.equal(seen.length, 1)
        assert.match(seen[0], /凭据来源审计/)
        assert.equal(audit.length, FIXTURE.length)
    })
    test('全配齐 ⇒ 一条都不发（这不是故障，不该每次启动都喊）', () => {
        const seen = []
        reportSecretSources({warn: (m) => seen.push(m)}, fullFx(), FIXTURE)
        assert.deepEqual(seen, [])
    })
    test('logger 缺 warn / 是 null ⇒ 不抛（启动路径上不能因为治理代码崩掉）', () => {
        assert.doesNotThrow(() => reportSecretSources(null, {}, FIXTURE))
        assert.doesNotThrow(() => reportSecretSources({}, {}, FIXTURE))
    })
})

describe('4 清单与源码对账（防"治理工具描述的是三年前的代码"——这里用真实清单）', () => {
    /**
     * 扫源码里 `process.env[...] || '<字面量>'` 形态的凭据兜底。
     * **判据是字段名，不是值的形状。** 上一版我加了"长度≥8、大小写混排"这类值启发式，
     * 结果 5 字符的 redis 密码和 8 字符的 mongo 密码全被漏掉——清单看起来齐了，实际只覆盖 1/5。
     */
    function scanLiteralDefaults() {
        const files = ['conf/system.config.js', 'conf/llmModel.js']
        const hits = new Set()
        const NAME_IS_SECRET = /(apiKey|pass|password|secret|token)/i
        for (const rel of files) {
            const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n')
            const code = lines.filter((l) => !/^(\/\/|\/\*|\*)/.test(l.trim())).map((l) => l.trim()).join('\n')
            for (const m of code.matchAll(/process\.env(?:\.([A-Za-z0-9_]+)|\[['"`]([^'"`]+)['"`]\])[\s\S]{0,40}?\|\|\s*['"`]([^'"`\n]{1,})['"`]/g)) {
                const name = m[1] || m[2]
                const value = m[3]
                if (!name || !NAME_IS_SECRET.test(name)) continue
                if (!value.trim()) continue
                hits.add(name)
            }
        }
        return hits
    }
    test('源码里每一处凭据兜底都在清单里（新增兜底 ⇒ 这条先红）', () => {
        const found = scanLiteralDefaults()
        const unlisted = [...found].filter((n) => !SECRET_DEFAULT_ENVS.includes(n))
        assert.deepEqual(unlisted, [], `这些凭据兜底没进审计清单，等于治理漏看了它们：${JSON.stringify(unlisted)}`)
    })
    test('清单里每一项在源码里仍然存在（删掉了却不改清单 ⇒ 这条红）', () => {
        const found = scanLiteralDefaults()
        const stale = SECRET_DEFAULT_ENVS.filter((n) => !found.has(n))
        assert.deepEqual(stale, [], `清单过期：${JSON.stringify(stale)} 在源码里已经找不到兜底了`)
    })
    test('relay 型"一处兜底、全模型共用"若在清单里必须带警示注记；空清单则必须真空（fork 实况的一致性）', () => {
        const relay = SECRET_DEFAULTS.find((d) => d.env === 'relay_common_pro_apiKey')
        if (relay) {
            assert.match(relay.note, /12 处同一 key|全部模型/, '这一处的危害恰恰是"共用"，清单里必须说明')
        } else {
            assert.equal(SECRET_DEFAULT_ENVS.length, 0, '清单不含 relay key 只有一种合法情形：整张清单为空（无字面量兜底的 fork）')
        }
    })
})

describe('5 decideSecretsPosture / assertSecretEnvPresent：缺 env 拒绝启动（默认关）', () => {
    test('全配齐 ⇒ ok，requireEnv 开不开都不 blocks', () => {
        const full = fullFx()
        assert.deepEqual(decideSecretsPosture({requireEnv: false, env: full, list: FIXTURE}), {mode: 'ok', blocks: false, missing: []})
        assert.deepEqual(decideSecretsPosture({requireEnv: true, env: full, list: FIXTURE}), {mode: 'ok', blocks: false, missing: []})
        assert.doesNotThrow(() => assertSecretEnvPresent({requireEnv: true, env: full, list: FIXTURE}))
    })
    test('有兜底 + 未开强制 ⇒ fallback-visible，绝不抛（翻开前置未满足时不能炸）', () => {
        const env = fullFx()
        delete env.fx_gamma_secret
        const p = decideSecretsPosture({requireEnv: false, env, list: FIXTURE})
        assert.equal(p.mode, 'fallback-visible')
        assert.equal(p.blocks, false)
        assert.doesNotThrow(() => assertSecretEnvPresent({requireEnv: false, env, list: FIXTURE}))
    })
    test('有兜底 + 开了强制 ⇒ refused，断言列出缺的 env 名并抛', () => {
        const env = fullFx()
        delete env.fx_gamma_secret
        delete env.fx_beta_password
        const p = decideSecretsPosture({requireEnv: true, env, list: FIXTURE})
        assert.equal(p.mode, 'refused')
        assert.deepEqual(p.missing.sort(), ['fx_beta_password', 'fx_gamma_secret'])
        assert.throws(() => assertSecretEnvPresent({requireEnv: true, env, list: FIXTURE}), /启动被拒绝/)
    })
    test('默认参数（不传 env/require/list）⇒ 走 process.env 与真实清单，requireEnv 默认 false ⇒ 不抛', () => {
        assert.doesNotThrow(() => assertSecretEnvPresent())
        assert.equal(decideSecretsPosture({}).mode === 'refused', false)
    })
    test('哨兵值：强制拒绝的错误信息里不得出现任何 env 的真实值，只有名字', () => {
        const SENTINEL = 'SENTINEL-DO-NOT-LEAK-9xKq'
        const env = fullFx(SENTINEL)
        delete env.fx_beta_password
        let msg = ''
        try {
            assertSecretEnvPresent({requireEnv: true, env, list: FIXTURE})
        } catch (e) {
            msg = e.message
        }
        assert.ok(msg.includes('fx_beta_password'), '拒绝信息应列出缺的 env 名')
        assert.ok(!msg.includes(SENTINEL), `拒绝信息泄漏了 env 值：${msg}`)
    })
})
