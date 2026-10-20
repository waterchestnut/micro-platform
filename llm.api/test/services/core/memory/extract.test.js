import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  buildExtractMessages,
  parseExtractJson,
  normalizeCandidate,
  parseExtractResult,
  CANDIDATE_MIN_CHARS,
  CANDIDATE_MAX_CHARS,
} from '../../../../services/core/memory/extract.js'

const E1 = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const E2 = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ALLOWED = [E1, E2]

test('提示词要求只输出 JSON 且限定证据来源', () => {
  const msgs = buildExtractMessages({
    events: [{eventCode: E1, role: 'user', content: '我习惯用中文回复'}],
    channel: 'micro_common',
  })
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('只输出 JSON 数组'))
  assert.ok(msgs[0].content.includes('不得编造'))
  assert.ok(msgs[0].content.includes('micro_common'))
  assert.ok(msgs[1].content.includes(E1))
})

test('提示词把长内容截断，避免整段对话灌进抽取请求', () => {
  const long = 'x'.repeat(9000)
  const msgs = buildExtractMessages({events: [{eventCode: E1, role: 'user', content: long}]})
  assert.ok(msgs[1].content.length < 2000, `user 消息被截断，实得 ${msgs[1].content.length}`)
})

test('parseExtractJson 容忍代码块与前后废话', () => {
  const body = '[{"content":"用户偏好中文"}]'
  assert.deepEqual(parseExtractJson(body), [{content: '用户偏好中文'}])
  assert.deepEqual(parseExtractJson('```json\n' + body + '\n```'), [{content: '用户偏好中文'}])
  assert.deepEqual(parseExtractJson('抽取结果如下：\n' + body + '\n以上。'), [{content: '用户偏好中文'}])
  assert.equal(parseExtractJson('没有数组'), null)
  assert.equal(parseExtractJson(''), null)
  assert.equal(parseExtractJson('[{坏掉的'), null)
})

test('normalizeCandidate 要求证据全部命中白名单', () => {
  const good = {
    content: '用户明确要求以后都用中文回复。',
    kind: 'preference', confidence: 0.9, evidence: [E1],
  }
  assert.ok(normalizeCandidate(good, {allowedEventCodes: ALLOWED}))
  assert.equal(normalizeCandidate({...good, evidence: ['编造的标识']}, {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate({...good, evidence: [E1, '编造的标识']}, {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate({...good, evidence: []}, {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate({...good, evidence: '不是数组'}, {allowedEventCodes: ALLOWED}), null)
})
test('normalizeCandidate 约束正文长度与取值范围', () => {
  assert.equal(normalizeCandidate({content: '太短', evidence: [E1]}, {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate({content: 'x'.repeat(CANDIDATE_MAX_CHARS + 1), evidence: [E1]}, {allowedEventCodes: ALLOWED}), null)
  const r = normalizeCandidate(
    {content: 'y'.repeat(CANDIDATE_MIN_CHARS), kind: '胡说', confidence: 99, topic: 'z'.repeat(200), evidence: [E1, E1]},
    {allowedEventCodes: ALLOWED},
  )
  assert.equal(r.kind, 'fact', '非法 kind 回落 fact')
  assert.equal(r.confidence, 1, '置信度被夹到 0-1')
  assert.equal(r.topic.length, 64, '主题被截断')
  assert.deepEqual(r.eventCodes, [E1], '重复证据去重')
})

test('normalizeCandidate 处理非字符串与缺省值', () => {
  assert.equal(normalizeCandidate(null, {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate('字符串', {allowedEventCodes: ALLOWED}), null)
  assert.equal(normalizeCandidate({content: 42, evidence: [E1]}, {allowedEventCodes: ALLOWED}), null)
  const r = normalizeCandidate({content: '用户的课程是计算机。', evidence: [E1]}, {allowedEventCodes: ALLOWED})
  assert.equal(r.confidence, 0.5, '缺置信度给中性默认')
  assert.equal(r.topic, 'general')
})

test('重复给出同一证据标识不应被误判为编造而丢弃', () => {
  /** 回归：曾用"条数相等"判定编造证据，模型重复列同一标识即整条作废 */
  const r = normalizeCandidate({
    content: '用户偏好中文回复，因为英文术语不熟。',
    kind: 'preference', confidence: 0.8, evidence: [E1, E1, E2],
  }, {allowedEventCodes: ALLOWED})
  assert.ok(r, '重复标识应被去重后保留')
  assert.deepEqual(r.eventCodes, [E1, E2])
  assert.equal(r.evidence.length, 2)
})

test('entities 只保留有名字的项', () => {
  const r = normalizeCandidate({
    content: '用户在做深度学习方向的研究。', evidence: [E1],
    entities: [{name: '深度学习'}, {name: '  '}, {}, {name: null}, {entityCode: 'e2', name: '神经网络'}],
  }, {allowedEventCodes: ALLOWED})
  assert.equal(r.entities.length, 2)
  assert.equal(r.entities[1].entityCode, 'e2')
})

test('parseExtractResult 汇总产出与丢弃计数', () => {
  const text = JSON.stringify([
    {content: '用户偏好使用中文进行回复。', kind: 'preference', confidence: 0.9, evidence: [E1]},
    {content: '太短'},
    {content: '这条的证据是编造的标识。'.padEnd(20, '！'), evidence: ['xxx']},
    {content: '用户正在攻读硕士学位。', kind: 'fact', confidence: 0.8, evidence: [E2]},
  ])
  const ret = parseExtractResult(text, {allowedEventCodes: ALLOWED})
  assert.equal(ret.unparsable, false)
  assert.equal(ret.candidates.length, 2)
  assert.equal(ret.rejected, 2)
  assert.deepEqual(ret.candidates.map(_ => _.kind), ['preference', 'fact'])
})

test('parseExtractResult 输出不可解析时明确标记，避免被当成"无记忆"', () => {
  const ret = parseExtractResult('模型开始长篇大论解释', {allowedEventCodes: ALLOWED})
  assert.equal(ret.unparsable, true)
  assert.deepEqual(ret.candidates, [])
})
