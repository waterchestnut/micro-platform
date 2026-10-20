import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  hashMessages,
  nextSeq,
  pickResumable,
  buildResumeContext,
  foldHorizon,
  scheduleCheckpoint,
  CHECKPOINT_PHASES,
} from '../../../../services/core/session/checkpoint.js'

const msgs = () => ([
  {role: 'system', content: '你是助手'},
  {role: 'user', content: '问题'},
  {role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'search_web', arguments: '{"q":"x"}'}}]},
  {role: 'tool', tool_call_id: 'c1', content: '结果'},
])

test('hashMessages 对同内容稳定、对内容变化敏感', () => {
  const a = hashMessages(msgs())
  const b = hashMessages(msgs())
  assert.equal(a, b)
  const changed = msgs()
  changed[1].content = '另一个问题'
  assert.notEqual(hashMessages(changed), a)
  const reordered = msgs().reverse()
  assert.notEqual(hashMessages(reordered), a, '顺序变了摘要必须变')
})

test('hashMessages 忽略不影响请求字节的展示字段，避免摘要无意义漂移', () => {
  const base = [{role: 'user', content: '问题'}]
  const withExtra = [{role: 'user', content: '问题', thoughtChains: [{a: 1}], messageCode: 'x'}]
  assert.equal(hashMessages(base), hashMessages(withExtra))
})

test('hashMessages 区分 null 内容与空串，并容忍空输入', () => {
  assert.notEqual(hashMessages([{role: 'assistant', content: null}]), hashMessages([{role: 'assistant', content: ''}]))
  assert.equal(typeof hashMessages([]), 'string')
  assert.equal(hashMessages(undefined), hashMessages([]))
})

test('nextSeq 在会话内单调递增且按会话隔离', () => {
  const conv = 'unit-conv-' + Date.now()
  assert.equal(nextSeq(conv), 1)
  assert.equal(nextSeq(conv), 2)
  assert.equal(nextSeq(conv), 3)
  assert.equal(nextSeq(conv + '-other'), 1)
  assert.ok(Number.isInteger(nextSeq(undefined)))
})

test('pickResumable 只认带完整消息现场且非终态的检查点', () => {
  const list = [
    {phase: 'final', messages: msgs()},
    {phase: 'postTools', messages: msgs()},
    {phase: 'postCreate', messages: []},
  ]
  assert.equal(pickResumable(list).phase, 'postTools')
  assert.equal(pickResumable([{phase: 'final', messages: msgs()}]), null)
  assert.equal(pickResumable([]), null)
  assert.equal(pickResumable(null), null)
})

test('buildResumeContext 还原续跑所需现场并核对字节一致', () => {
  const m = msgs()
  const cp = {
    messages: m, messagesHash: hashMessages(m), iteration: 2,
    requestMeta: {model: 'relay_common_flash', tools: ['search_web'], toolChoice: 'auto'},
    recallSnapshot: '## 已知记忆\n- 用户偏好中文。',
  }
  const ctx = buildResumeContext(cp)
  assert.equal(ctx.tools.join(','), 'search_web')
  assert.equal(ctx.model, 'relay_common_flash')
  assert.equal(ctx.iteration, 2)
  assert.equal(ctx.stable, true, '快照与哈希必须自洽')
  assert.equal(ctx.recallFrozen, cp.recallSnapshot)
  /** 续跑用副本，改上下文不得污染库里的检查点 */
  ctx.messages.push({role: 'user', content: '新追加'})
  assert.equal(cp.messages.length, m.length)
})

test('buildResumeContext 对缺现场返回 null', () => {
  assert.equal(buildResumeContext(null), null)
  assert.equal(buildResumeContext({messages: []}), null)
})

test('buildResumeContext 在快照被篡改时报告不稳定', () => {
  const ctx = buildResumeContext({messages: msgs(), messagesHash: 'deadbeef'})
  assert.equal(ctx.stable, false)
})

test('PR-16 ②：buildResumeContext 透传 sandboxId，缺省为空串而非 undefined', () => {
  const m = msgs()
  const ctx = buildResumeContext({messages: m, messagesHash: hashMessages(m), sandboxId: 'sbx-123'})
  assert.equal(ctx.sandboxId, 'sbx-123')
  const ctx2 = buildResumeContext({messages: m, messagesHash: hashMessages(m)})
  assert.equal(ctx2.sandboxId, '', '无沙箱轮次续跑上下文也要有确定的空串')
})

test('PR-16 ②：peekSharedSandboxId 只读窥视，未登记返回空串且不建箱', async () => {
  const {peekSharedSandboxId} = await import('../../../../services/sandbox/runner.js')
  assert.equal(peekSharedSandboxId('no-such-conv-' + Date.now()), '')
  assert.equal(peekSharedSandboxId(undefined), '')
})

test('foldHorizon 未超阈值不折叠，超阈值保留最近若干条', () => {
  const opts = {foldThreshold: 40, keepLast: 12}
  assert.equal(foldHorizon(39, opts), null)
  assert.equal(foldHorizon(40, opts), null)
  assert.equal(foldHorizon(41, opts), 29)
  assert.equal(foldHorizon(100, opts), 88)
  /** keepLast 大于 maxSeq 时不产生负水位 */
  assert.equal(foldHorizon(5, {foldThreshold: 1, keepLast: 50}), null)
})

test('scheduleCheckpoint 未启用时空转，阶段非法也不写', () => {
  /** 测试环境没有 llm 全局，等价于功能关闭 */
  assert.equal(scheduleCheckpoint({conversationCode: 'c', phase: 'preCreate', messages: msgs()}), null)
  assert.ok(CHECKPOINT_PHASES.includes('preCreate') && CHECKPOINT_PHASES.includes('abort'))
  assert.equal(CHECKPOINT_PHASES.length, 5)
})
