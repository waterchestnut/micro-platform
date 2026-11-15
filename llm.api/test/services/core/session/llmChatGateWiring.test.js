/**
 * @fileOverview 主循环门接线的源码锚守卫（planWiring/两截链同族：装配面的形状用锚钉，不靠自觉）
 * @module test/services/core/session/llmChatGateWiring
 * @description
 * llmChat 不可离线 import（重依赖），而接线刀的风险恰恰在**形状**：choke 点数、豁免谓词、
 * 观察/施行的分界、结果合流位、档案落笔——每一处都是"改一半忘另一半"能藏身的地方。
 * 锚在这里不是妥协：被审的对象就是源码结构本身。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/llmChat.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(SRC, 'services/core/llmChat.js'), 'utf8').replace(/\r/g, '')
const count = (hay, needle) => hay.split(needle).length - 1

describe('1 choke 单点', () => {
    test('筛查只在分派前做一次：gateScreenCalls 调用点恰一，classifyToolCalls 吃筛查后的集合', () => {
        assert.equal(count(src, 'await gateScreenCalls('), 1, '第二个调用点=第二个 choke，门会出现两种口径')
        assert.ok(src.includes('classifyToolCalls(gatePassedCalls'), '分派必须基于筛查后的集合——绕过它=门被旁路')
        assert.ok(src.includes('[...gateBlockedResults,'), 'block 结果要在合流位——不然 tool_call_id 没有回执，API 契约当场碎')
    })
    test('ask_user 豁免在 choke 处显式过滤（豁免理由是循环性，注释必须活着）', () => {
        assert.ok(src.includes('!isAskTool(tc?.function?.name)'), '豁免谓词失踪=门开始问自己的问题（循环等待）')
    })
    test('关着不可见：gateScreenCalls 只被 if (gateOn) 包住调用；helper 内部不再判 enabled', () => {
        assert.ok(src.includes('let gatePassedCalls = toolCalls\n                    if (gateOn) {'))
        const fnStart = src.indexOf('async function gateScreenCalls(')
        const fn = src.slice(fnStart, src.indexOf('\n    }\n', fnStart))
        assert.ok(!fn.includes('gateCfg.enabled'), 'helper 内再判开关=两个真相源（外层已保证只在开时进入）')
    })
})

describe('2 观察与施行的分界', () => {
    test('观察模式三态全放行只记账：!gateEnforce 分支在 allow/block/await 判定之前', () => {
        const fnStart = src.indexOf('async function gateScreenCalls(')
        const fn = src.slice(fnStart, src.indexOf('\n    }\n', fnStart))
        assert.ok(fn.includes("if (!gateEnforce) {"), 'enforce 检查缺失=enabled 一开就真拦，观察档不存在')
        assert.ok(fn.indexOf("if (!gateEnforce) {") < fn.indexOf("} else if (r.verdict === 'allow') {"),
            '观察分支排在施行分支之后=enforce=false 也会走到 block 组装')
    })
    test('行动出口只有两处且都带 gated 标记（模型看得见自己被门拦了，不是静默吞）', () => {
        assert.equal(count(src, 'success: false, gated: true'), 2, '第三个行动出口（若有）必须在此登记并给理由')
    })
    test('观察档的档案字面必须带 observed 前缀（读 extInfo.gate 的人要能一眼分"没拦"和"拦了"）', () => {
        const fnStart = src.indexOf('async function gateScreenCalls(')
        const fn = src.slice(fnStart, src.indexOf('\n    }\n', fnStart))
        assert.ok(fn.includes("applied = 'observed:' + r.verdict"),
            '观察模式记账若与施行同字面（allow/approved），档案面就读不出"当时没拦"——W10 变异存活逼出的钉')
    })
})

describe('3 await-human 走既有 MRTR 管道', () => {
    test('复用 awaitAskUser 不另造审批通道；askId 前缀 gate-；kind=approval', () => {
        assert.ok(src.includes('await awaitAskUser({'), '新审批实现=第二条人工通道，§2F.4 的 admission 管不到它')
        assert.ok(src.includes('id: `gate-${messageCode}-${gateLedger.approvals}`'))
        assert.ok(src.includes('kind: \'approval\''), '不是 approval 题就会接受全员作答（§2F.4 裁定）')
    })
    test('人工不可达时到不了 await 分支（decideGate 已给 block;human-unavailable）', () => {
        assert.ok(src.includes('askAvailable: askOn && !!options.answerRouter'),
            'askAvailable 由接线方如实报——谎报 true 会把动作挂进无人应答的等待')
    })
})

describe('4 档案面两截链', () => {
    test('生产了 gate 字段且白名单枚举（缺任一半=静默丢，两截链守卫已双保险，这里钉存在性）', () => {
        assert.ok(src.includes('gate: gateLedger.decisions.length ?'), '生产侧失踪=extInfo.gate 恒缺，观察档成空承诺')
        assert.ok(src.includes('gate: options.gate,'), '白名单失踪=bundle 算了也丢（b397822 的同款事故形状）')
    })
    test('账本逐条带 raw（观察周要靠 raw vs verdict 归因"分类器原判 vs 外包纠正"——开窗首读抓到的缺字段）', () => {
        assert.ok(src.includes('raw: r.raw || undefined'),
            'decisions 不带 raw 时，overrode=true 只知道被纠正、不知道被纠了什么——观察档的核心产出瘸一条腿（2026-11-15 gate-observe G3 实录）')
    })
    test('账本有界（40）：观察档不许成为无界内存出口', () => {
        assert.ok(src.includes('gateLedger.decisions.length < 40'))
    })
})
