import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  clausesOf,
  gramsOf,
  gramWeight,
  totalGramWeight,
  alternationSource,
  lexicalScore,
  MAX_GRAMS,
} from '../../../../services/core/memory/store/lexical.js'

/** 语料里真实的一对：问题说"电子资源"，经费事实写"数字资源采购预算" */
const QUERY = '我今年买电子资源大概能花多少钱？'
const BUDGET = '用户2025年的数字资源采购预算为120万元，需要在每周五下午前提交材料。'
const VENDOR = '用户对接的电子资源供应商是启明数据，联系人张明。'

test('gramsOf 切出 2/3 元组，中文不再依赖整句字面命中', () => {
  const grams = gramsOf(QUERY)
  assert.equal(grams.length, 27)
  for (const g of ['我今', '今年', '电子', '子资', '资源', '多少', '少钱']) {
    assert.ok(grams.includes(g), `缺少元组 ${g}`)
  }
  assert.ok(!grams.some(g => g.includes('？')), '标点不参与取词')
  assert.deepEqual(gramsOf(''), [])
  assert.deepEqual(gramsOf(null), [])
})

test('gramsOf 对拉丁词同样滑窗，并把元组数封顶', () => {
  const grams = gramsOf('FOLIO 系统怎么读')
  assert.ok(grams.includes('FO') && grams.includes('OL') && grams.includes('LIO'))
  assert.ok(grams.includes('系统'))
  const long = gramsOf('数字资源采购'.repeat(30))
  assert.ok(long.length <= MAX_GRAMS, `元组数应封顶在 ${MAX_GRAMS}，实际 ${long.length}`)
})

test('clausesOf 按标点切子句并丢弃单字', () => {
  assert.deepEqual(clausesOf('我今年买电子资源大概能花多少钱？'), ['我今年买电子资源大概能花多少钱'])
  assert.deepEqual(clausesOf('采购材料, 提交时间. 预算、附注'), ['采购材料', '提交时间', '预算', '附注'])
  assert.deepEqual(clausesOf('a 的 x'), [], '单子句不参与子句级匹配')
  assert.deepEqual(clausesOf(''), [])
})

test('gramWeight 让长元组更有区分度', () => {
  assert.equal(gramWeight('电子'), 1)
  assert.equal(gramWeight('电子资'), 2)
  assert.equal(totalGramWeight(['电子', '电子资']), 3)
  assert.equal(totalGramWeight([]), 1, '总权重不得为 0，否则会除零')
})

test('alternationSource 转义正则元字符', () => {
  assert.equal(alternationSource(['a.b', 'c*d']), 'a\\.b|c\\*d')
  assert.equal(alternationSource([]), '')
  assert.equal(alternationSource(['(见)']), '\\(见\\)')
})

test('lexicalScore 与无相关性区分开：毫不相干记 0 分', () => {
  const grams = gramsOf(QUERY)
  const sig = {clauses: clausesOf(QUERY), grams, totalWeight: totalGramWeight(grams)}
  assert.equal(lexicalScore({content: '用户希望助手所有回复都使用中文。', topic: '语言偏好'}, sig), 0)
  assert.ok(lexicalScore({content: BUDGET, topic: '经费'}, sig) > 0)
  assert.equal(lexicalScore({content: '', topic: '经费'}, sig), 0)
  assert.equal(lexicalScore(null, sig), 0)
})

test('lexicalScore 的真实排序（记录实际行为，不记录理想行为）', () => {
  const grams = gramsOf(QUERY)
  const sig = {clauses: clausesOf(QUERY), grams, totalWeight: totalGramWeight(grams)}
  const vendor = lexicalScore({content: VENDOR, topic: '供应商'}, sig)
  const budget = lexicalScore({content: BUDGET, topic: '经费'}, sig)
  /**
   * 问"电子资源"、经费事实写"数字资源"，字面重叠更少，词法因此把干扰项排在前面。
   * 这不是可以靠调参消除的：词法没有"钱/预算/万元"与"花多少钱"的等价概念。
   * PR-12 的语义后端才解决这个问题，此用例固化词法的能力边界。
   */
  assert.ok(vendor > budget, `vendor=${vendor} budget=${budget}`)
  assert.ok(budget > 0 && budget < 1)
})

test('lexicalScore 主题命中加成只在查询确实含主题字时生效', () => {
  const q = '采购材料的时点怎么定'
  const grams = gramsOf(q)
  const sig = {clauses: clausesOf(q), grams, totalWeight: totalGramWeight(grams)}
  assert.ok(grams.includes('时点'), '前置条件：查询应含元组"时点"')
  const content = '用户的采购材料提交时间已排定。'
  const topicHit = lexicalScore({content, topic: '流程时点'}, sig)
  const noTopic = lexicalScore({content, topic: '经费'}, sig)
  assert.ok(topicHit > noTopic, `topicHit=${topicHit} noTopic=${noTopic}`)
})

test('lexicalScore 整子句字面命中是最强信号', () => {
  const q = '我的材料一般什么时候要交？'
  const grams = gramsOf(q)
  const sig = {clauses: clausesOf(q), grams, totalWeight: totalGramWeight(grams)}
  const paraphrase = lexicalScore({content: '用户的采购材料固定每周五下午提交。', topic: '经费'}, sig)
  const verbatim = lexicalScore({content: '我的材料一般什么时候要交，是每周五。', topic: '经费'}, sig)
  assert.ok(verbatim > paraphrase, `verbatim=${verbatim} paraphrase=${paraphrase}`)
})

test('lexicalScore 缺 totalWeight 时自行计算，不返回 NaN', () => {
  const grams = gramsOf(QUERY)
  const s = lexicalScore({content: BUDGET, topic: '经费'}, {clauses: [], grams})
  assert.ok(Number.isFinite(s) && s > 0)
  assert.equal(lexicalScore({content: BUDGET}, {clauses: [], grams: []}), 0)
})
