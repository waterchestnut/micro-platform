/**
 * @fileOverview update_plan 工具的用例（PR-M 工具半件）
 * @module test/services/core/session/planTool
 * @description
 * 这个工具刻意做成了"纯输入输出、不读全局、不碰 DB"，所以下面全部是确定性离线用例。
 * 重点钉三件它最容易出错的事：
 * 1. **默认关**（`planToolEnabled({})` 必须 false，且关了时即便被调用也 success:false 不下发效果）；
 * 2. **归一结果与 warnings 必须回吐给模型**——它写的坏 status/丢的 title/重复 id，模型得当场看见；
 * 3. **出错是工具结果不是抛异常**（同 run_code，绝不能因为一次计划写歪把聊天循环打断）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/planTool.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/session/planTool.js')).href)
const {PLAN_TOOL_NAME, buildPlanTools, isPlanTool, planToolEnabled, executePlanTool} = M

const ON = {enabled: true}
const call = (argsObj, id = 'c1') => ({id, function: {name: PLAN_TOOL_NAME, arguments: JSON.stringify(argsObj)}})
const contentOf = (msg) => JSON.parse(msg.content)

describe('1 工具形与开关', () => {
    test('buildPlanTools 产出的 schema 形状正确、name 对得上 isPlanTool', () => {
        const tools = buildPlanTools()
        assert.equal(tools.length, 1)
        assert.equal(tools[0].type, 'function')
        assert.equal(tools[0].function.name, PLAN_TOOL_NAME)
        assert.ok(isPlanTool(PLAN_TOOL_NAME))
        assert.ok(!isPlanTool('run_code'))
        assert.ok(!isPlanTool(undefined))
    })
    test('items 用整份替换语义：required 里有 items，单条 required 里有 title', () => {
        const fn = buildPlanTools()[0].function
        assert.deepEqual(fn.parameters.required, ['items'])
        assert.deepEqual(fn.parameters.properties.items.items.required, ['title'])
    })
    test('status 的枚举与 planState 的五个状态一致（别让 schema 和判据两套词）', () => {
        const enumd = buildPlanTools()[0].function.parameters.properties.items.items.properties.status.enum
        assert.deepEqual([...enumd].sort(), ['abandoned', 'done', 'failed', 'in_progress', 'pending'])
    })
    test('planToolEnabled 默认关，只有显式 enabled:true 才开', () => {
        assert.equal(planToolEnabled({}), false)
        assert.equal(planToolEnabled(undefined), false)
        assert.equal(planToolEnabled({enabled: false}), false)
        assert.equal(planToolEnabled({enabled: true}), true)
        assert.equal(planToolEnabled({enabled: 'true'}), false, '字符串 true 不算开（要显式布尔）')
    })
})

describe('2 executePlanTool：出错都是工具结果，绝不抛', () => {
    test('坏 JSON ⇒ success:false，且返回体仍是合法 tool 消息', () => {
        const msg = executePlanTool({toolCall: {id: 'x', function: {arguments: '{坏'}}, planConfig: ON})
        assert.equal(msg.role, 'tool')
        assert.equal(msg.tool_call_id, 'x')
        assert.equal(contentOf(msg).success, false)
    })
    test('未开放时即便调用也拒绝（不产生计划效果）', () => {
        const msg = executePlanTool({toolCall: call({items: [{title: 'A', status: 'done'}]}), planConfig: {}})
        const c = contentOf(msg)
        assert.equal(c.success, false)
        assert.match(c.error, /未开放/)
    })
    test('空 items / 全废条目 ⇒ success:false 并带 warnings', () => {
        for (const payload of [{items: []}, {items: [null, 3, {status: 'done'}]}]) {
            const c = contentOf(executePlanTool({toolCall: call(payload), planConfig: ON}))
            assert.equal(c.success, false)
            assert.match(c.error, /没有可用/)
        }
    })
})

describe('3 正常执行：回吐归一计划 + recitation + warnings', () => {
    test('一份规整计划 ⇒ success:true，counts 正确、openRemaining 反映未结', () => {
        const c = contentOf(executePlanTool({
            toolCall: call({items: [
                {id: 'a', title: '查数据', status: 'done'},
                {id: 'b', title: '写报告', status: 'pending'},
            ]}),
            planConfig: ON,
        }))
        assert.equal(c.success, true)
        assert.equal(c.data.counts.total, 2)
        assert.equal(c.data.counts.done, 1)
        assert.equal(c.data.counts.open, 1)
        assert.equal(c.data.openRemaining, true)
        assert.match(c.data.recitation, /完成 1\/2/)
        assert.deepEqual(c.data.normalized, [], '规整输入不该冒出归一警告')
    })
    test('全 done ⇒ openRemaining false（完成性反问此时不该触发）', () => {
        const c = contentOf(executePlanTool({
            toolCall: call({items: [{id: 'a', title: 'A', status: 'done'}]}),
            planConfig: ON,
        }))
        assert.equal(c.data.openRemaining, false)
    })
    test('模型写的坏 status/缺 title ⇒ 归一结果与 warnings 一并回吐（绝不静默修）', () => {
        const c = contentOf(executePlanTool({
            toolCall: call({items: [
                {id: 'a', title: 'A', status: 'complete'},  // 非法 → pending + 警告
                {id: 'b', status: 'done'},                    // 缺 title → 丢弃 + 警告
                {title: '无id'},                              // 缺 id → 序号补 + 警告
            ]}),
            planConfig: ON,
        }))
        assert.equal(c.success, true)
        assert.equal(c.data.items.length, 2, '缺 title 的那条被丢弃')
        assert.ok(c.data.normalized.some((w) => /status.*非法/.test(w)))
        assert.ok(c.data.normalized.some((w) => /缺 title/.test(w)))
        assert.ok(c.data.normalized.some((w) => /缺 id/.test(w)))
    })
    test('recitationMaxChars 可配：给了很小预算时 recitation 会声明"另有 N 项未显示"', () => {
        const items = Array.from({length: 30}, (_, i) => ({id: `i${i}`, title: `很长的标题用来撑爆预算 ${'字'.repeat(30)}`, status: 'pending'}))
        const c = contentOf(executePlanTool({toolCall: call({items}), planConfig: {enabled: true, recitationMaxChars: 100}}))
        assert.match(c.data.recitation, /另有 \d+ 项未显示/)
    })
})

describe('4 不依赖全局：无 llm 全局也能跑（纯函数，接线前就该自足）', () => {
    test('模块加载与执行不引用 llm.*（grep 自身源码确认）', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/session/planTool.js'), 'utf8')
        // 允许出现 "llm.config" 的字样只可能在注释里；执行路径用传入的 planConfig，不读全局
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        assert.ok(!/\bllm\s*\./.test(codeOnly), '执行代码里不该出现 llm. 全局访问')
    })
})
