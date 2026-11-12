import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  buildOverflowTools,
  isOverflowTool,
  sliceOverflow,
  findOverflow,
  readOverflow,
  resolveToolRef,
  buildToolResultPayload,
  TOOL_RESULT_UNARCHIVED,
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

/* ---------- PR-H H3 第二半：按 ref 取留档全文的纯判据 ---------- */

test('resolveToolRef：新形状用 ref，老形状退回 tool_call_id；两个都有时以 ref 为准', () => {
  assert.equal(resolveToolRef({ref: 'a'}), 'a')
  assert.equal(resolveToolRef({tool_call_id: 'b'}), 'b')
  assert.equal(resolveToolRef({ref: 'a', tool_call_id: 'b'}), 'a')
  assert.equal(resolveToolRef(null), null)
  assert.equal(resolveToolRef(undefined), null)
  assert.equal(resolveToolRef('x'), null, '非对象不该抛，也不该产出怪 ref')
  assert.equal(resolveToolRef({}), null)
})

test('findOverflow 认老形状（既然改成复用 resolveToolRef，这条必须复测，否则"一份归一"只是说法）', () => {
  assert.equal(findOverflow([{tool_call_id: 'legacy'}], 'legacy')?.tool_call_id, 'legacy')
  assert.equal(findOverflow([{ref: 'a'}], 'a')?.ref, 'a')
  assert.equal(findOverflow([{ref: 'a'}], 'b'), null)
  assert.equal(findOverflow(null, 'a'), null)
  assert.equal(findOverflow([], 'a'), null)
})

test('buildToolResultPayload：没有留档 ⇒ 404，并把"未裁剪的结果本来就在 result 里"说清楚', () => {
  const r = buildToolResultPayload({entry: null, ref: 'call_x'})
  assert.equal(r.ok, false)
  assert.equal(r.statusCode, 404)
  assert.ok(r.error.includes('未裁剪'), '要说清最常见原因是这条根本没被裁过，而不是"数据丢了"')
  assert.ok(r.error.includes('process.toolCalls[].result'), '要给出去哪儿看的路径')
  assert.equal(r.error, TOOL_RESULT_UNARCHIVED, '文案只有一份')
})

test('buildToolResultPayload：stored=false 时给"可取回边界"，且 chars 仍是原文真实长度', () => {
  const entry = {ref: 'c1', tool: 'fetch_page', chars: 500000, stored: false, content: long(1200)}
  const r = buildToolResultPayload({entry, ref: 'c1', offset: 0, limit: 100})
  assert.equal(r.ok, true)
  assert.equal(r.data.stored, false)
  assert.equal(r.data.availableChars, 1200)
  assert.equal(r.data.chars, 500000, '留档长度不许顶掉原文长度')
  assert.equal(r.data.content.length, 100)
  assert.ok(r.data.note.includes('尾部未留存'), '必须说明超出留档上限的尾部不存在，而不是给一段看起来完整的正文')
  assert.equal(r.data.source, 'archive', '标明这是档案副本：它与当时流里的全文不保证同源')
})

test('buildToolResultPayload：翻到尽头是正常终止（200 + 空正文），不是错误', () => {
  const entry = {ref: 'c1', chars: 10, stored: true, content: long(10)}
  const r = buildToolResultPayload({entry, ref: 'c1', offset: 999})
  assert.equal(r.ok, true)
  assert.equal(r.data.content, '')
  assert.equal(r.data.remaining, 0)
  assert.equal(r.data.truncatedMore, false)
})

test('buildToolResultPayload：limit 与模型侧共用同一份切分（超上限压到 OVERFLOW_MAX_LIMIT）', () => {
  const entry = {ref: 'c1', chars: 100000, stored: true, content: long(30000)}
  const r = buildToolResultPayload({entry, ref: 'c1', offset: 0, limit: 999999})
  assert.equal(r.data.end, OVERFLOW_MAX_LIMIT)
  assert.equal(r.data.remaining, 30000 - OVERFLOW_MAX_LIMIT)
  assert.equal(r.data.truncatedMore, true)
})

test('buildToolResultPayload：老行缺 stored 键 ⇒ null（不把"没记录"洗成"留住了"）', () => {
  const r = buildToolResultPayload({entry: {tool_call_id: 'legacy', chars: 2, content: 'ab'}, ref: 'legacy'})
  assert.equal(r.data.ref, 'legacy', '缺 ref 时归一到 tool_call_id')
  assert.equal(r.data.stored, null)
  assert.ok(!r.data.note.includes('尾部未留存'), '不知道就说不知道，不编成任何一种结论')
})

test('buildToolResultPayload：content 不是字符串也不抛（视图/档案可能给出对象形状）', () => {
  const r = buildToolResultPayload({entry: {ref: 'c1', chars: 0, stored: true}, ref: 'c1'})
  assert.equal(r.ok, true)
  assert.equal(r.data.content, '')
  assert.equal(r.data.availableChars, 0)
})
