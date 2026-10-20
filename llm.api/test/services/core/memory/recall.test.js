import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  parseQuery,
  routeSources,
  applyRawPolicy,
  diversify,
  suppressAgainstManualContext,
  budgetCut,
  renderRecall,
  withTimeout,
  composeRecall,
  suppressStaleSiblings,
} from '../../../../services/core/memory/recall.js'

const TOK = {tokenizer: 'cl100k_base', imageTokens: 765}
const NOW = new Date('2026-06-01T00:00:00.000Z').getTime()

const atom = (over = {}) => ({
  atomCode: 'A1', content: '用户偏好所有回复都使用中文交流。',
  kind: 'preference', topic: '语言偏好', confidence: 0.9, source: 'auto',
  insertTime: NOW, ...over,
})

test('parseQuery 按标点切句，只留下可能命中的短词', () => {
  const terms = parseQuery('馆藏预算什么时候提交, 用中文还是英文')
  assert.deepEqual(terms, ['馆藏预算什么时候提交', '用中文还是英文'])
  assert.deepEqual(parseQuery(''), [])
  assert.deepEqual(parseQuery(null), [])
  assert.deepEqual(parseQuery('   '), [])
})

test('parseQuery 丢弃单字、停用词与超长整句', () => {
  assert.equal(parseQuery('的 了 和 ' + '长'.repeat(40)).length, 0, '整句太长不可能原样命中，必须丢掉')
  assert.deepEqual(parseQuery('请问，继续'), [])
  assert.equal(parseQuery('一 二 三 我的馆藏预算材料').length, 1)
})

test('parseQuery 最多取 6 个词，避免检索扇出失控', () => {
  const terms = parseQuery(['甲乙', '丙丁', '戊己', '庚辛', '壬癸', '子丑', '寅卯', '辰巳'].join(','))
  assert.equal(terms.length, 6)
})

test('routeSources 按查询形态决定数据源', () => {
  assert.deepEqual(routeSources({hasTerms: false, entityResolved: false, vectorCapable: false}), ['atom'])
  assert.deepEqual(routeSources({hasTerms: true, entityResolved: false, vectorCapable: false}), ['atom', 'raw'])
  assert.ok(routeSources({hasTerms: true, entityResolved: true, vectorCapable: false}).includes('entity'))
  assert.ok(routeSources({hasTerms: false, entityResolved: false, vectorCapable: true}).includes('vector'))
})

test('applyRawPolicy 已沉淀出稳定记忆时不再注入原始对话', () => {
  const atoms = [atom(), atom({atomCode: 'A2', content: '用户负责馆藏预算编制。'})]
  const events = [
    {eventCode: 'E1', conversationCode: 'c-other', content: '上次聊到预算的原文'},
  ]
  assert.equal(applyRawPolicy({atoms, events, currentConversationCode: 'c-now', suppressRaw: true}).length, 0)
  assert.equal(applyRawPolicy({atoms: [atom()], events, currentConversationCode: 'c-now', suppressRaw: true}).length, 1,
    '只有一条耐久记忆时仍应保留归档原文')
})

test('applyRawPolicy 永不回注当前会话自己的原文', () => {
  const events = [
    {eventCode: 'E1', conversationCode: 'c-now', content: '本轮原话'},
    {eventCode: 'E2', conversationCode: 'c-old', content: '旧会话原文'},
  ]
  const kept = applyRawPolicy({atoms: [], events, currentConversationCode: 'c-now', suppressRaw: false})
  assert.deepEqual(kept.map(e => e.eventCode), ['E2'])
})

test('diversify 限制同主题条数，让不同事实都有位置', () => {
  const items = [
    atom({atomCode: 'A1'}), atom({atomCode: 'A2'}), atom({atomCode: 'A3'}),
    atom({atomCode: 'B1', topic: '职业身份', content: '用户是高校图书馆员。'}),
  ]
  const kept = diversify(items, 2)
  assert.deepEqual(kept.map(i => i.atomCode), ['A1', 'A2', 'B1'])
  assert.equal(diversify(null, 2).length, 0)
})

test('suppressAgainstManualContext 抑制与 owner 文档同义的条目', async () => {
  const doc = '高校图书馆员，负责数字资源采购。'
  const kept = await suppressAgainstManualContext(
      [atom({content: '用户是高校图书馆员，负责数字资源采购。'}), atom({atomCode: 'A2', content: '用户偏好中文交流。'})],
      doc)
  assert.deepEqual(kept.map(i => i.atomCode), ['A2'], '仅靠相似度会漏，子集关系必须生效')
})

test('suppressAgainstManualContext 空文档时原样返回', async () => {
  const items = [atom()]
  assert.equal((await suppressAgainstManualContext(items, '')).length, 1)
  assert.equal((await suppressAgainstManualContext([], '一些文档')).length, 0)
})

test('budgetCut 按预算裁剪并回报丢弃数', () => {
  const items = [
    atom({atomCode: 'A1', content: '用户偏好所有回复都使用中文交流。'}),
    atom({atomCode: 'A2', content: '用户在高校图书馆工作，负责数字资源采购与馆藏预算编制。'}),
  ]
  const full = budgetCut(items, 1500, TOK)
  assert.equal(full.kept.length, 2)
  assert.equal(full.droppedCount, 0)
  assert.ok(full.tokens > 0)

  const tight = budgetCut(items, full.tokens - 1, TOK)
  assert.equal(tight.kept.length, 1, '预算不足时只保留排在前面的条目')
  assert.equal(tight.droppedCount, 1)
})

test('budgetCut 单条超预算时整条丢弃，不截断成正文碎片', () => {
  const big = atom({atomCode: 'BIG', content: '长'.repeat(400)})
  const ret = budgetCut([atom({atomCode: 'A1'}), big], 60, TOK)
  assert.ok(!ret.kept.some(i => i.atomCode === 'BIG'), JSON.stringify(ret))
  assert.ok(ret.droppedCount >= 1)
})

test('renderRecall 每条带上可引用的标识与日期', () => {
  const text = renderRecall([atom()])
  assert.ok(text.startsWith('## 已知记忆'))
  assert.ok(text.includes('A1'.slice(0, 8)))
  assert.ok(text.includes('2026-06-01'))
  assert.equal(renderRecall([]), '')
})

test('withTimeout 超时降级为 null 而不抛错', async () => {
  const ret = await withTimeout(new Promise(resolve => setTimeout(() => resolve('慢结果'), 200)), 10, 'slow')
  assert.equal(ret, null)
  assert.equal(await withTimeout(Promise.resolve('快结果'), 500, 'fast'), '快结果')
  assert.equal(await withTimeout(Promise.reject(new Error('炸了')), 500, 'boom'), null, '数据源异常也必须降级')
})

test('composeRecall 排序让人工记忆优先于自动抽取', async () => {
  const ret = await composeRecall({
    atoms: [
      atom({atomCode: 'AUTO', source: 'auto', content: '用户近期提到过预算紧张。'}),
      atom({atomCode: 'SAVE', source: 'user_save', content: '用户明确要求记住：周报每周五提交。'}),
    ],
    budget: 1500, tokenizerOptions: TOK, now: NOW,
  })
  assert.ok(ret.text.includes('周报每周五提交'))
  assert.equal(ret.items[0].atomCode, 'SAVE', '用户主动保存的应排在前面')
  assert.equal(ret.stats.ranked, 2)
})

test('composeRecall 各阶段计数可用于灰度观测', async () => {
  const ret = await composeRecall({
    atoms: [atom(), atom({atomCode: 'A2'})],
    events: [{eventCode: 'E1', conversationCode: 'c-old', content: '旧对话', insertTime: NOW}],
    entities: [{entityCode: 'X1', name: '张明', role: '对接人', kind: 'entity', content: '对接人是张明', insertTime: NOW}],
    budget: 1500, tokenizerOptions: TOK, now: NOW,
  })
  for (const key of ['atoms', 'events', 'entities', 'ranked', 'kept', 'budgetDropped', 'siblingsDropped', 'tokens', 'budget']) {
    assert.equal(typeof ret.stats[key], 'number', `缺少 ${key} 统计`)
  }
  assert.equal(ret.stats.atoms, 2)
  assert.equal(ret.stats.entities, 1)
})

test('composeRecall 无内容时返回空文本，绝不注入空段落', async () => {
  const ret = await composeRecall({budget: 1500, tokenizerOptions: TOK, now: NOW})
  assert.equal(ret.text, '')
  assert.equal(ret.items.length, 0)
})

test('composeRecall 预算为 0 时什么都不注入', async () => {
  const ret = await composeRecall({atoms: [atom()], budget: 0, tokenizerOptions: TOK, now: NOW})
  assert.equal(ret.text, '')
  assert.equal(ret.stats.budgetDropped, 1)
})

test('suppressStaleSiblings 同主题两代说法只留新的', async () => {
  const OLD = new Date('2026-01-05').getTime()
  const NEW = new Date('2026-06-05').getTime()
  const items = [
    {atomCode: 'OLD', topic: '职责范围', content: '用户负责电子资源的选型与续订。', insertTime: OLD},
    {atomCode: 'NEW', topic: '职责范围', content: '用户现在只负责电子资源的续订，选型工作已经交给同事。', insertTime: NEW},
  ]
  /** 这对句子的实测相似度是 0.2813，落在 [0.25, 0.92) 的"同一件事两种说法"区间 */
  const kept = await suppressStaleSiblings(items, {overlapSimilarity: 0.25, dupSimilarity: 0.92})
  assert.deepEqual(kept.map(i => i.atomCode), ['NEW'])
})

test('suppressStaleSiblings 不动同主题里的不同事实', async () => {
  const items = [
    {atomCode: 'A1', topic: '经费', content: '用户2025年的数字资源采购预算为120万元。', insertTime: NOW},
    {atomCode: 'A2', topic: '经费', content: '用户所在单位的图书馆管理系统是FOLIO。', insertTime: NOW},
  ]
  const kept = await suppressStaleSiblings(items, {overlapSimilarity: 0.25})
  assert.equal(kept.length, 2, '毫不相干的两条不应被当成两代说法')
})

test('suppressStaleSiblings 不因相似就越主题合并', async () => {
  const items = [
    {atomCode: 'A1', topic: '职责范围', content: '用户负责电子资源的选型与续订。', insertTime: NOW},
    {atomCode: 'A2', topic: '经费', content: '用户负责电子资源的选型与续订。', insertTime: NOW},
  ]
  const kept = await suppressStaleSiblings(items, {overlapSimilarity: 0.25})
  assert.equal(kept.length, 2, '主题不同就不该互相顶掉')
})

test('suppressStaleSiblings 对包含关系与边界输入直接放行', async () => {
  const items = [
    {atomCode: 'A1', topic: '职责范围', content: '用户是高校图书馆员。', insertTime: NOW},
    {atomCode: 'A2', topic: '职责范围', content: '用户是高校图书馆员，负责数字资源采购。', insertTime: NOW},
  ]
  assert.equal((await suppressStaleSiblings(items)).length, 2)
  assert.deepEqual(await suppressStaleSiblings([]), [])
  assert.deepEqual(await suppressStaleSiblings(null), [])
  const one = [{atomCode: 'A1', topic: 'x', content: '一条', insertTime: NOW}]
  assert.deepEqual(await suppressStaleSiblings(one), one)
})

test('composeRecall 会塌缩同主题两代说法并计数', async () => {
  const ret = await composeRecall({
    atoms: [
      {atomCode: 'OLD', topic: '职责范围', kind: 'fact', content: '用户负责电子资源的选型与续订。', confidence: 0.8, source: 'auto', insertTime: new Date('2026-01-05')},
      {atomCode: 'NEW', topic: '职责范围', kind: 'fact', content: '用户现在只负责电子资源的续订，选型工作已经交给同事。', confidence: 0.85, source: 'auto', insertTime: new Date('2026-06-05')},
    ],
    budget: 1500, tokenizerOptions: TOK, now: NOW,
    config: {recall: {siblingOverlapSimilarity: 0.25}, promotion: {dupSimilarity: 0.92}},
  })
  assert.equal(ret.stats.siblingsDropped, 1)
  assert.ok(ret.text.includes('选型工作已经交给同事'))
  assert.ok(!ret.text.includes('用户负责电子资源的选型与续订。'), '旧说法不应再被注入')
})
