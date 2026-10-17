import { test } from 'node:test'
import * as assert from 'node:assert'
import { parseJSON } from '../../tools/index.js'

test('parseJSON parses plain JSON', () => {
  assert.deepEqual(parseJSON('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] })
  assert.deepEqual(parseJSON('[[1,2],{"k":"v"}]'), [[1, 2], { k: 'v' }])
  assert.equal(parseJSON('not json'), null)
  /* 已知怪癖：返回值只接受 object，标量被丢弃（属独立缺陷，本轮不改语义） */
  assert.equal(parseJSON('true'), null)
})

test('parseJSON never evaluates function-looking strings', () => {
  /* 修复前对 "function" 开头的字符串走 eval，构成任意代码执行原语 */
  const parsed = parseJSON('{"f":"function(){return 1}"}')
  assert.equal(typeof parsed.f, 'string')
  assert.equal(parsed.f, 'function(){return 1}')
})

test('parseJSON leaves nested function-looking strings untouched', () => {
  const parsed = parseJSON('{"a":{"b":["function(){return 42}"]}}')
  assert.equal(Array.isArray(parsed.a.b), true)
  assert.equal(typeof parsed.a.b[0], 'string')
})
