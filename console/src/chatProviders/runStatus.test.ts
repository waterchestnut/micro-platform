/**
 * Run 状态判据（刀 C）。性格三条都要被钉住：请求面>后台面、续接 canStop=false、终局不自称忙碌。
 */
import {deriveRunStatus, formatElapsed} from './runStatus';

describe('deriveRunStatus', () => {
  test('requesting + streaming ⇒ 生成中且可停', () => {
    expect(deriveRunStatus({requesting: true, lastAi: {streamState: 'streaming'}}))
      .toEqual({phase: 'generating', label: '正在生成回答', busy: true, canStop: true})
  })
  test('requesting 但流还没起来 ⇒ 发送中（也 busy 可停）', () => {
    const s = deriveRunStatus({requesting: true, lastAi: {streamState: 'done'}})
    expect({phase: s.phase, busy: s.busy, canStop: s.canStop}).toEqual({phase: 'connecting', busy: true, canStop: true})
  })
  test('续接环在跑但 SDK 不知情（!requesting && streaming）⇒ 报生成中但 canStop=false（按不动的按钮别摆）', () => {
    const s = deriveRunStatus({requesting: false, lastAi: {streamState: 'streaming'}})
    expect({phase: s.phase, busy: s.busy, canStop: s.canStop}).toEqual({phase: 'generating', busy: true, canStop: false})
  })
  test('终局不自称忙碌：error/aborted 各自点名，busy=false', () => {
    expect(deriveRunStatus({lastAi: {streamState: 'error'}})).toMatchObject({phase: 'error', busy: false, canStop: false})
    expect(deriveRunStatus({lastAi: {streamState: 'aborted'}})).toMatchObject({phase: 'aborted', busy: false, canStop: false})
  })
  test('后台任务：requesting=false 且有 taskKind ⇒ background，不冒领任务进度（进度是任务卡的事）', () => {
    const s = deriveRunStatus({requesting: false, lastAi: {streamState: 'done', taskKind: 'queued'}})
    expect({phase: s.phase, busy: s.canStop}).toEqual({phase: 'background', busy: false})
  })
  test('优先级：即便有 taskKind，只要还在 requesting/streaming 就以流为准（请求面盖后台面）', () => {
    expect(deriveRunStatus({requesting: true, lastAi: {streamState: 'streaming', taskKind: 'accepted'}}).phase).toBe('generating')
  })
  test('无 lastAi（新会话空）⇒ idle', () => {
    expect(deriveRunStatus({})).toEqual({phase: 'idle', label: '就绪', busy: false, canStop: false})
  })
})

describe('formatElapsed', () => {
  test('非法/负 ⇒ 空串（没起点不报时长）', () => {
    for (const bad of [null, undefined, NaN, -1]) expect(formatElapsed(bad as any)).toBe('')
  })
  test('阶梯：<10s 一位小数，<60s 取整，≥60s 分秒', () => {
    expect(formatElapsed(9500)).toBe('9.5 秒')
    expect(formatElapsed(45400)).toBe('45 秒')
    expect(formatElapsed(64000)).toBe('1 分 04 秒')
  })
})
