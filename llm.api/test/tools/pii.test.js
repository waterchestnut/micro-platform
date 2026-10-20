import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  detectPii,
  maskPii,
  isValidIdCard18,
  piiSummary,
} from '../../tools/pii.js'

/**
 * 测试号码由同一套 GB 11643 校验算法算出，不属于任何真人：
 * 11010119900307002 的校验位是 X，11010119900307001 的校验位是 1。
 */
const VALID_ID_X = '11010119900307002X'
const VALID_ID_1 = '110101199003070011'
const BAD_CHECK_ID = '110101199003070019'

test('isValidIdCard18 认省份码、日期与校验位', () => {
  assert.equal(isValidIdCard18(VALID_ID_X), true, '校验位 X 的合法号')
  assert.equal(isValidIdCard18(VALID_ID_X.toLowerCase()), true, '小写 x 同样合法')
  assert.equal(isValidIdCard18(VALID_ID_1), true, '校验位为数字的合法号')
  assert.equal(isValidIdCard18(BAD_CHECK_ID), false, '校验位不符必须拒绝')
  assert.equal(isValidIdCard18('990101199003070011'), false, '不存在的省份码')
  assert.equal(isValidIdCard18('110101199013070011'), false, '13 月')
  assert.equal(isValidIdCard18('110101199002300011'), false, '2 月 30 日')
  assert.equal(isValidIdCard18('110101189003070011'), false, '早于 1900')
  assert.equal(isValidIdCard18(VALID_ID_1.slice(0, 16)), false, '16 位不是 18 位')
  assert.equal(isValidIdCard18(null), false)
})

test('detectPii 认出手机号并忽略误判来源', () => {
  const t = detectPii('我的手机是13800138000，请联系')
  assert.equal(t.length, 1)
  assert.equal(t[0].type, 'mobile')
  assert.equal(detectPii('拨打 +8613912345678 或 008613912345678').length, 2)
  assert.equal(detectPii('订单号 123456789012345').length, 0, '长数字串不得被当成手机号')
  assert.equal(detectPii('138001380001').length, 0, '后面还接数字时不是独立号码')
  assert.equal(detectPii('12800138000').length, 0, '12 号段不是手机号')
  /** 已知边界：号码内部再加分隔符（139-1234-5678）不识别，宁漏不误杀，需复核时靠日志 */
  assert.equal(detectPii('139-1234-5678').length, 0)
})

test('detectPii 认出服务商密钥', () => {
  const t = detectPii('配置 apiKey=sk-NRnTSoQxcy3zHgiHqxY0FWxepLHFBFv3 即可')
  assert.equal(t.length, 1)
  assert.equal(t[0].type, 'providerKey')
  assert.equal(detectPii('sk-short123').length, 0, '过短的不算密钥')
  assert.equal(detectPii('task-abcdefghijklmn 不是密钥').length, 0, '不以 sk- 开头')
})

test('detectPii 只在身份证校验真实合法时报出', () => {
  assert.equal(detectPii(`号码是 ${VALID_ID_X} 没错`).length, 1)
  assert.equal(detectPii(`号码是 ${BAD_CHECK_ID} 打错的`).length, 0, '校验位不符的不按身份证处理')
  assert.equal(detectPii(VALID_ID_1.slice(0, 17)).length, 0, '17 位不是 18 位')
})

test('maskPii 替换全部命中且保留其它文本', () => {
  const src = `我手机 13800138000，身份证 ${VALID_ID_X}，key sk-NRnTSoQxcy3zHgiHqxY0FWxepLHFBFv3`
  const ret = maskPii(src)
  assert.equal(ret.masked, true)
  assert.equal(ret.hits.length, 3)
  assert.ok(!ret.text.includes('13800138000'))
  assert.ok(!ret.text.includes(VALID_ID_X))
  assert.ok(!ret.text.includes('sk-NRnTSoQxcy3zHgiHqxY0FWxepLHFBFv3'))
  assert.ok(ret.text.includes('我手机') && ret.text.includes('，身份证'), '上下文必须保留，便于人工核对')
  assert.ok(ret.text.includes('[已脱敏]'))
})

test('maskPii 可按类型限定，且不改写无敏感信息的文本', () => {
  const only = maskPii(`手机13800138000 与 ${BAD_CHECK_ID}`, {types: ['mobile']})
  assert.equal(only.hits.length, 1)
  assert.ok(!only.text.includes('13800138000'))
  assert.ok(only.text.includes(BAD_CHECK_ID))
  const plain = maskPii('图书馆预算评审安排在周五')
  assert.equal(plain.masked, false)
  assert.equal(plain.text, '图书馆预算评审安排在周五')
  assert.deepEqual(detectPii(''), [])
})

test('自定义占位符生效', () => {
  const ret = maskPii('手机13800138000', {placeholder: '***'})
  assert.equal(ret.text, '手机***')
})

test('piiSummary 只报类型计数，不含原文', () => {
  const s = piiSummary(detectPii('13800138000 和 13900139000'))
  assert.equal(s, 'mobile:2')
  assert.ok(!s.includes('138'))
  assert.equal(piiSummary([]), 'none')
  assert.equal(piiSummary(null), 'none')
})
