import { test } from 'node:test'
import * as assert from 'node:assert'
import '../../extends/RegExp.js'

const RegExpExt = global.RegExpExt

test('escape=true 时全部正则元字符按字面量匹配', () => {
  const samples = ['a.b', 'a(b)', 'a[b]', 'a+b', 'a*b', 'a?b', 'a|b', 'a{2}', 'a^b', 'a$b', 'a\\b', '(.)', '.*', '^$', '[a-z]', 'price: $5 (net)']
  for (const s of samples) {
    const re = new RegExpExt(s, 'i', true)
    assert.ok(re.test(s), `应能匹配自身字面量: ${JSON.stringify(s)}`)
  }
})

test('修复前只转义首个括号，元字符会逃逸成正则语义', () => {
  /* 旧实现 pattern.replace('(','\\(').replace(')','\\)') 只处理首个左右括号各一次 */
  const re = new RegExpExt('a.b(c)(d)', 'i', true)
  assert.equal(re.test('aXbY(c)(d)'), false, '点号不应再充当任意字符')
  assert.ok(re.test('a.b(c)(d)'), '字面量应命中')

  const dots = new RegExpExt('...', 'i', true)
  assert.equal(dots.test('abc'), false, '修复前 "..." 会匹配任意三字符')
  assert.ok(dots.test('...'))
})

test('转义对所有出现位置生效（非仅首个）', () => {
  const re = new RegExpExt('(a)(b)(c)', 'i', true)
  assert.ok(re.test('(a)(b)(c)'))
  assert.equal(re.test('abc'), false)
})

test('escape=false 时保留正则语义', () => {
  const re = new RegExpExt('a.b', 'i')
  assert.ok(re.test('axb'), '未要求转义时点号仍是任意字符')
  assert.ok(re.test('a.b'))
})

test('非字符串 pattern 不受转义影响', () => {
  assert.doesNotThrow(() => new RegExpExt(/a.b/, 'i', true))
  assert.doesNotThrow(() => new RegExpExt(null, 'i', true))
})
