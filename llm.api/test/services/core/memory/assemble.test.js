import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  rebuildTurn,
  buildHistoryMessages,
  assemble,
  compactToBudget,
  TOOL_STUB_HEAD,
} from '../../../../services/core/memory/assemble.js'
import {calcMessagesTokenCount} from '../../../../services/openai/util.js'

const TOK = {tokenizer: 'cl100k_base', imageTokens: 765}
const Q = '第三轮的问题'

function turnDoc(overrides = {}) {
  return {
    messageCode: 'm3',
    query: Q,
    answer: '第三轮的回答',
    answerReasoning: '',
    messages: [
      {role: 'system', content: '系统提示词'},
      {role: 'user', content: '## 文献材料：\n这是一段 RAG 注入的检索片段'},
      {role: 'system', content: '候选技能清单'},
      {role: 'user', content: Q},
      {role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'extract_doc', arguments: '{"url":"a"}'}}]},
      {role: 'tool', tool_call_id: 'c1', content: '工具返回的长文本内容'},
      {role: 'assistant', content: '中间文本'},
    ],
    ...overrides,
  }
}

test('rebuildTurn 从匹配的 user 起还原，并丢弃 system/RAG/技能等每轮重算的槽位', () => {
  const turn = rebuildTurn(turnDoc())
  assert.deepEqual(turn.map(m => m.role), ['user', 'assistant', 'tool', 'assistant', 'assistant'])
  assert.equal(turn[0].content, Q)
  assert.ok(!turn.some(m => m.role === 'system'), '不应带回 system 槽位')
  assert.ok(!turn.some(m => typeof m.content === 'string' && m.content.includes('RAG')), '不应带回上一轮的 RAG 片段')
  assert.equal(turn[1].tool_calls.length, 1, 'tool_calls 必须保留，这是本轮修复的核心')
  assert.equal(turn[2].role, 'tool', '工具结果必须保留')
})

test('rebuildTurn 补齐最终回答（答案不在 messages 里）', () => {
  const doc = turnDoc({messages: [{role: 'system', content: 's'}, {role: 'user', content: Q}]})
  const turn = rebuildTurn(doc)
  assert.deepEqual(turn.map(m => m.role), ['user', 'assistant'])
  assert.equal(turn[1].content, doc.answer)
})

test('rebuildTurn 多模态 user（content 数组含 text 片段）也能定位', () => {
  const doc = turnDoc({
    messages: [
      {role: 'system', content: 's'},
      {role: 'user', content: [{type: 'image_url', image_url: {url: 'u'}}, {type: 'text', text: Q}]},
    ]
  })
  const turn = rebuildTurn(doc)
  assert.equal(turn.length, 2)
  assert.equal(turn[0].role, 'user')
})

test('rebuildTurn 缺 answer/query 时返回空，老数据由上层降级', () => {
  assert.deepEqual(rebuildTurn({...turnDoc(), answer: ''}), [])
  assert.deepEqual(rebuildTurn({...turnDoc(), query: ''}), [])
  assert.deepEqual(rebuildTurn(null), [])
})

test('rebuildTurn 无 messages 或定位不到时返回空数组', () => {
  assert.deepEqual(rebuildTurn(turnDoc({messages: undefined})), [])
  assert.deepEqual(rebuildTurn(turnDoc({messages: [{role: 'user', content: '别的'}]})), [])
})

test('buildHistoryMessages 输出按时间正序（旧→新）', () => {
  const docs = [turnDoc({messageCode: 'm3', query: Q, answer: 'A3'}), turnDoc({messageCode: 'm2', query: '第二轮', answer: 'A2'})]
  const {messages} = buildHistoryMessages(docs, {tokenizerOptions: TOK, budget: Infinity})
  const userTexts = messages.filter(m => m.role === 'user' && typeof m.content === 'string')
  assert.deepEqual(userTexts.map(m => m.content), ['第二轮', Q])
})

test('buildHistoryMessages 老数据降级为纯文本对', () => {
  const legacy = {messageCode: 'old', query: '老问题', answer: '老回答', messages: null}
  const {messages} = buildHistoryMessages([legacy], {tokenizerOptions: TOK, budget: Infinity})
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant'])
  assert.equal(messages[0].content, '老问题')
})

test('buildHistoryMessages 按预算丢弃最旧轮次并记录 dropped', () => {
  const docs = [
    turnDoc({messageCode: 'new', query: '新问题', answer: '新回答', messages: [{role: 'user', content: '新问题'}]}),
    turnDoc({messageCode: 'mid', query: '中问题', answer: '中回答', messages: [{role: 'user', content: '中问题'}]}),
    turnDoc({messageCode: 'old', query: '旧问题', answer: '旧回答', messages: [{role: 'user', content: '旧问题'}]}),
  ]
  const oneTurn = calcMessagesTokenCount([{role: 'user', content: '旧问题'}, {role: 'assistant', content: '旧回答'}], TOK)
  const {messages, dropped} = buildHistoryMessages(docs, {tokenizerOptions: TOK, budget: oneTurn * 2})
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].messageCode, 'old')
  assert.ok(!messages.some(m => m.content === '旧问题'), '最旧一轮应被丢弃')
  assert.ok(messages.some(m => m.content === '新问题'))
})

test('buildHistoryMessages 尊重 maxTurns（入参按时间倒序）', () => {
  /* 入参契约与 getMessages 一致：newest-first */
  const docs = [5, 4, 3, 2, 1].map(i => turnDoc({messageCode: `m${i}`, query: `q${i}`, answer: `a${i}`, messages: [{role: 'user', content: `q${i}`}]}))
  const {messages} = buildHistoryMessages(docs, {tokenizerOptions: TOK, budget: Infinity, maxTurns: 2})
  const users = messages.filter(m => m.role === 'user')
  assert.equal(users.length, 2)
  assert.deepEqual(users.map(m => m.content), ['q4', 'q5'])
})

test('rebuildTurn 末尾 assistant 已是最终回答时不重复追加', () => {
  const doc = turnDoc({
    messages: [
      {role: 'system', content: 's'},
      {role: 'user', content: Q},
      {role: 'assistant', content: '第三轮的回答'},
    ]
  })
  const turn = rebuildTurn(doc)
  assert.deepEqual(turn.map(m => m.role), ['user', 'assistant'])
  assert.equal(turn.filter(m => m.role === 'assistant').length, 1)
})

test('rebuildTurn 中间文本不会被当成最终回答顶替真实答案', () => {
  const doc = turnDoc({messages: [{role: 'user', content: Q}, {role: 'assistant', content: '中间文本'}]})
  const turn = rebuildTurn(doc)
  assert.equal(turn[turn.length - 1].content, doc.answer)
})

test('buildHistoryMessages 截断过长的工具结果', () => {
  const long = 'X'.repeat(5000)
  const doc = turnDoc({messages: [{role: 'user', content: Q}, {role: 'tool', tool_call_id: 'c1', content: long}]})
  const {messages} = buildHistoryMessages([doc], {tokenizerOptions: TOK, budget: Infinity})
  const tool = messages.find(m => m.role === 'tool')
  assert.ok(tool.content.length < TOOL_STUB_HEAD + 60, `工具结果应被压缩，实得 ${tool.content.length}`)
  assert.ok(tool.content.includes('truncated'))
})

test('assemble 保持 system→fixed→history→current 顺序', () => {
  const r = assemble({
    systemMessages: [{role: 'system', content: 'S'}],
    fixedMessages: [{role: 'user', content: 'RAG'}, {role: 'system', content: 'SKILLS'}],
    historyMessages: [{role: 'user', content: 'hq'}, {role: 'assistant', content: 'ha'}],
    currentMessage: {role: 'user', content: 'cur'},
    tokenizerOptions: TOK,
    budget: Infinity,
  })
  assert.deepEqual(r.messages.map(m => m.content), ['S', 'RAG', 'SKILLS', 'hq', 'ha', 'cur'])
  assert.equal(r.usage.droppedCount, 0)
  assert.ok(r.usage.system > 0 && r.usage.history > 0)
  assert.equal(r.usage.total, r.usage.system + r.usage.fixed + r.usage.history + r.usage.current)
})

test('assemble 超预算时只从历史头部丢弃，保序且不删系统/当前消息', () => {
  const history = []
  for (let i = 0; i < 6; i++) {
    history.push({role: 'user', content: `h${i}`}, {role: 'assistant', content: `a${i}`})
  }
  const r = assemble({
    systemMessages: [{role: 'system', content: 'S'}],
    fixedMessages: [],
    historyMessages: history,
    currentMessage: {role: 'user', content: 'cur'},
    tokenizerOptions: TOK,
    budget: 60,
  })
  assert.equal(r.usage.total <= 60, true, `应回落至预算内，实得 ${r.usage.total}`)
  assert.equal(r.messages[0].content, 'S')
  assert.equal(r.messages[r.messages.length - 1].content, 'cur')
  assert.ok(r.usage.droppedCount > 0)
  assert.ok(r.dropped.every(d => d.reason === 'overflow'))
  /*丢弃的应是最旧的，留下的编号必须更大*/
  const kept = r.messages.filter(m => /^h\d$/.test(m.content)).map(m => Number(m.content.slice(1)))
  assert.deepEqual(kept, [...kept].sort((x, y) => x - y))
})

test('assemble 无历史时结果即 system+fixed+current', () => {
  const r = assemble({systemMessages: [{role: 'system', content: 'S'}], currentMessage: {role: 'user', content: 'c'}, tokenizerOptions: TOK, budget: Infinity})
  assert.deepEqual(r.messages.map(m => m.content), ['S', 'c'])
})

test('compactToBudget 只压缩工具消息，且在预算内时不动', () => {
  const long = 'Y'.repeat(8000)
  const msgs = [
    {role: 'system', content: 'S'},
    {role: 'user', content: 'q'},
    {role: 'assistant', content: null, tool_calls: [{id: 'c1', function: {name: 'f', arguments: '{}'}}]},
    {role: 'tool', tool_call_id: 'c1', content: long},
  ]
  const before = JSON.stringify(msgs)
  assert.equal(compactToBudget(msgs, 100000, {tokenizerOptions: TOK}), calcMessagesTokenCount(msgs, TOK))
  assert.equal(JSON.stringify(msgs), before, '预算充足时不应修改消息')

  const budget = calcMessagesTokenCount(msgs, TOK) - 100
  const after = compactToBudget(msgs, budget, {tokenizerOptions: TOK})
  assert.ok(after <= budget, `应压回预算 ${budget}，实得 ${after}`)
  assert.ok(msgs[3].content.length < long.length, '工具结果应被压缩')
  assert.equal(msgs[1].content, 'q', 'user 消息不应被动')
  assert.equal(msgs[2].tool_calls.length, 1, 'tool_calls 不应被动')
})

test('compactToBudget 对 Infinity 预算直接返回总量', () => {
  const msgs = [{role: 'tool', content: 'Z'.repeat(3000)}]
  const snapshot = JSON.stringify(msgs)
  compactToBudget(msgs, Infinity, {tokenizerOptions: TOK})
  assert.equal(JSON.stringify(msgs), snapshot)
})
