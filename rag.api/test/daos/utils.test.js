import { test } from 'node:test'
import * as assert from 'node:assert'
import utils from '../../daos/core/utils.js'

/* BaseDac 的 update/upsert/bulkUpdate* 走 attrOpen=true，updateById 走 attrOpen=false */
const open = (info, notUpdateTime) => utils.getUpdateSets(info, true, notUpdateTime)

test('getUpdateSets stamps updateTime and skips insertTime', () => {
  const sets = open({title: 'x', insertTime: new Date('2020-01-01T00:00:00.000Z')})
  assert.equal(sets.$set.title, 'x')
  assert.ok(sets.$set.updateTime instanceof Date)
  assert.equal('insertTime' in sets.$set, false)
})

test('getUpdateSets with notUpdateTime omits updateTime', () => {
  const sets = open({title: 'x'}, true)
  assert.equal('updateTime' in sets.$set, false)
})

test('getUpdateSets flattens nested objects into dotted paths', () => {
  const sets = open({operator: {userCode: 'u1', realName: '张三'}})
  assert.equal(sets.$set['operator.userCode'], 'u1')
  assert.equal(sets.$set['operator.realName'], '张三')
})

test('getUpdateSets without attrOpen assigns the whole sub-object', () => {
  const sets = utils.getUpdateSets({operator: {userCode: 'u1'}})
  assert.deepEqual(sets.$set.operator, {userCode: 'u1'})
  assert.equal('operator.userCode' in sets.$set, false)
})

test('getSetKeyValue coerces a full ISO instant with milliseconds to Date', () => {
  const sets = open({extInfo: {seenAt: '2025-01-02T03:04:05.678Z'}})
  const val = sets.$set['extInfo.seenAt']
  assert.ok(val instanceof Date)
  assert.equal(val.toISOString(), '2025-01-02T03:04:05.678Z')
})

test('getSetKeyValue leaves arbitrary 24-char strings containing T and Z untouched', () => {
  /* 修复前只判断 length===24 && endsWith('Z') && includes('T')，
     会把形似时间戳的自由文本静默改成 BSON date，且改成的是 Invalid Date */
  const garbage = 'X'.repeat(22) + 'TZ'
  assert.equal(garbage.length, 24)
  const sets = open({extInfo: {payload: garbage}})
  assert.equal(sets.$set['extInfo.payload'], garbage)
  assert.equal(sets.$set['extInfo.payload'] instanceof Date, false)
})

test('getSetKeyValue leaves calendar-invalid ISO strings untouched', () => {
  const sets = open({extInfo: {bad: '2025-13-01T00:00:00.000Z'}})
  assert.equal(sets.$set['extInfo.bad'], '2025-13-01T00:00:00.000Z')
})

test('getSetKeyValue does not coerce ISO instants without milliseconds', () => {
  /* 刻意保持与修复前一致的收敛范围（仅 24 字符毫秒形态），避免写入语义漂移 */
  const sets = open({extInfo: {noMs: '2025-01-02T03:04:05Z'}})
  assert.equal(sets.$set['extInfo.noMs'], '2025-01-02T03:04:05Z')
})

test('getSetKeyValue drops null and undefined values', () => {
  const sets = open({extInfo: {a: null, b: undefined, c: 1}})
  assert.equal('extInfo.a' in sets.$set, false)
  assert.equal('extInfo.b' in sets.$set, false)
  assert.equal(sets.$set['extInfo.c'], 1)
})

test('getSetKeyValue honours $unset and $notRecursion', () => {
  const sets = open({extInfo: {gone: {$unset: true}, raw: {$notRecursion: true, deep: {a: 1}}}})
  assert.equal(sets.$unset['extInfo.gone'], 1)
  assert.deepEqual(sets.$set['extInfo.raw'], {deep: {a: 1}})
})
