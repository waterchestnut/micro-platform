import { test } from 'node:test'
import * as assert from 'node:assert'
import Ajv from 'ajv'
import { chatStreamBodySchema } from '../../schemas/chatStreamSchema.js'

/* 与 app.js 的 ajv customOptions 保持一致，避免测试与运行时判定结果不同 */
const ajv = new Ajv({removeAdditional: false, coerceTypes: true, allErrors: true})
const validate = ajv.compile(chatStreamBodySchema)

const ok = (body, label) => assert.equal(validate(structuredClone(body)), true, `${label} 应通过: ${JSON.stringify(validate.errors)}`)
const bad = (body, label) => assert.equal(validate(structuredClone(body)), false, `${label} 应被拒绝`)

test('正常文本请求通过', () => {
  ok({query: 'ping', conversationCode: '5bf018156e044205a269af093a508d4a'}, '最小请求')
  ok({query: 'ping', conversationCode: 'c1', options: {channel: 'micro_common', channelGroup: 'none', llmModel: 'relay_common_pro'}}, '带常用 options')
})

test('真实数据中出现过的 conversationCode 形态全部通过', () => {
  for (const code of ['5bf018156e044205a269af093a508d4a', 'p0-b1', 'p0-smoke-77564', 'test', '1', 'a1b2_c3-d4']) {
    ok({query: 'q', conversationCode: code}, `code=${code}`)
  }
})

test('query 与 conversationCode 为必填', () => {
  bad({conversationCode: 'c1'}, '缺 query')
  bad({query: 'q'}, '缺 conversationCode')
  bad({}, '两者都缺')
})

test('query 为空串时必须有非空 inputs（多模态允许空文本）', () => {
  bad({query: '', conversationCode: 'c1'}, '空 query 无 inputs')
  ok({query: '', conversationCode: 'c1', options: {inputs: [{type: 'image_url', image_url: {url: 'http://x/y.png'}}]}}, '空 query 带 inputs')
  bad({query: '', conversationCode: 'c1', options: {inputs: []}}, '空 query 空 inputs')
})

test('conversationCode 约束字符集与长度', () => {
  for (const badCode of ['a/b', 'a\\b', '../etc', 'a b', 'a$b', '中文', 'x'.repeat(129), ' ']) {
    bad({query: 'q', conversationCode: badCode}, `code=${JSON.stringify(badCode)}`)
  }
})

test('未声明的额外字段继续透传（removeAdditional:false）', () => {
  ok({query: 'q', conversationCode: 'c1', someLegacyField: 'x', options: {legacy: 'y'}}, '额外字段不报错')
})

test('此前隐藏未声明的参数现已入约', () => {
  ok({
    query: 'q',
    conversationCode: 'c1',
    options: {
      messageCode: 'm1',
      cache: 1,
      channelCacheKey: 'k1',
      cacheIgnoreHistory: true,
      enableThinking: 0,
      skillLoadMode: 'matched',
      streamToolResults: 1,
      inputs: [{type: 'text', text: 'a'}],
      attachments: [{fileCode: 'f1'}],
      answerAttachments: [],
    }
  }, '前端实际会发的 options 组合')
})

test('cache 等布尔位允许前端传 0/1 数字', () => {
  for (const v of [0, 1, true, false]) {
    ok({query: 'q', conversationCode: 'c1', options: {cache: v}}, `cache=${v}`)
    ok({query: 'q', conversationCode: 'c1', options: {enableThinking: v}}, `enableThinking=${v}`)
  }
})

test('skillLoadMode 只接受枚举值', () => {
  for (const m of ['candidates', 'matched', 'full']) {
    ok({query: 'q', conversationCode: 'c1', options: {skillLoadMode: m}}, m)
  }
  bad({query: 'q', conversationCode: 'c1', options: {skillLoadMode: 'bogus'}}, '非法模式')
})

test('protocol 只接受已约定的版本', () => {
  for (const p of [1, 2]) {
    ok({query: 'q', conversationCode: 'c1', options: {protocol: p}}, `protocol=${p}`)
  }
  bad({query: 'q', conversationCode: 'c1', options: {protocol: 3}}, '未定义的协议版本')
  bad({query: 'q', conversationCode: 'c1', options: {protocol: 'x'}}, '非数字协议版本')
})

test('llmParams/ragParams 允许数字与布尔扩展项（修复前仅允许 string）', () => {
  ok({query: 'q', conversationCode: 'c1', options: {llmParams: {maxTokens: 100, temperature: 0.5, flag: true}}}, 'llmParams 数字/布尔')
  ok({query: 'q', conversationCode: 'c1', options: {ragParams: {resCode: 'r1', maxLength: 5, maxTokens: 1000}}}, 'ragParams')
  bad({query: 'q', conversationCode: 'c1', options: {ragParams: {resCode: {nested: 1}}}}, 'ragParams 对象值应拒绝')
})
