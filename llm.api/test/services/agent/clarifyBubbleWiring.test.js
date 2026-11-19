/**
 * @fileOverview 澄清冒泡（§7-1）的接线与形状守卫
 * @module test/services/agent/clarifyBubbleWiring.test
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readCode = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('llmChat：child 申报面的三闸与 ack', () => {
    const code = readCode('services/core/llmChat.js')

    test('注册三闸：flag ∧ agentRole===child ∧ 函数型 clarifySink（缺一个都不注册）', () => {
        assert.match(code, /clarifyCfg\.enabled === true && options\.taskContext\?\.agentRole === 'child' && typeof options\.clarifySink === 'function'/)
    })
    test('分类条件注入且映射到实指（刀 B 的病：裸 shorthand 未定义标识符——锚必须带冒号后的实名）', () => {
        assert.match(code, /\.\.\.\(clarifyOn \? \{isClarifyTool: isClarifyRequestTool\} : \{\}\)/)
        assert.match(code, /const \{[^}]*\bclarifyCalls\b[^}]*\} =/, 'clarifyCalls 没解构出来')
    })
    test('执行段恒不挂起：坏申报拒、sink 抛错如实回、受理成功 ack 里明说"请收尾"', () => {
        assert.match(code, /if \(clarifyCalls\.length\) \{[\s\S]{0,300}parseClarifyRequest/)
        assert.match(code, /澄清申报登记失败/)
        assert.match(code, /请基于已知信息完成并在正文标注假设/)
        assert.ok(!/await\s+options\.clarifySink/.test(code), 'sink 不许被 await——申报等答复=把 ask_user 的挂死换了件衣服')
    })
    test('合并串含 clarifyResults（回执不进历史=下一轮 API 400）', () => {
        assert.match(code, /const toolResults = \[[^\]]*clarifyResults[^\]]*\]/)
    })
})

describe('agentChat：收集器与落库', () => {
    const code = readCode('services/agent/handler/agentChat.js')
    test('flag 关⇒sink 不注入（undefined 传下去 llmChat 连工具都不注册）', () => {
        assert.match(code, /const clarifySink = clarifyCfg\.enabled === true/)
        assert.match(code, /\.\.\.\(clarifySink \? \{clarifySink\} : \{\}\)/)
    })
    test('终局并进 handleRet.clarify（首问+条数如实；没申报就不带这个键）', () => {
        assert.match(code, /const clarifyRet = clarifyRecords\.length/)
        assert.match(code, /handleRet: \{[\s\S]{0,160}\.\.\.clarifyRet/)
    })
})

describe('fanOutFinalizeTask：截胡在综合之前、await 写回不花钱', () => {
    const code = readCode('services/agent/handler/fanOutFinalizeTask.js')
    test('三条件才问截胡（flag ∧ needSynthesis ∧ 未取消）', () => {
        assert.match(code, /clarifyCfgF\.enabled === true && finFinal\.dispatch\?\.needSynthesis === true && finFinal\.cancelled !== true/)
    })
    test('await 档：root 回 handleStatus 1（非终态）+ action await-input + hold 进 params，随后 return——综合根本不启动', () => {
        assert.match(code, /if \(decided\.mode === 'await'\) \{[\s\S]{0,900}handleStatus: 1[\s\S]{0,900}'params\.clarifyHold': decided\.hold/)
        const awaitBlock = code.slice(code.indexOf("if (decided.mode === 'await')"), code.indexOf("if (decided.mode === 'synthesize-degraded')"))
        assert.ok(!awaitBlock.includes('execChat'), 'await 档里出现 execChat=挂了还在烧钱')
    })
    test('degraded 档：note 并进主写回的 orchestration（cap 用尽不是"没问题"）', () => {
        assert.match(code, /finFinal\.clarifyNote = decided\.note/)
        assert.match(code, /clarifyNote: finFinal\.clarifyNote/)
    })
})

describe('clarifyAnswer 端点：面/归属逐字照 cancel，重派有 CAS', () => {
    const code = readCode('routes/core/agentTask/root.js')
    test('401/403/scope-reject/no-hold 四道门都在', () => {
        assert.match(code, /fastify\.post\('\/clarifyAnswer'/)
        assert.match(code, /无权答复该任务[\s\S]{0,40}403/)
        assert.match(code, /reason: 'scope-reject'/)
        assert.match(code, /reason: 'no-hold'/)
    })
    test('child 行 CAS（handleStatus:2 条件）——并发双答复只有一次改得动', () => {
        assert.match(code, /\{agentCode: a\.agentCode, handleStatus: 2\}/)
    })
    test('重派发是 fire-and-forget（端点不等 child 跑完）；finalize 不抢跑（等聚合钩子重触发）', () => {
        assert.match(code, /execAgentTask\(fresh\)\.catch/)
        assert.ok(!code.includes('execAgentTask(finTask)'), '端点抢派 finalize=在 child 还在跑时污染 orchestration（e2e 实锤）')
        assert.ok(code.includes('params.clarifyAnswered'), 'answered 记账丢失')
        assert.ok(code.includes('const answeredSet = new Set([...(root.params?.clarifyAnswered || []), ...requeued])'),
            'answered 混入了没重派成功的=烧 cap 且不重问')
        assert.ok(code.includes("'params.clarifyAnswered': [...answeredSet]"), '写回没用 answeredSet')
    })
})

describe('config：clarifyBubble 默认关、cap 有默认', () => {
    test('默认 enabled=false, cap=2', async () => {
        const {default: cfg} = await import('../../../conf/system.config.js')
        const c = cfg.agentTask?.clarifyBubble
        assert.ok(c, '配置缺 agentTask.clarifyBubble')
        assert.equal(c.enabled, false, '默认必须关')
        assert.equal(c.cap, 2)
    })
    test("env 严格 'true'", async () => {
        process.env.agentTask_clarifyBubble = 'true'
        process.env.agentTask_clarifyCap = '3'
        const mod = await import(`../../../conf/system.config.js?v=${Math.random()}`)
        const c = mod.default.agentTask.clarifyBubble
        delete process.env.agentTask_clarifyBubble
        delete process.env.agentTask_clarifyCap
        assert.equal(c.enabled, true)
        assert.equal(c.cap, 3)
    })
})
