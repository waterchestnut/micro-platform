import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  declaredKeys,
  findUndeclared,
  auditBody,
  auditStats,
  resetAudit,
} from '../../tools/schemaAudit.js'
import {chatStreamBodySchema} from '../../schemas/chatStreamSchema.js'

const bodySchema = {
  type: 'object',
  properties: {
    query: {type: 'string'},
    conversationCode: {type: 'string'},
    options: {type: 'object', properties: {channel: {type: 'string'}, protocol: {type: 'number'}}},
  },
}

test('declaredKeys 取属性名，缺 properties 时返回空集', () => {
  assert.deepEqual([...declaredKeys(bodySchema)], ['query', 'conversationCode', 'options'])
  assert.equal(declaredKeys({}).size, 0)
  assert.equal(declaredKeys(null).size, 0)
  assert.equal(declaredKeys({properties: 'x'}).size, 0)
})

test('findUndeclared 只报未声明的键并带上路径前缀', () => {
  const declared = declaredKeys(bodySchema.properties.options)
  assert.deepEqual(findUndeclared({channel: 'a', foo: 1, bar: 2}, declared, 'options'), ['options.foo', 'options.bar'])
  assert.deepEqual(findUndeclared({channel: 'a'}, declared, 'options'), [])
  assert.deepEqual(findUndeclared(null, declared), [])
  assert.deepEqual(findUndeclared([1, 2], declared), [], '数组不是对象载荷，不审计')
  assert.deepEqual(findUndeclared('str', declared), [])
})

test('auditBody 检出顶层与 options 内的未声明字段', () => {
  resetAudit()
  const warned = []
  const hits = auditBody({
    body: {query: 'q', bogusTop: 1, options: {channel: 'c', bogusOpt: 2}},
    schema: bodySchema,
    warn: (m) => warned.push(m),
  })
  assert.ok(hits.includes('bogusTop'))
  assert.ok(hits.includes('options.bogusOpt'))
  assert.equal(warned.length, 2)
  resetAudit()
})

test('auditBody 不记录字段值，只记录键名', () => {
  resetAudit()
  const warned = []
  auditBody({
    body: {query: 'q', options: {channel: 'c', secretToken: 'sk-very-private'}},
    schema: bodySchema,
    warn: (m) => warned.push(m),
  })
  assert.ok(warned.join('\n').includes('options.secretToken'))
  assert.ok(!warned.join('\n').includes('sk-very-private'), '日志里绝不能出现字段值')
  resetAudit()
})

test('auditBody 对同一键限次告警，避免刷爆日志', () => {
  resetAudit()
  let count = 0
  const warn = () => count++
  for (let i = 0; i < 10; i++) {
    auditBody({body: {query: 'q', repeat: i}, schema: bodySchema, warn})
  }
  assert.equal(count, 3, `重复键只应告警 3 次，实际 ${count}`)
  const stats = auditStats()
  assert.equal(stats.repeat, 10, '计数仍要累计，供翻转前核对总量')
  resetAudit()
})

test('auditBody 对空与非法载荷安全返回', () => {
  assert.deepEqual(auditBody({}), [])
  assert.deepEqual(auditBody({body: null, schema: bodySchema}), [])
  assert.deepEqual(auditBody({body: 'x', schema: bodySchema}), [])
  assert.deepEqual(auditBody({body: {query: 'q', options: null}, schema: bodySchema}), [])
})

test('真实聊天 schema：前端在用的字段都不得被报成未声明', () => {
  resetAudit()
  const realistic = {
    query: '你好',
    conversationCode: 'c1',
    options: {
      channel: 'micro_common',
      channelGroup: 'res1',
      inputs: [{type: 'image_url', image_url: {url: 'x'}}],
      messageCode: 'm1',
      attachments: [{name: 'a.pdf'}],
      answerAttachments: [],
      cache: 1,
      channelCacheKey: 'k',
      cacheIgnoreHistory: 0,
      enableThinking: 0,
      skillLoadMode: 'matched',
      streamToolResults: 1,
      protocol: 2,
      llmParams: {maxTokens: 100},
      ragParams: {resCode: 'r1', maxLength: 5, maxTokens: 2000},
      llmModel: 'relay_common_flash',
      memory: {capture: false, tokens: 500},
    },
  }
  const hits = auditBody({body: realistic, schema: chatStreamBodySchema, warn: () => {}})
  assert.deepEqual(hits, [], `这些前端在用的字段必须已声明，实际未声明: ${hits.join(', ')}`)
  const topOnly = auditBody({body: {query: 'q', conversationCode: 'c', options: {channel: 'x'}, unexpected: 1}, schema: chatStreamBodySchema, warn: () => {}})
  assert.deepEqual(topOnly, ['unexpected'])
  resetAudit()
})
