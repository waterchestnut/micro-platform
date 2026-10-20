import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  calcTextTokenCount,
  calcContentTokenCount,
  calcMessageTokenCount,
  calcMessagesTokenCount,
  calcContextBudget,
  getTokenizerOptions,
  DEFAULT_TOKENIZER,
  DEFAULT_IMAGE_TOKENS,
  PER_MESSAGE_OVERHEAD,
  TOKENIZER_VERSION,
} from '../../../services/openai/util.js'

const CJK = '你好，世界！这是一个中文测试句子，用于比较不同编码的token计数差异。'

test('TOKENIZER_VERSION 已升级，供成本核对区分口径', () => {
  assert.equal(TOKENIZER_VERSION, 'v2')
})

test('calcTextTokenCount 对空值返回 0 而非抛错', () => {
  assert.equal(calcTextTokenCount(null), 0)
  assert.equal(calcTextTokenCount(undefined), 0)
  assert.equal(calcTextTokenCount(''), 0)
})

test('calcTextTokenCount 按 tokenizer 分派，未知编码回退不抛错', () => {
  const cjk = calcTextTokenCount(CJK)
  assert.ok(cjk > 0)
  assert.equal(calcTextTokenCount(CJK, 'cl100k_base'), cjk)
  assert.ok(calcTextTokenCount(CJK, 'no-such-encoding') > 0, '未知编码应回退并仍能计数')
})

test('中文在 o200k_base 下计数低于 cl100k_base', () => {
  assert.ok(
      calcTextTokenCount(CJK, 'o200k_base') < calcTextTokenCount(CJK, 'cl100k_base'),
      'o200k 对中文更省，说明硬编码 cl100k 会高估中文'
  )
})

test('多模态 content 数组按片段计数，不再退化成 [object Object]', () => {
  const parts = [
    {type: 'text', text: '描述这张图'},
    {type: 'image_url', image_url: {url: 'http://example.com/a.png'}},
  ]
  const plain = calcTextTokenCount('描述这张图')
  const counted = calcContentTokenCount(parts)
  assert.ok(counted >= plain + DEFAULT_IMAGE_TOKENS, `期望 >= ${plain + DEFAULT_IMAGE_TOKENS}，实得 ${counted}`)
  /* 修复前 messages.map(_ => _.content).join('\n') 会把数组变成 "[object Object]"，只剩几个 token */
  const degraded = calcTextTokenCount(parts.join('\n'))
  assert.ok(counted > degraded * 10, `数组应被逐片段计数：${degraded} -> ${counted}`)
  assert.equal(parts.join('\n'), '[object Object]\n[object Object]', '旧实现把 content 数组 join 成该退化形态')
})

test('content 为 null 的 assistant 工具调用消息仍计入 tool_calls', () => {
  const call = {role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'search_web', arguments: '{"query":"人工智能"}'}}]}
  const bare = calcMessageTokenCount({role: 'assistant', content: null})
  const withCall = calcMessageTokenCount(call)
  assert.ok(withCall > bare + 10, `tool_calls 应带来额外开销：${bare} -> ${withCall}`)
})

test('calcMessagesTokenCount 计入每条消息的协议开销', () => {
  const one = calcMessageTokenCount({role: 'user', content: 'hello'})
  assert.ok(one >= PER_MESSAGE_OVERHEAD)
  assert.equal(calcMessagesTokenCount([{role: 'user', content: 'hello'}, {role: 'user', content: 'hello'}]), one * 2)
  assert.equal(calcMessagesTokenCount({role: 'user', content: 'hello'}), one, '单条对象与数组等价')
})

test('role:tool 的消息计入 tool_call_id', () => {
  const a = calcMessageTokenCount({role: 'tool', content: '结果', tool_call_id: 'call_abc123def456'})
  const b = calcMessageTokenCount({role: 'tool', content: '结果'})
  assert.ok(a > b)
})

test('calcContextBudget = contextWindow - reserveOutput - slack，且不为负', () => {
  assert.equal(calcContextBudget({contextWindow: 131072, maxTokens: 60000}, {slackTokens: 4096}), 131072 - 60000 - 4096)
  assert.equal(calcContextBudget({contextWindow: 131072, maxTokens: 60000}, {slackTokens: 4096, reserveOutput: 1000}), 131072 - 1000 - 4096)
  assert.equal(calcContextBudget({contextWindow: 1000, maxTokens: 60000}, {slackTokens: 4096}), 0, '窗口过小应夹到 0')
  assert.equal(calcContextBudget({}), 0)
})

test('getTokenizerOptions 缺省回退', () => {
  assert.deepEqual(getTokenizerOptions({}), {tokenizer: DEFAULT_TOKENIZER, imageTokens: DEFAULT_IMAGE_TOKENS})
  assert.deepEqual(getTokenizerOptions({tokenizer: 'o200k_base', imageTokens: 1024}), {tokenizer: 'o200k_base', imageTokens: 1024})
  assert.equal(getTokenizerOptions({imageTokens: 'abc'}).imageTokens, DEFAULT_IMAGE_TOKENS, '非法值应回退')
})

test('模型配置元数据一致性（micro 适配版）：配了 contextWindow 的模型必须字段完整', async () => {
  const {default: config} = await import('../../../conf/system.config.js')
  const keys = Object.keys(config.models)
  assert.ok(keys.length > 0, 'models 表不能为空')
  let configured = 0
  for (const k of keys) {
    const m = config.models[k]
    if (!m.contextWindow) {
      continue
    }
    configured++
    assert.ok(m.contextWindow > 0, `${k} contextWindow 必须为正`)
    assert.ok(typeof m.tokenizer === 'string' && m.tokenizer, `${k} 缺 tokenizer`)
    assert.ok(m.imageTokens > 0, `${k} 缺 imageTokens`)
    assert.ok(m.contextWindow > m.maxTokens, `${k} 的 contextWindow 应大于 maxTokens`)
  }
  /** 未配置的模型走 llmChat 的 budget=Infinity 兜底（不裁剪），与迁移前行为一致——
   *  按真实模型参数补 contextWindow 后自动纳入预算裁剪，见 MIGRATION-memory.md */
  assert.ok(config.context?.slackTokens > 0, '缺 context.slackTokens')
  assert.ok(config.context?.historyMaxTurns > 0, '缺 context.historyMaxTurns')
})
