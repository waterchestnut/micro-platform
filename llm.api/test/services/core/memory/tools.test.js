import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  MEMORY_TOOL_NAMES,
  buildMemoryTools,
  executeMemoryTool,
  isMemoryTool,
  memoryToolsEnabled,
} from '../../../../services/core/memory/tools.js'

const call = (name, args, id = 'c1') => ({
  id,
  type: 'function',
  function: {name, arguments: typeof args === 'string' ? args : JSON.stringify(args)},
})
const body = async (toolCall, context) => {
  const ret = await executeMemoryTool({toolCall, context})
  return JSON.parse(ret.content)
}

test('三个记忆工具的 schema 可直接交给 OpenAI tools 字段', () => {
  const tools = buildMemoryTools()
  assert.deepEqual(tools.map(t => t.function.name), ['memory_save', 'memory_search', 'memory_get'])
  for (const t of tools) {
    assert.equal(t.type, 'function')
    assert.ok(t.function.description.length > 10, `${t.function.name} 缺少给模型看的说明`)
    assert.equal(t.function.parameters.type, 'object')
    assert.ok(t.function.parameters.required.length >= 1)
    for (const key of t.function.parameters.required) {
      assert.ok(t.function.parameters.properties[key], `${t.function.name}.${key} 声明必填却没有属性定义`)
    }
  }
})

test('memory_save 只接受单条陈述与主题，避免模型复述整段对话', () => {
  const save = buildMemoryTools().find(t => t.function.name === 'memory_save')
  assert.deepEqual(save.function.parameters.required, ['content', 'topic'])
  assert.deepEqual(save.function.parameters.properties.kind.enum, ['fact', 'preference', 'decision', 'profile'])
})

test('isMemoryTool 精确识别记忆工具', () => {
  for (const name of ['memory_save', 'memory_search', 'memory_get']) {
    assert.ok(isMemoryTool(name))
  }
  assert.equal(isMemoryTool('search_web'), false)
  assert.equal(isMemoryTool('memory'), false)
  assert.equal(isMemoryTool(undefined), false)
  assert.equal(MEMORY_TOOL_NAMES.size, 3)
})

test('memoryToolsEnabled 未灰度频道不挂工具', () => {
  const llmConfig = {contextWindow: 32000, tokenizer: 'cl100k_base', imageTokens: 765}
  assert.equal(memoryToolsEnabled({channelMemory: undefined, llmConfig}), false)
  assert.equal(memoryToolsEnabled({channelMemory: {enabled: false, capture: false, recall: false}, llmConfig}), false)
  assert.equal(memoryToolsEnabled({channelMemory: {capture: true}, llmConfig}), true)
  assert.equal(memoryToolsEnabled({channelMemory: {recall: true}, llmConfig}), true)
})

test('memoryToolsEnabled 模型缺上下文窗口配置时不挂工具', () => {
  assert.equal(memoryToolsEnabled({channelMemory: {enabled: true}, llmConfig: undefined}), false)
})

test('未知工具名被拒绝，不会误落到 MCP 执行器', async () => {
  const ret = await body(call('delete_all_memory', {}), {userCode: 'u1', channel: 'c1'})
  assert.equal(ret.success, false)
  assert.match(ret.error, /未知的记忆工具/)
})

test('参数不是合法 JSON 时返回可读错误而不是抛异常', async () => {
  const ret = await body(call('memory_save', '{content: 缺引号'), {userCode: 'u1', channel: 'c1'})
  assert.equal(ret.success, false)
  assert.match(ret.error, /合法 JSON/)
})

test('缺少用户或频道上下文时拒绝执行，防止越权写入', async () => {
  for (const context of [{}, {channel: 'c1'}, {userCode: 'u1'}]) {
    const ret = await body(call('memory_save', {content: '测试', topic: '测试'}, 'c2'), context)
    assert.equal(ret.success, false, JSON.stringify(context))
    assert.match(ret.error, /缺少用户或频道/)
  }
})

test('返回体保留 tool_call_id 与 role，满足 OpenAI 工具消息格式', async () => {
  const ret = await executeMemoryTool({toolCall: call('memory_search', {query: '预算'}, 'call_42'), context: {}})
  assert.equal(ret.tool_call_id, 'call_42')
  assert.equal(ret.role, 'tool')
  assert.equal(typeof ret.content, 'string')
})

test('记忆工具内部异常也必须变成工具结果返回，不能打断聊天循环', async () => {
  /** 纯函数测试环境没有初始化数据库连接，这里正好验证失败被兜住而不是抛出 */
  const ret = await executeMemoryTool({
    toolCall: call('memory_get', {atomCode: 'NOT_EXIST'}, 'c3'),
    context: {userCode: 'nobody-u', channel: 'micro_common'},
  })
  assert.equal(ret.tool_call_id, 'c3')
  assert.equal(ret.role, 'tool')
  const parsed = JSON.parse(ret.content)
  assert.equal(parsed.success, false)
  assert.ok(typeof parsed.error === 'string' && parsed.error.length > 0)
})

test('memory_search 缺查询词时不抛异常', async () => {
  const ret = await executeMemoryTool({
    toolCall: call('memory_search', {}, 'c4'),
    context: {userCode: 'nobody-u', channel: 'micro_common'},
  })
  const parsed = JSON.parse(ret.content)
  assert.equal(typeof parsed.success, 'boolean')
})
