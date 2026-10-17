import { test } from 'node:test'
import * as assert from 'node:assert'
import { checkCodeField } from '../../tools/check.js'
import { parseJSON } from '../../tools/index.js'

test('checkCodeField accepts lowercase letters, digits, dash and underscore', () => {
  for (const value of ['abc', 'a1_', 'xuexi-cn-journal', 'rag-00000000-0000-0000-0000-000000000000', 'a'.repeat(64)]) {
    assert.equal(checkCodeField(value, '标识'), true, `should accept ${value}`)
  }
})

test('checkCodeField rejects out-of-range lengths', () => {
  assert.throws(() => checkCodeField('ab', '标识'))
  assert.throws(() => checkCodeField('a'.repeat(65), '标识'))
})

test('checkCodeField rejects characters outside the documented set', () => {
  for (const value of ['Abc', 'a.b', 'a/b', 'a:b', 'a;b', 'a<b', 'a=b', 'a>b', 'a?b', 'a@b', 'a[b', 'a\\b', 'a]b', 'a^b', 'a b', 'a"b', "a'b"]) {
    assert.throws(() => checkCodeField(value, '标识'), undefined, `should reject ${JSON.stringify(value)}`)
  }
})

test('checkCodeField is stateless across repeated calls', () => {
  /* 修复前 /^[0-9a-z-_]{3,64}$/g 带 g 标志，lastIndex 会推进，
     实测对同一合法输入交替返回 true/false/true，即第二次合法调用会误抛 */
  for (let i = 0; i < 5; i++) {
    assert.equal(checkCodeField('xuexi-cn-journal', '标识'), true, `call #${i}`)
  }
  for (let i = 0; i < 5; i++) {
    assert.throws(() => checkCodeField('Xuexi', '标识'), undefined, `call #${i}`)
  }
})

test('checkCodeField ignores empty values', () => {
  assert.equal(checkCodeField(undefined, '标识'), true)
  assert.equal(checkCodeField('', '标识'), true)
  assert.equal(checkCodeField(null, '标识'), true)
})

test('parseJSON parses plain JSON', () => {
  assert.deepEqual(parseJSON('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] })
  assert.equal(parseJSON('not json'), null)
  /* 已知怪癖：返回值只接受 object，标量被丢弃，故 parseJSON('true') 得到 null。
     影响 app.js/server.js 的 trustProxy 解析，属独立缺陷，本轮不改语义 */
  assert.equal(parseJSON('true'), null)
})

test('parseJSON never evaluates function-looking strings', () => {
  const parsed = parseJSON('{"f":"function(){return process.exit(1)}"}')
  assert.equal(typeof parsed.f, 'string')
  assert.equal(parsed.f, 'function(){return process.exit(1)}')
})
