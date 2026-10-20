import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  normalizeText,
  shingles,
  similarity,
  isContained,
  decidePromotion,
  reconcileWithDocuments,
} from '../../../../services/core/memory/promotion.js'

const CFG = {autoMinConfidence: 0.6, dupSimilarity: 0.92, conflictSimilarity: 0.55}
const NOW = new Date('2026-06-01T00:00:00.000Z').getTime()
const OLD = new Date(NOW - 90 * 86400000)

const LONG_A = '用户是计算机专业的硕士生，研究方向是深度学习。'
const LONG_B = '用户是计算机专业的博士生，研究方向是深度学习。'

const cand = (over = {}) => ({
  content: '用户习惯使用中文进行技术交流。',
  kind: 'preference', topic: '语言偏好', confidence: 0.9, source: 'auto',
  insertTime: NOW, ...over,
})
const atom = (over = {}) => ({
  atomCode: 'A1', content: '用户习惯使用中文进行技术交流。',
  kind: 'preference', confidence: 0.9, source: 'auto',
  updateTime: OLD, insertTime: OLD, ...over,
})

/**
 * 已实测的相似度基线（夹具按此校准，不靠感觉设文本）：
 *   同一句仅差标点 = 1.0000；长短句改一个词(硕->博) = 0.7037；
 *   勉强达阈的改写 = 0.5556；短句只改中/英 = 0.3846（低于冲突阈值）
 */
test('normalizeText 去标点与空白，避免同句被判两条', () => {
  assert.equal(normalizeText('用户，习惯：中文！'), '用户习惯中文')
  assert.equal(normalizeText('  '), '')
  assert.equal(normalizeText(null), '')
})

test('isContained 抓住 Jaccard 漏掉的子集重复', () => {
  /** 实测相似度只有 0.6667，低于 0.92，但语义就是同一句话 */
  assert.ok(isContained('用户是高校图书馆员，负责数字资源采购。', '高校图书馆员，负责数字资源采购。'))
  assert.ok(isContained('用户是高校图书馆员。', '用户是高校图书馆员，负责数字资源采购。'))
  assert.equal(similarity('用户是高校图书馆员，负责数字资源采购。', '高校图书馆员，负责数字资源采购。') < CFG.dupSimilarity, true)
})

test('isContained 不把不同事实误判成包含', () => {
  assert.equal(isContained('用户偏好所有回复都使用中文，英文术语看不懂。', '一律使用中文回复。'), false)
  assert.equal(isContained('用户负责馆藏预算。', '用户下周要提交馆藏预算材料。'), false)
})

test('isContained 对过短文本不认定包含，避免误伤', () => {
  assert.equal(isContained('中文', '用户偏好所有回复都使用中文交流。'), false)
  assert.equal(isContained('', '用户偏好所有回复都使用中文交流。'), false)
  assert.equal(isContained(null, undefined), false)
})

test('similarity 对同一句为 1，对无关句接近 0', () => {
  assert.equal(similarity('用户偏好中文回复。', '用户偏好中文回复'), 1)
  assert.ok(similarity('用户负责图书馆资源采购。', '用户偏好中文回复。') < 0.1)
  assert.equal(similarity('', 'abc'), 0)
  assert.equal(similarity(undefined, undefined), 0)
})

test('shingles 对空文本给空集且不抛错', () => {
  assert.equal(shingles('').size, 0)
  assert.ok(shingles('用户习惯').size > 1)
})

test('完全等价的事实走 merge，不新增重复条目', () => {
  const ret = decidePromotion({candidate: cand(), existing: [atom()], config: CFG, now: NOW})
  assert.equal(ret.action, 'merge')
  assert.equal(ret.targetCode, 'A1')
  assert.equal(ret.reason, 'duplicate_content')
})

test('仅标点差异也算重复：不因写法漂移堆积', () => {
  const ret = decidePromotion({
    candidate: cand({content: '用户偏好中文回复'}),
    existing: [atom({content: '用户偏好中文回复。'})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'merge')
})

test('冲突：新增强且旧条目更弱时判 supersede', () => {
  const ret = decidePromotion({
    candidate: cand({content: LONG_B, kind: 'profile', confidence: 0.95}),
    existing: [atom({content: LONG_A, kind: 'profile', confidence: 0.5})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'supersede')
  assert.equal(ret.reason, 'conflict_newer_stronger')
  assert.ok(ret.score > CFG.conflictSimilarity && ret.score < CFG.dupSimilarity, `应落在冲突带内，实得 ${ret.score}`)
})

test('冲突但新条目更弱时不覆盖，转人工复核', () => {
  const ret = decidePromotion({
    candidate: cand({content: LONG_B, kind: 'profile', confidence: 0.4}),
    existing: [atom({content: LONG_A, kind: 'profile', confidence: 0.9})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'review')
  assert.equal(ret.reason, 'uncertain_conflict')
})

test('冲突对象是用户显式保存的内容时绝不自动替代', () => {
  const ret = decidePromotion({
    candidate: cand({content: LONG_B, kind: 'profile', confidence: 1}),
    existing: [atom({content: LONG_A, kind: 'profile', source: 'user_save', confidence: 1})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'review')
  assert.equal(ret.reason, 'conflicts_user_save')
})

test('已知局限：短句改动一字会漏判冲突而降为新增', () => {
  /** 记录实际行为而非理想行为；降低 conflictSimilarity 会反向制造大量假冲突，
      该类漏判靠 recall 侧 rerank 与人工复核兜住 */
  assert.ok(similarity('用户偏好英文回复。', '用户偏好中文回复。') < CFG.conflictSimilarity)
  const ret = decidePromotion({
    candidate: cand({content: '用户偏好英文回复。', confidence: 0.95}),
    existing: [atom({content: '用户偏好中文回复。', confidence: 0.5})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'promote')
})

test('低置信自动抽取进复核，显式保存不受阈值限制', () => {
  assert.equal(decidePromotion({candidate: cand({confidence: 0.2}), existing: [], config: CFG, now: NOW}).action, 'review')
  assert.equal(
    decidePromotion({candidate: cand({confidence: 0.2, source: 'user_save'}), existing: [], config: CFG, now: NOW}).action,
    'promote',
  )
})

test('无冲突时正常晋升', () => {
  const ret = decidePromotion({
    candidate: cand({content: '用户负责图书馆的数字资源采购流程。'}),
    existing: [atom()],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'promote')
  assert.equal(ret.targetCode, null)
})

test('不同 kind 之间不做冲突判定', () => {
  const ret = decidePromotion({
    candidate: cand({content: LONG_B, kind: 'preference'}),
    existing: [atom({content: LONG_B, kind: 'fact'})],
    config: CFG, now: NOW,
  })
  assert.equal(ret.action, 'promote')
})

test('候选或比对集异常时安全返回', () => {
  assert.equal(decidePromotion({candidate: null, config: CFG}).action, 'reject')
  assert.equal(decidePromotion({candidate: cand(), existing: undefined, config: CFG, now: NOW}).action, 'promote')
  assert.equal(decidePromotion({candidate: {content: 42}, config: CFG}).action, 'reject')
})

test('owner 文档与原子等价时压制重复，不软删', () => {
  const ret = reconcileWithDocuments({
    atom: atom({content: '用户偏好中文回复。'}),
    docLines: ['用户偏好中文回复'],
    config: CFG,
  })
  assert.equal(ret.action, 'suppress_duplicate')
})

test('owner 文档与 auto 原子冲突时软退役并留复核候选', () => {
  const ret = reconcileWithDocuments({
    atom: atom({content: LONG_A, source: 'auto'}),
    docLines: ['完全无关的一行', LONG_B],
    config: CFG,
  })
  assert.equal(ret.action, 'retire_and_review')
  assert.equal(ret.reason, 'doc_conflict')
})

test('owner 文档不覆盖用户显式保存的原子', () => {
  const ret = reconcileWithDocuments({
    atom: atom({content: LONG_A, source: 'user_save'}),
    docLines: [LONG_B],
    config: CFG,
  })
  assert.equal(ret.action, 'keep')
  assert.equal(ret.reason, 'protected_user_save')
})

test('无 atom 或无文档行时保持原样', () => {
  assert.equal(reconcileWithDocuments({atom: null, docLines: ['x'], config: CFG}).action, 'keep')
  assert.equal(reconcileWithDocuments({atom: atom(), docLines: [], config: CFG}).action, 'keep')
})
