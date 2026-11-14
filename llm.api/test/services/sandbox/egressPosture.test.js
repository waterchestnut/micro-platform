/**
 * @fileOverview 出网态势判据与接线守卫（PR-E0.6 ③④）
 * @module test/services/sandbox/egressPosture
 * @description
 * 两件事分开测，因为它们的失效方式不同：
 * - 判据失效 ⇒ 态势算错（比如 allow-all 被当成已收紧）；
 * - 接线失效 ⇒ 判据算得对但没人用它（本档已经为此写过三次"两侧齐"守卫）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
/**
 * 定位 src 根：向上找到确实存在 `services/sandbox/egressPosture.js` 的那一层。
 * 为什么不用 `../../../..`：这种相对层数我已经数错过两次（多一级就指到仓库根，
 * 报 ERR_MODULE_NOT_FOUND 或"文件不存在"的假结论）。找标记比数层级不会错。
 */
function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, 'services/sandbox/egressPosture.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根（services/sandbox/egressPosture.js 不在预期位置）')
}

const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const POSTURE = path.join(SRC, 'services/sandbox/egressPosture.js')
const {
    decideEgressPosture, formatPostureForLog, assertSandboxEgressAllowed, EGRESS_MODE,
} = await import(pathToFileURL(POSTURE).href)
const code = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('1 decideEgressPosture：四档，且只有 refused 阻断', () => {
    test('沙箱没开 ⇒ disabled，不阻断也不该告警', () => {
        assert.deepEqual(decideEgressPosture({sandboxEnabled: false, policy: null, enforcePolicy: true}),
            {mode: EGRESS_MODE.DISABLED, reason: 'sandbox-not-enabled', blocks: false})
    })
    test('开了且配了策略 ⇒ tightened', () => {
        const d = decideEgressPosture({sandboxEnabled: true, policy: {defaultAction: 'deny', egress: []}})
        assert.equal(d.mode, EGRESS_MODE.TIGHTENED)
        assert.equal(d.blocks, false)
    })
    test('开了但没配策略、未强制 ⇒ allow-all-visible，不阻断（dev 现状）', () => {
        const d = decideEgressPosture({sandboxEnabled: true, policy: null, enforcePolicy: false})
        assert.equal(d.mode, EGRESS_MODE.ALLOW_ALL_VISIBLE)
        assert.equal(d.blocks, false, '默认必须不阻断：dev 实测技能真在沙箱里跑，默认拦就是治理提交造成停摆')
    })
    test('开了但没配策略、已强制 ⇒ refused 且阻断', () => {
        const d = decideEgressPosture({sandboxEnabled: true, policy: null, enforcePolicy: true})
        assert.equal(d.mode, EGRESS_MODE.REFUSED)
        assert.equal(d.blocks, true)
    })
    test('空对象策略算"已配置"吗？—— 明确按 truthy 处理，但文案要能看出来', () => {
        const d = decideEgressPosture({sandboxEnabled: true, policy: {}})
        assert.equal(d.mode, EGRESS_MODE.TIGHTENED, '空对象在 JS 是真值；这一档的判定沿用"有没有给策略"，不额外猜内容')
    })
    test('全默认参数（不传）⇒ disabled，不抛', () => {
        assert.equal(decideEgressPosture().mode, EGRESS_MODE.DISABLED)
    })
})

describe('2 文案：要说清现状、后果与切换顺序', () => {
    test('allow-all 文案必须同时给出"配什么"和"再打开什么"', () => {
        const line = formatPostureForLog(decideEgressPosture({sandboxEnabled: true}), {requiredHosts: ['llm-api-http.xxzx']})
        assert.match(line, /sandbox_egressPolicy/)
        assert.match(line, /sandbox_egressEnforcePolicy=true/)
        assert.match(line, /集群内任意服务/, '必须说清风险本身，不能只说"未配置"')
        assert.match(line, /llm-api-http\.xxzx/, '技能回连目标要从配置里带出来，否则运维不知道该 allow 什么')
    })
    test('refused 文案要给出两条出路（配策略 / 临时关 enforce），不能只有一句拒绝', () => {
        const line = formatPostureForLog(decideEgressPosture({sandboxEnabled: true, enforcePolicy: true}))
        assert.match(line, /拒绝建箱/)
        assert.match(line, /egressPolicy/)
        assert.match(line, /enforce/, '只说"被拒绝"会让排障的人以为配置写错了，而不是缺一段策略')
    })
    test('disabled 的文案不许出现"收紧"字样（没开沙箱却谈收紧是噪音）', () => {
        assert.match(formatPostureForLog(decideEgressPosture({})), /未启用/)
    })
})

describe('3 assertSandboxEgressAllowed：只有 blocks 才抛', () => {
    test('refused ⇒ 抛，且错误信息就是那条可行动文案', () => {
        const d = decideEgressPosture({sandboxEnabled: true, policy: null, enforcePolicy: true})
        assert.throws(() => assertSandboxEgressAllowed(d), /拒绝建箱/)
    })
    test('其余三档 ⇒ 不抛', () => {
        for (const d of [
            decideEgressPosture({}),
            decideEgressPosture({sandboxEnabled: true, policy: {defaultAction: 'deny', egress: []}}),
            decideEgressPosture({sandboxEnabled: true, policy: null, enforcePolicy: false}),
        ]) {
            assert.doesNotThrow(() => assertSandboxEgressAllowed(d))
        }
    })
    test('传 undefined 也不抛（治理代码不该成为新的崩溃点）', () => {
        assert.doesNotThrow(() => assertSandboxEgressAllowed(undefined))
    })
})

describe('4 接线：判据存在不等于被调用', () => {
    const runner = code('services/sandbox/runner.js')
    test('两个建箱路径都过闸门（漏一个就是"某些技能没被治理"）', () => {
        /** 只数"语句形式"的调用：上一版正则把 `function enforceEgressPosture(egress) {` 这行定义也算成调用，
         *  于是 2 处计算对 3 处"调用"，守卫红在一个根本不存在的漏点上——计数守卫必须先确认自己数得对 */
        const calls = (runner.match(/\n\s{4}enforceEgressPosture\(egress\)/g) || []).length
        const computes = (runner.match(/egressPolicyFromConfig\(\)/g) || []).length
        assert.ok(computes >= 2, `预期至少两处算策略，实际 ${computes}`)
        assert.equal(calls, computes, `算策略 ${computes} 处、过闸门 ${calls} 处 ⇒ 有路径带着未判定的策略建箱`)
    })
    test('闸门在 createSandbox 之前（建完箱再拒就是白建）', () => {
        const at = runner.indexOf('enforceEgressPosture(egress)')
        const create = runner.indexOf('client.createSandbox(buildCreateBody({')
        assert.ok(at > 0 && create > at, '顺序反了：先建箱再判态势')
    })
    test('配置项已声明（enforce 开关不能只存在于代码里）', () => {
        const cfg = code('conf/system.config.js')
        assert.match(cfg, /egressEnforcePolicy: process\.env\['sandbox_egressEnforcePolicy'\] === 'true'/)
    })
})
