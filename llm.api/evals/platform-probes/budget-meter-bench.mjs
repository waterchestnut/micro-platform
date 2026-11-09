/**
 * @fileOverview PR-K1 收益的实测：迭代内全量重算 vs 增量测量
 * @module evals/platform-probes/budget-meter-bench
 * @description
 * "省掉 O(n²)" 这句话必须能称重，否则它只是复杂度叙事。
 * 这里用**接近 dev 真实形态**的消息集（平均 prompt 1399 token、多轮迭代占 19.79%、
 * 上限 6 轮）跑两种实现各若干次，报每次测量的耗时与 tokenize 的调用次数。
 *
 * 用法（在 `src/` 下）：node evals/platform-probes/budget-meter-bench.mjs [--rounds=200] [--iters=6]
 * 纯本地计算，不联网、不写库。
 */
import {createBudgetMeter} from '../../services/core/llmLoop.js'
import {calcMessagesTokenCount} from '../../services/openai/util.js'
import {compactToBudget} from '../../services/core/memory/assemble.js'

const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? Number(hit.split('=')[1]) : d
}
const ITERS = valOf('iters', 6)
const ROUNDS = valOf('rounds', 200)
const HISTORY = valOf('history', 20)

/**
 * @description 造一份贴近 dev 形态的消息集：system + 若干轮历史 + 每轮一个工具结果
 * @param {Number} extraToolRounds 额外塞进的工具结果条数（模拟迭代内膨胀）
 * @returns {Object[]} 消息数组
 */
function buildMessages(extraToolRounds) {
    const msgs = [{role: 'system', content: '你是一个高校师生教学助手。'.repeat(12)}]
    for (let i = 0; i < HISTORY; i++) {
        msgs.push({role: 'user', content: `第 ${i} 个问题：请说明幂等性在接口设计里的三种表现形式，并各举一例。`})
        msgs.push({role: 'assistant', content: `第 ${i} 个回答：${'幂等性指同一请求多次执行产生相同副作用。'.repeat(6)}`})
    }
    for (let i = 0; i < extraToolRounds; i++) {
        msgs.push({role: 'assistant', content: null, tool_calls: [{id: `c${i}`, type: 'function', function: {name: 'search_web', arguments: '{"query":"高校 教研 新闻"}'}}]})
        msgs.push({role: 'tool', tool_call_id: `c${i}`, content: `搜索结果 ${i}：` + '某高校发布教研合作通知，涉及课程建设与实践教学。'.repeat(8)})
    }
    return msgs
}

const budget = Number.POSITIVE_INFINITY
const measureOne = (m) => calcMessagesTokenCount([m], {})
const t0 = Date.now()
let sum = 0

/* 1) 线上原实现：每轮 compactToBudget（它内部先做一次全量 tokenize） */
for (let r = 0; r < ROUNDS; r++) {
    const msgs = buildMessages(0)
    const start = performance.now()
    for (let i = 1; i <= ITERS; i++) {
        compactToBudget(msgs, budget, {tokenizerOptions: {}})
        /** 每轮工具往返塞两条消息，与线上形态一致 */
        msgs.push({role: 'assistant', content: null, tool_calls: [{id: `x${i}`, type: 'function', function: {name: 'search_web', arguments: '{}'}}]})
        msgs.push({role: 'tool', tool_call_id: `x${i}`, content: `结果 ${i}：` + '教研新闻内容。'.repeat(6)})
    }
    sum += performance.now() - start
}
const beforeMs = sum / ROUNDS

/* 2) 新实现：每轮只测新增 */
sum = 0
let measuredItems = 0
for (let r = 0; r < ROUNDS; r++) {
    const msgs = buildMessages(0)
    const meter = createBudgetMeter({measureOne})
    const start = performance.now()
    for (let i = 1; i <= ITERS; i++) {
        meter.check(msgs)
        msgs.push({role: 'assistant', content: null, tool_calls: [{id: `x${i}`, type: 'function', function: {name: 'search_web', arguments: '{}'}}]})
        msgs.push({role: 'tool', tool_call_id: `x${i}`, content: `结果 ${i}：` + '教研新闻内容。'.repeat(6)})
    }
    meter.check(msgs)
    measuredItems += meter.stats().deltaPasses + meter.stats().fullPasses * msgs.length
    sum += performance.now() - start
}
const afterMs = sum / ROUNDS

/* 3) 一致性：两种口径在同一消息集上必须给同一个总量 */
const msgs = buildMessages(ITERS)
const meter = createBudgetMeter({measureOne})
let inc = 0
for (let i = 1; i <= msgs.length; i++) {
    inc = meter.check(msgs.slice(0, i))
}
const whole = calcMessagesTokenCount(msgs, {})

console.log(JSON.stringify({
    probe: 'budget-meter-bench',
    参数: {iters: ITERS, rounds: ROUNDS, historyMessages: msgs.length},
    每轮全量_单次ms: Number(beforeMs.toFixed(2)),
    增量测量_单次ms: Number(afterMs.toFixed(2)),
    节省ms: Number((beforeMs - afterMs).toFixed(2)),
    节省比: `${((1 - afterMs / beforeMs) * 100).toFixed(1)}%`,
    tokenize调用次数_增量口径: measuredItems,
    一致性: {增量总额: inc, 全量总额: whole, 相等: inc === whole},
    判定: inc === whole
        ? `✅ 口径一致；${ITERS} 轮测量的 CPU 从 ${beforeMs.toFixed(1)}ms 降到 ${afterMs.toFixed(1)}ms`
        : '❌ 增量与全量不等价，PR-K1 的做法必须回退',
    总耗时ms: Date.now() - t0,
}))
