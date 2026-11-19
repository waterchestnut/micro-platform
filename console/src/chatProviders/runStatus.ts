/**
 * @fileOverview 会话级 Run 状态判据（Agent UI 演进刀 C；零依赖纯函数）
 * @module chatProviders/runStatus
 * @description
 * 调研对照（《从 Chat UI 到 Agent UI》第九章）：Agent UI 要有"这一轮现在处于什么状态"的
 * 常驻读数，而不是让用户从气泡有没有长字来猜。本件把页面手里已有的信号
 * （isRequesting / 最后一条 AI 消息的 streamState/taskKind）折叠成一个相位——
 * **不新增数据源**：信号全是既有的，这里只定"谁说了算"。
 *
 * 性格：
 * 1. 请求面 > 后台面：requesting 时以流为准；taskKind 的"后台任务"读数归 TaskCard 主管，
 *    状态条只报"已转后台"这一句事实，不冒领任务进度（两处真相禁止）。
 * 2. 续接环在跑但 SDK 不知道（!requesting && streaming）⇒ 仍报"正在生成"，但
 *    **canStop=false**：按钮按不动就别摆——假可操作比不可操作更伤信任。
 * 3. 终局（error/aborted/done）不自称忙碌：elapsed 归零由调用方按 busy 翻转处理。
 */

export type RunPhase = 'idle' | 'connecting' | 'generating' | 'error' | 'aborted' | 'background'

export type RunStatus = {phase: RunPhase; label: string; busy: boolean; canStop: boolean}

export type RunStatusInput = {
  requesting?: boolean
  /** 只消费 streamState/taskKind 两键；CommonChatMessage 直接喂（content 可能是多模态数组，与判据无关） */
  lastAi?: {streamState?: string; taskKind?: string} | null
}

/**
 * @description 折叠页面信号 → 单一相位（穷举见用例）
 */
export function deriveRunStatus({requesting = false, lastAi = null}: RunStatusInput): RunStatus {
  const st = lastAi?.streamState
  if (st === 'error') return {phase: 'error', label: '本轮失败', busy: false, canStop: false}
  if (st === 'aborted') return {phase: 'aborted', label: '本轮已停止', busy: false, canStop: false}
  if (requesting && st === 'streaming') return {phase: 'generating', label: '正在生成回答', busy: true, canStop: true}
  if (requesting) return {phase: 'connecting', label: '正在发送请求', busy: true, canStop: true}
  if (st === 'streaming') return {phase: 'generating', label: '正在续接回答', busy: true, canStop: false}
  if (lastAi?.taskKind) return {phase: 'background', label: '已转后台任务 · 进度见任务卡', busy: false, canStop: false}
  return {phase: 'idle', label: '就绪', busy: false, canStop: false}
}

/** 毫秒 → 人话秒数（9.4s / 1 分 04 秒）；非有限输入 ⇒ ''（没起点就不报时长） */
export function formatElapsed(ms?: number | null): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  const s = ms / 1000
  if (s < 60) return s < 10 ? `${s.toFixed(1)} 秒` : `${Math.round(s)} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`
}

export default {deriveRunStatus, formatElapsed}
