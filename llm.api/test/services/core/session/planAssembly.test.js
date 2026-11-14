/**
 * @fileOverview PR-M 装配件用例（planAssembly）
 * @module test/services/core/session/planAssembly
 * @description
 * 最关键的一组是 `withRecitation` 的"不修改历史、不累积"——这是把 recitation 从设计变现实时最容易写错的地方
 * （一旦 `push` 进 messages，就会逐轮背着前几轮的副本，还会污染档案）。
 * 所以这里不但断言"注入了什么"，更要断言"messages 本身一个字节没动"。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/planAssembly.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/session/planAssembly.js')).href)
const {
    PLAN_DOC_VERSION, planForPersistence, seedPlanFromPrior, buildRecitationContent, withRecitation,
} = M

const plan = (...items) => ({items})
const DONE = {id: 'a', title: 'A', status: 'done'}
const OPEN = {id: 'b', title: 'B', status: 'pending'}

describe('1 planForPersistence：没计划返回 null，不写空壳冒充有计划', () => {
    test('null / 空 items / 无 items 键 ⇒ null（调用方据此不写 extInfo.plan）', () => {
        for (const p of [null, undefined, {}, {items: []}, {items: 'x'}]) {
            assert.equal(planForPersistence(p), null, `${JSON.stringify(p)} 不该被落成一个看起来存在的计划`)
        }
    })
    test('有计划 ⇒ 带版本、带 openRemaining、带原始 items', () => {
        const r = planForPersistence(plan(DONE, OPEN))
        assert.equal(r.v, PLAN_DOC_VERSION)
        assert.equal(r.items.length, 2)
        assert.equal(r.openRemaining, true)
    })
    test('全完成 ⇒ openRemaining false（供回读时知道不用再反问）', () => {
        assert.equal(planForPersistence(plan(DONE)).openRemaining, false)
    })
    test('updatedBy 传了才带这个键（缺省不留空字段）', () => {
        assert.equal('updatedBy' in planForPersistence(plan(DONE)), false)
        assert.equal(planForPersistence(plan(DONE), {updatedBy: 'call9'}).updatedBy, 'call9')
    })
})

describe('2 seedPlanFromPrior：从上一轮档案回读，脏/缺一律 null，且重新归一', () => {
    test('缺 plan 键 / 空 / 非对象 ⇒ null（老档案没这字段，不猜）', () => {
        for (const e of [null, undefined, {}, {plan: null}, {plan: {}}, {plan: {items: []}}, {plan: 'x'}]) {
            assert.equal(seedPlanFromPrior(e), null)
        }
    })
    test('正常种子：原样取出', () => {
        const s = seedPlanFromPrior({plan: {items: [{id: 'a', title: 'A', status: 'done'}]}})
        assert.equal(s.items.length, 1)
    })
    test('脏数据在装配前被 normalizePlan 收敛（档案是历史某版代码写的，不能假设现在就合法）', () => {
        const s = seedPlanFromPrior({plan: {items: [null, {id: 'a', title: 'A', status: 'weird'}, {title: ''}]}})
        assert.equal(s.items.length, 1, '非对象与无 title 项应被丢弃')
        assert.equal(s.items[0].status, 'pending', '非法 status 兜成 pending')
    })
})

describe('3 buildRecitationContent：有计划才给文本，带可分来源的前缀', () => {
    test('无计划 ⇒ null', () => {
        assert.equal(buildRecitationContent(null), null)
        assert.equal(buildRecitationContent({items: []}), null)
    })
    test('有前缀 + recitation 正文', () => {
        const c = buildRecitationContent(plan(DONE, OPEN))
        assert.match(c, /非用户输入/)
        assert.match(c, /完成 1\/2/)
        assert.match(c, /\[ \] B/)
    })
})

describe('4 withRecitation：核心不变量——不改历史、不累积、关着原样返回', () => {
    test('关着（enabled=false）⇒ 返回同一个引用，绝不注入', () => {
        const msgs = [{role: 'user', content: 'hi'}]
        assert.equal(withRecitation(msgs, plan(DONE), {enabled: false}), msgs)
    })
    test('开但没计划 ⇒ 同一个引用', () => {
        const msgs = [{role: 'user', content: 'hi'}]
        assert.equal(withRecitation(msgs, null, {enabled: true}), msgs)
        assert.equal(withRecitation(msgs, {items: []}, {enabled: true}), msgs)
    })
    test('开且有计划 ⇒ 新数组，只多一条尾部消息，messages 本身一字未动', () => {
        const msgs = [{role: 'user', content: 'q'}]
        const beforeLen = msgs.length
        const out = withRecitation(msgs, plan(DONE, OPEN), {enabled: true})
        assert.notEqual(out, msgs, '注入时必须返回新数组，不能原地改')
        assert.equal(out.length, beforeLen + 1)
        assert.equal(msgs.length, beforeLen, '原始历史绝不能被改长')
        assert.deepEqual(out[0], {role: 'user', content: 'q'})
        assert.equal(out[1].role, 'system')
        assert.match(out[1].content, /计划状态/)
    })
    test('对同一 messages 连续调用两次，不会累积两条 recitation（这是 push 版本会犯的错）', () => {
        const msgs = [{role: 'user', content: 'q'}]
        const first = withRecitation(msgs, plan(OPEN), {enabled: true})
        const second = withRecitation(msgs, plan(OPEN), {enabled: true})
        assert.equal(first.length, 2)
        assert.equal(second.length, 2, '第二次仍应只有一条注入（因为源 msgs 没被污染）')
        assert.equal(msgs.length, 1)
    })
    test('role 可换（relay 若不支持中途 system，改 user 不动主循环）', () => {
        const out = withRecitation([], plan(OPEN), {enabled: true, role: 'user'})
        assert.equal(out[0].role, 'user')
    })
    test('空历史也可注入；messages 缺省（undefined）⇒ 不抛，当作 [] 处理', () => {
        const out = withRecitation(undefined, plan(OPEN), {enabled: true})
        assert.equal(out.length, 1)
    })
})

describe('5 纯函数纪律：不读 llm 全局、不碰 IO', () => {
    test('planAssembly.js 执行代码里没有 llm.* / await / require', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/session/planAssembly.js'), 'utf8')
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        assert.ok(!/\bllm\s*\./.test(codeOnly), '不该访问 llm 全局')
        assert.ok(!/\bawait\b/.test(codeOnly), '全同步，不该有 await')
    })
})

/**
 * B1 跨轮 seed 的真正契约不是两个函数各自对，而是**这一轮写的形状能被下一轮原样读回**。
 * 落档端 `planForPersistence` 与回读端 `seedPlanFromPrior` 分属两次 execChat 调用，
 * 只要其中一边改了字段名/结构，另一边的测试照样绿——因为它们各测各的。
 * 这条 round-trip 把它们钉在一起：写进去的计划，读回来必须等价（含状态、含顺序、丢弃规则一致）。
 */
describe('6 落档↔回读 round-trip（B1 的跨轮契约，不是各测各的）', () => {
    test('planForPersistence 写出的计划，seedPlanFromPrior 读回等价', () => {
        const items = [
            {id: 'a', title: '查数据', status: 'done'},
            {id: 'b', title: '写报告', status: 'in_progress'},
            {id: 'c', title: '发通知', status: 'pending'},
        ]
        const persisted = planForPersistence(plan(...items))
        assert.ok(persisted, '有计划时不该返回 null')
        const seeded = seedPlanFromPrior({plan: persisted})
        assert.ok(seeded, '回读不该是 null')
        assert.deepEqual(seeded.items, items.map((it) => ({...it})), '跨轮读回的条目（id/title/status/顺序）应与写出时等价')
    })
    test('全完成计划回读后仍判"无未结"（否则下一轮会凭空冒出一个 self-check 目标）', () => {
        const persisted = planForPersistence(plan({id: 'a', title: 'A', status: 'done'}))
        const seeded = seedPlanFromPrior({plan: persisted})
        assert.equal(seeded.items[0].status, 'done')
    })
    test('落档为 null（本轮没计划）时，回读也拿不到计划（不把 null 误 seed 成空计划）', () => {
        assert.equal(planForPersistence(null), null)
        assert.equal(seedPlanFromPrior({plan: null}), null)
        assert.equal(seedPlanFromPrior({}), null)
    })
    test('recitation 文本对"写出后回读的计划"与"原计划"给出同一结果（证明 round-trip 没丢信息）', () => {
        const items = [{id: 'x', title: '步骤一', status: 'in_progress'}, {id: 'y', title: '步骤二', status: 'done'}]
        const direct = M.buildRecitationContent({items})
        const roundTripped = M.buildRecitationContent(seedPlanFromPrior({plan: planForPersistence({items})}))
        assert.equal(roundTripped, direct, '回读的计划渲染出的 recitation 应与直接用原计划一致，否则跨轮续写会漂')
    })
})
