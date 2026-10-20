import { test } from 'node:test'
import * as assert from 'node:assert'
import {normalizeHit, dedupeHits} from '../../../../services/core/memory/store/hit.js'

test('normalizeHit 把限额与加权要用的字段提到顶层', () => {
  const hit = normalizeHit({
    atomCode: 'A1', content: '用户偏好中文。', score: 0.8, source: 'user_save',
    kind: 'preference', topic: '语言偏好', confidence: 1, insertTime: new Date('2026-01-01'),
  })
  assert.equal(hit.atomCode, 'A1')
  assert.equal(hit.topic, '语言偏好', 'diversify 按 topic 分桶，缺了会把所有命中当成同一主题')
  assert.equal(hit.confidence, 1, 'scoreMemory 按 confidence 加权')
  assert.equal(hit.kind, 'preference')
  assert.equal(hit.source, 'user_save')
  assert.ok(hit.insertTime)
  assert.equal(hit.atom.content, '用户偏好中文。', '原始文档仍保留，证据链不能断')
})

test('normalizeHit 对缺字段给安全默认而不是 undefined', () => {
  const hit = normalizeHit({content: 'x'})
  assert.equal(hit.atomCode, null)
  assert.equal(hit.score, 0)
  assert.equal(hit.source, 'unknown')
  assert.equal(hit.topic, 'general')
  assert.equal(hit.confidence, 0.5)
  assert.equal(normalizeHit(null).content, '')
  assert.equal(normalizeHit(null).topic, 'general')
})

test('normalizeHit 不被字符串置信度与非法值带偏', () => {
  assert.equal(normalizeHit({confidence: '0.9'}).confidence, 0.9)
  assert.equal(normalizeHit({confidence: 'abc'}).confidence, 0.5)
  assert.equal(normalizeHit({confidence: null}).confidence, 0.5)
  assert.equal(normalizeHit({score: '0.7'}).score, 0.7)
})

test('dedupeHits 同原子保分高者', () => {
  const ret = dedupeHits([
    {atomCode: 'A1', score: 0.3, content: '低分'},
    {atomCode: 'A1', score: 0.9, content: '高分'},
    {atomCode: 'A2', score: 0.5},
  ])
  assert.equal(ret.length, 2)
  const a1 = ret.find(_ => _.atomCode === 'A1')
  assert.equal(a1.score, 0.9)
  assert.equal(a1.content, '高分')
})

test('dedupeHits 对没有标识的条目不误合并', () => {
  const ret = dedupeHits([{score: 1, content: 'a'}, {score: 1, content: 'b'}])
  assert.equal(ret.length, 2)
  assert.deepEqual(dedupeHits(null), [])
  assert.deepEqual(dedupeHits([]), [])
})
