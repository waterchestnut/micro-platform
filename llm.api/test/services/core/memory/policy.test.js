import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  isMemoryEnabled,
  resolveMemory,
  shouldCapture,
  isSafeUserCode,
  safeWorkspaceId,
  recencyFactor,
  scoreMemory,
  AUTO_MIN_CHARS,
} from '../../../../services/core/memory/policy.js'

const DAY = 86400000
const NOW = new Date('2026-10-17T00:00:00.000Z').getTime()

test('policy 模块不触达任何外部依赖（无需数据库即可验证）', () => {
  assert.equal(typeof isMemoryEnabled, 'function')
  assert.equal(typeof shouldCapture, 'function')
})

test('总开关关闭时一切记忆都不启用', () => {
  assert.equal(isMemoryEnabled({
    channel: 'micro_common',
    channelMemory: {enabled: true, capture: true},
    globalEnabled: false,
  }), false)
})

test('按 channel 灰度：频道未开则不启用', () => {
  assert.equal(isMemoryEnabled({channel: 'code_assistant', channelMemory: {enabled: false}, globalEnabled: true}), false)
  assert.equal(isMemoryEnabled({channel: 'micro_common', channelMemory: {enabled: true}, globalEnabled: true}), true)
})

test('agentTask 类批量会话默认排除，避免污染个人记忆', () => {
  assert.equal(isMemoryEnabled({
    channel: 'micro_common', conversationType: 'agentTask', channelMemory: {enabled: true}, globalEnabled: true,
  }), false)
  assert.equal(isMemoryEnabled({
    channel: 'micro_common', conversationType: 'chat', channelMemory: {enabled: true}, globalEnabled: true,
  }), true)
})

test('请求级覆盖只能收窄不能放大', () => {
  assert.equal(isMemoryEnabled({
    channel: 'micro_common', channelMemory: {enabled: true}, options: {memory: {enabled: false}}, globalEnabled: true,
  }), false)
  assert.equal(isMemoryEnabled({
    channel: 'pdfviewer_literature', channelMemory: {enabled: false}, options: {memory: {enabled: true}}, globalEnabled: true,
  }), false, '未灰度频道不得被请求级打开')
  assert.equal(isMemoryEnabled({
    channel: 'micro_common', channelMemory: {enabled: true}, options: {memory: {enabled: 0}}, globalEnabled: true,
  }), false, '前端常传 0/1 而非布尔')
})

test('缺 channel 时不启用', () => {
  assert.equal(isMemoryEnabled({channelMemory: {enabled: true}, globalEnabled: true}), false)
})

test('shouldCapture 只认结构化 provenance，不猜关键词', () => {
  const long = 'x'.repeat(AUTO_MIN_CHARS + 10)
  assert.equal(shouldCapture({content: long}), true)
  assert.equal(shouldCapture({content: long, provenance: {runtimeError: true}}), false)
  assert.equal(shouldCapture({content: long, provenance: {captureExclude: true}}), false)
  assert.equal(shouldCapture({content: 'Error: 调用失败但内容很长' , provenance: {}}), true,
    '文本里出现"失败"字样不影响，只有标记才算')
})

test('自动采集有长度区间，显式保存不受限', () => {
  assert.equal(shouldCapture({content: '太短'}), false)
  assert.equal(shouldCapture({content: '太短', explicitSave: true}), true)
  assert.equal(shouldCapture({content: 'x'.repeat(5000)}), false)
  assert.equal(shouldCapture({content: 'x'.repeat(5000), explicitSave: true}), true)
})

test('shouldCapture 容忍空与非字符串', () => {
  for (const v of [undefined, null, '', '   ', 0, {}, []]) {
    assert.equal(shouldCapture({content: v}), false, `不应采集 ${JSON.stringify(v)}`)
  }
})

test('共享账号与服务账号不能做记忆主键', () => {
  for (const bad of ['user-123', 'user123', 'admin', 'test', 'system', 'service', 'bot', 'anonymous', 'ab', 'a'.repeat(65), 'a/b', '中', 'xiao.ma', null, 1]) {
    assert.equal(isSafeUserCode(bad), false, `应拒绝 ${JSON.stringify(bad)}`)
  }
  /** 真实库 17 个 userCode 均为字母数字/下划线/连字符、长度 4-12，全部通过，白名单不会误伤 */
  for (const good of ['5bf018156e044205a269af093a508d4a', 'u_10086', 'abc', 'ab_cd-ef', '12345678']) {
    assert.equal(isSafeUserCode(good), true, `应接受 ${good}`)
  }
})

test('含点号的用户名被拒绝，需接入前确认账号体系', () => {
  /* dev 库无此形态；若生产存在 xiao.ma 这类邮箱式账号，主键判定会静默跳过记忆，
     届时应放宽此白名单而非放行共享账号 */
  assert.equal(isSafeUserCode('xiao.ma'), false)
})

test('recencyFactor 按半衰期衰减且对非法时间兜底为 0', () => {
  assert.equal(recencyFactor(NOW, 30, NOW), 1)
  assert.equal(recencyFactor(NOW - 30 * DAY, 30, NOW), 0.5)
  assert.equal(recencyFactor(NOW - 60 * DAY, 30, NOW), 0.25)
  assert.equal(recencyFactor('不是时间', 30, NOW), 0)
  assert.ok(recencyFactor(NOW + 10 * DAY, 30, NOW) === 1, '未来时间按 0 天处理')
})

test('scoreMemory 让显式保存压过自动抽取', () => {
  const cfg = {sourceWeight: {user_save: 3, manual_doc: 2.5, promoted: 1.5, auto: 1}, recall: {recencyTauDays: 30}}
  const base = {lexical: 1, confidence: 0.8, insertTime: NOW, config: cfg, now: NOW}
  const auto = scoreMemory({...base, source: 'auto'})
  const saved = scoreMemory({...base, source: 'user_save'})
  assert.ok(saved > auto * 2.5, `user_save(${saved}) 应显著高于 auto(${auto})`)
  assert.ok(scoreMemory({...base, source: 'auto', confidence: 1}) > scoreMemory({...base, source: 'auto', confidence: 0.1}))
  assert.ok(scoreMemory({...base, source: 'auto', insertTime: NOW - 90 * DAY}) < auto, '旧的应更低')
  assert.ok(Number.isFinite(scoreMemory({})), '全空入参不应产出 NaN')
})
test('resolveMemory 逃生门只收窄不放大', () => {
  const gray = {enabled: true, capture: true, recall: false}
  /** 请求写 true 打不开频道没开的 recall */
  const up = resolveMemory(gray, {recall: true}, true)
  assert.equal(up.recall, false)
  assert.equal(up.capture, true)
  /** 请求写 false 可以把频道已开的关掉 */
  const down = resolveMemory(gray, {capture: false}, true)
  assert.equal(down.capture, false)
  assert.equal(down.enabled, true)
  /** 0 等同 false（前端 JSON 常把布尔传成数字） */
  assert.equal(resolveMemory(gray, {enabled: 0}, true).enabled, false)
  assert.equal(resolveMemory(gray, {}, true).capture, true)
})

test('resolveMemory 总开关关闭时全部落空，未灰度频道不被请求点亮', () => {
  const off = resolveMemory({enabled: true, capture: true, recall: true}, {}, false)
  assert.equal(off.enabled, false)
  assert.equal(off.capture, false)
  assert.equal(off.recall, false)
  assert.equal(off.tools, false)
  const dark = resolveMemory({enabled: false, capture: false, recall: false}, {enabled: true, recall: true}, true)
  assert.equal(dark.recall, false, '未灰度频道不得被请求级参数放大')
})

test('resolveMemory 的 tools 默认跟随 recall，只开采集不挂工具', () => {
  /** 只开 capture 的灰度阶段不应让模型有能力写记忆 */
  assert.equal(resolveMemory({capture: true}, {}, true).tools, false)
  assert.equal(resolveMemory({recall: true}, {}, true).tools, true)
  assert.equal(resolveMemory({recall: true}, {tools: false}, true).tools, false, '请求级可单独关掉工具')
  assert.equal(resolveMemory({enabled: false, capture: false, recall: false}, {}, true).tools, false)
  /** 频道显式打开 tools 时才允许在 capture 下挂载 */
  assert.equal(resolveMemory({capture: true, tools: true}, {}, true).tools, true)
  assert.equal(resolveMemory({capture: true, tools: true}, {tools: false}, true).tools, false)
  /** 请求写 true 打不开频道没开的 recall，自然也开不了跟随 recall 的工具 */
  assert.equal(resolveMemory({capture: true}, {tools: true, recall: true}, true).tools, false)
})

test('resolveMemory 的 tokens 预算只允许下调', () => {
  const base = {enabled: true, recall: true, recallTokens: 1200}
  assert.equal(resolveMemory(base, {tokens: 600}, true).recallTokens, 600)
  assert.equal(resolveMemory(base, {tokens: 5000}, true).recallTokens, 1200, '放大无效')
  assert.equal(resolveMemory(base, {}, true).recallTokens, 1200)
  assert.equal(resolveMemory({enabled: true, recall: true}, {tokens: 800}, true).recallTokens, 800)
})

test('safeWorkspaceId：合法透传（去空白），非法形态一律 null 不做尽力解析', () => {
  assert.equal(safeWorkspaceId(' ws.a-1_B '), 'ws.a-1_B')
  assert.equal(safeWorkspaceId('agent-workspace'), 'agent-workspace')
  assert.equal(safeWorkspaceId(undefined), null)
  assert.equal(safeWorkspaceId(null), null)
  assert.equal(safeWorkspaceId(''), null)
  assert.equal(safeWorkspaceId('   '), null)
  assert.equal(safeWorkspaceId(123), null, '非字符串不接受')
  assert.equal(safeWorkspaceId('-lead'), null, '必须字母数字开头')
  assert.equal(safeWorkspaceId('../etc'), null, '路径形态拒绝')
  assert.equal(safeWorkspaceId('a'.repeat(65)), null, '超 64 拒绝')
})
