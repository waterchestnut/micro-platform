import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  buildOverflowTools,
  isOverflowTool,
  sliceOverflow,
  findOverflow,
  readOverflow,
  OVERFLOW_TOOL_NAME,
  OVERFLOW_DEFAULT_LIMIT,
  OVERFLOW_MAX_LIMIT,
} from '../../tools/overflow.js'

const long = (n) => 'x'.repeat(n)

test('工具定义完整且 ref 必填', () => {
  const tools = buildOverflowTools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].type, 'function')
  assert.equal(tools[0].function.name, OVERFLOW_TOOL_NAME)
  assert.deepEqual(tools[0].function.parameters.required, ['ref'])
  assert.ok(tools[0].function.description.includes('裁剪'), '描述要告诉模型什么时候该用它')
  assert.equal(isOverflowTool(OVERFLOW_TOOL_NAME), true)
  assert.equal(isOverflowTool('memory_search'), false)
  assert.equal(isOverflowTool(undefined), false)
})

test('sliceOverflow 正常翻页并报告剩余量', () => {
  const ret = sliceOverflow({content: 'abcdefghij', offset: 0, limit: 4})
  assert.equal(ret.text, 'abcd')
  assert.equal(ret.offset, 0)
  assert.equal(ret.end, 4)
  assert.equal(ret.total, 10)
  assert.equal(ret.remaining, 6)
  assert.equal(ret.truncatedMore, true)
  const last = sliceOverflow({content: 'abcdefghij', offset: 8, limit: 4})
  assert.equal(last.text, 'ij')
  assert.equal(last.remaining, 0)
  assert.equal(last.truncatedMore, false)
})

test('sliceOverflow 越界与非法参数都不抛错', () => {
  const beyond = sliceOverflow({content: 'abc', offset: 99})
  assert.equal(beyond.text, '')
  assert.equal(beyond.total, 3)
  assert.equal(beyond.remaining, 0)
  assert.equal(sliceOverflow({content: 'abc', offset: -5}).offset, 0, '负偏移按 0 处理')
  assert.equal(sliceOverflow({content: 'abc', limit: 0}).text, 'abc', 'limit<=0 回落到默认值')
  assert.equal(sliceOverflow({content: 'abc', limit: NaN}).text, 'abc')
  assert.equal(sliceOverflow({}).text, '')
  assert.equal(sliceOverflow({content: null}).total, 0)
})

test('limit 有硬上限，翻页不能反过来撑爆上下文', () => {
  const ret = sliceOverflow({content: long(99999), limit: 10 ** 6})
  assert.equal(ret.text.length, OVERFLOW_MAX_LIMIT)
  assert.equal(ret.remaining, 99999 - OVERFLOW_MAX_LIMIT)
  const def = sliceOverflow({content: long(99999)})
  assert.equal(def.text.length, OVERFLOW_DEFAULT_LIMIT)
})

test('findOverflow 认 ref 也认 tool_call_id，且容忍脏数据', () => {
  const list = [{ref: 'a', content: 'A'}, {tool_call_id: 'b', content: 'B'}, null, {content: 'C'}]
  assert.equal(findOverflow(list, 'a').content, 'A')
  assert.equal(findOverflow(list, 'b').content, 'B')
  assert.equal(findOverflow(list, 'zzz'), null)
  assert.equal(findOverflow(null, 'a'), null)
  assert.equal(findOverflow(list, ''), null)
})

test('readOverflow 取回正文并标注只在当前轮有效', () => {
  const ret = readOverflow({
    overflows: [{ref: 'c1', tool: 'search_web', content: long(5000)}],
    ref: 'c1',
    offset: 0,
    limit: 100,
  })
  assert.equal(ret.success, true)
  assert.equal(ret.data.text.length, 100)
  assert.equal(ret.data.tool, 'search_web')
  assert.equal(ret.data.remaining, 4900)
  assert.equal(ret.data.inTurnOnly, true, '跨轮取不到这件事必须告诉模型')
})

test('readOverflow 对取不到的情况给可读原因，不抛错', () => {
  const missing = readOverflow({overflows: [], ref: 'nope'})
  assert.equal(missing.success, false)
  assert.ok(missing.error.includes('nope'))
  assert.ok(missing.error.includes('本轮'), '要说明只在本轮可取回')

  const unstored = readOverflow({overflows: [{ref: 'c2', content: ''}], ref: 'c2'})
  assert.equal(unstored.success, false)
  assert.ok(unstored.error.includes('未留档'), '超出留档上限时全文没存，要如实说')
})
