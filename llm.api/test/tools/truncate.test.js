import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  estimateTokens,
  textTokens,
  truncateText,
  renderTruncated,
  truncateToolMessage,
} from '../../tools/truncate.js'

const long = (n, ch = '内') => ch.repeat(n)

test('estimateTokens 对中文按字计、对拉丁按 4 字符估一并偏保守', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('中文测试'), 4)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcdefghij'), 3, '10 个拉丁字符向上取整')
  assert.ok(estimateTokens('中文abc') >= 3)
  assert.equal(estimateTokens(null), 0)
})

test('textTokens 无分词器时退回估算', async () => {
  assert.equal(await textTokens(''), 0)
  assert.equal(await textTokens('中文测试'), 4)
  /** 未知 tokenizer 名也不得抛错，估算兜底 */
  const n = await textTokens('中文测试', {tokenizer: 'no-such-encoding'})
  assert.ok(Number.isFinite(n) && n > 0)
})

test('truncateText 在预算内原样返回', async () => {
  const src = '一段不长的工具结果'
  const ret = await truncateText(src, {maxTokens: 100})
  assert.equal(ret.truncated, false)
  assert.equal(ret.text, src)
  assert.equal(ret.droppedChars, 0)
  /** maxTokens 为 0/缺省时完全不裁 */
  assert.equal((await truncateText(long(500), {})).truncated, false)
  assert.equal((await truncateText(long(500), {maxTokens: 0})).truncated, false)
})

test('truncateText 超预算时裁剪并报告量', async () => {
  const src = long(3000)
  const ret = await truncateText(src, {maxTokens: 100, headChars: 50})
  assert.equal(ret.truncated, true)
  assert.ok(ret.originalTokens > 100, `原 tokens=${ret.originalTokens}`)
  assert.ok(ret.keptTokens <= 100, `保留 tokens=${ret.keptTokens}`)
  assert.ok(ret.text.length < src.length)
  assert.ok(ret.droppedChars > 0)
})

test('truncateText 预算极小时收缩到下限而不是硬保留 headChars', async () => {
  /** headChars 是上限不是下限：预算 1 token 却留 40 字，等于没有限制 */
  const ret = await truncateText(long(3000), {maxTokens: 1, headChars: 40})
  assert.equal(ret.truncated, true)
  assert.equal(ret.text.length, 20, '收缩到 floorChars 默认 20')
  const floored = await truncateText(long(3000), {maxTokens: 1, headChars: 40, floorChars: 6})
  assert.equal(floored.text.length, 6)
  assert.ok(floored.text.length > 0, '任何情况下都不能裁成空')
})

test('truncateText 可同时保留尾部', async () => {
  const src = '开头说明' + long(2000) + '结尾结论'
  const ret = await truncateText(src, {maxTokens: 60, headChars: 8, tailChars: 8})
  assert.equal(ret.truncated, true)
  assert.ok(ret.text.startsWith('开头说明'))
  assert.ok(ret.text.endsWith('结尾结论'), '尾部应被保留，结论常在最后')
  assert.ok(ret.text.includes('……'))
})

test('truncateText 容忍非字符串输入', async () => {
  assert.equal((await truncateText(null, {maxTokens: 10})).text, '')
  assert.equal((await truncateText(undefined, {})).text, '')
  assert.equal((await truncateText({a: 1}, {})).text, JSON.stringify({a: 1}))
})

test('renderTruncated 显式告知裁剪量与取回方式', () => {
  const full = renderTruncated({result: {truncated: false, text: '完整内容'}})
  assert.equal(full, '完整内容')
  const cut = renderTruncated({
    result: {truncated: true, text: '前半段', originalTokens: 9000, keptTokens: 1200, droppedChars: 30000},
    ref: 'att-123', hint: '可用 files.read_file 取回全文',
  })
  assert.ok(cut.startsWith('前半段'))
  assert.ok(cut.includes('原文约 9000 tokens'))
  assert.ok(cut.includes('省略 30000 字符'))
  assert.ok(cut.includes('att-123'))
  assert.ok(cut.includes('files.read_file'))
})

test('truncateToolMessage 返回新对象且不改入参', async () => {
  const msg = {role: 'tool', tool_call_id: 'c1', content: long(2000)}
  const before = msg.content
  const ret = await truncateToolMessage(msg, {maxTokens: 80, headChars: 30, ref: 'r1'})
  assert.equal(ret.truncated, true)
  assert.equal(ret.message.role, 'tool')
  assert.equal(ret.message.tool_call_id, 'c1')
  assert.ok(ret.message.content.length < before.length)
  assert.equal(msg.content, before, '入参必须不被就地修改')
})

test('truncateToolMessage 对结构化内容序列化后裁剪', async () => {
  const obj = {data: Array.from({length: 300}, (_, i) => ({i, text: '值'.repeat(20)}))}
  const msg = {role: 'tool', tool_call_id: 'c2', content: obj}
  const ret = await truncateToolMessage(msg, {maxTokens: 100, headChars: 40})
  assert.equal(ret.truncated, true)
  assert.ok(typeof ret.message.content === 'string')
  const kept = await truncateToolMessage({role: 'tool', tool_call_id: 'c3', content: '短'}, {maxTokens: 100})
  assert.equal(kept.truncated, false)
  assert.equal(kept.message.content, '短')
})
