import { test } from 'node:test'
import * as assert from 'node:assert'
import { collectRagSources } from '../../../services/core/memory/sources.js'

test('按 resCode 归并同一资源的多个片段', () => {
  const segs = [
    {content: 'a', metas: JSON.stringify({resCode: 'r1', resTitle: '文献一', resOriginalUrl: 'http://x/1'})},
    {content: 'b', metas: JSON.stringify({resCode: 'r1', resTitle: '文献一', resOriginalUrl: 'http://x/1'})},
    {content: 'c', metas: JSON.stringify({resCode: 'r2', resTitle: '文献二', resOriginalUrl: 'http://x/2'})},
  ]
  const ret = collectRagSources(segs)
  assert.equal(ret.length, 2)
  assert.deepEqual(ret.map(s => s.resCode), ['r1', 'r2'])
  assert.equal(ret[0].title, '文献一')
  assert.equal(ret[0].url, 'http://x/1')
})

test('缺 metas 时回退到片段上的 resCode（simpleResRag 路径）', () => {
  const ret = collectRagSources([{content: 'a', resCode: 'r9'}])
  assert.equal(ret.length, 1)
  assert.equal(ret[0].resCode, 'r9')
  assert.equal(ret[0].title, 'r9', '无标题时以资源标识兜底')
  assert.equal(ret[0].url, null)
})

test('非法 metas 不抛错，退化为无来源字段', () => {
  const ret = collectRagSources([{content: 'a', metas: '{not json'}])
  assert.equal(ret.length, 1)
  assert.equal(ret[0].title, '未知来源')
})

test('无 resCode 时按 segment/material 去重，仍不产生重复条目', () => {
  const segs = [
    {content: 'a', metas: JSON.stringify({ragSegmentCode: 's1'})},
    {content: 'b', metas: JSON.stringify({ragSegmentCode: 's1'})},
    {content: 'c', metas: JSON.stringify({ragSegmentCode: 's2'})},
  ]
  assert.equal(collectRagSources(segs).length, 2)
})

test('空输入安全返回空数组', () => {
  assert.deepEqual(collectRagSources(undefined), [])
  assert.deepEqual(collectRagSources([]), [])
})
