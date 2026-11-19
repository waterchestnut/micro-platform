/**
 * @fileOverview Message Part 投影判据（Agent UI 演进刀 A；零依赖纯函数）
 * @module chatProviders/messageParts
 * @description
 * 调研对照（《从 Chat UI 到 Agent UI》第四章）："Agent UI 的核心不是 Message，而是 Message Part"——
 * 一条 agent 回复应被拆成 Text/Plan/Tool/Source/Notice/Error 的结构化块，渲染层按类型选受控组件，
 * 而不是把一切压成字符串 + 一个过程面板平铺。
 *
 * 本件是**投影**不是新数据源（第六章 Plan≠Todo 的同款纪律）：console 的 message 字段
 * （content/segments/toolCalls/sources/taskNote/resumeNote/errorText）照旧落库与回放，
 * parts 只是渲染期的结构化视图——数据两份真相的风险为零，因为 parts 每次从字段现算。
 *
 * 规则（都有用例钉）：
 * 1. **顺序=结果优先**：说明行(notice) → 错误 → 正文 → 产物卡 → 计划 → 工具 → 来源。
 *    用户先拿到答案，过程细节在其后（架构图中间列同序）。
 * 2. **update_plan 升格为 Plan part，并从工具列表剔除**——同一数据在两处显示是"两处真相"的
 *    视觉版；计划是状态投影，取**最后一次** update_plan 的 items（整份替换语义，服务端契约原文）。
 * 3. 空块不出（空串正文、空工具列表）；全空 ⇒ []（渲染层回退旧路径，历史消息零风险）。
 * 4. plan 解析**防御**：args 是模型写的 JSON 字符串，坏 JSON/缺 title/非法 status 一律归一
 *    （status 缺省 pending；无 title 的条目丢弃），绝不因模型手滑让卡片崩。
 */

import {resolveToolCalls} from './segments';

export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'abandoned'
export type PlanStep = {id?: string; title: string; status: PlanStepStatus}

export type MessagePart =
  | {type: 'notice'; text: string}
  | {type: 'error'; text: string}
  | {type: 'text'; text: string}
  | {type: 'artifact'; artifactCode: string; name?: string; kind?: string; sizeBytes?: number}
  | {type: 'plan'; steps: PlanStep[]; done: number; total: number; note?: string}
  | {type: 'tools'; calls: Array<{id: string; name?: string | null; status?: string}>}
  | {type: 'sources'; items: unknown[]}

/**
 * @description 从 save_artifact 的 toolCall 结果提取产物卡数据（刀 B 投影判据）。
 * 结果串是 executeSaveArtifactTool 的 wrap（`{success,data:{artifactCode,...}}`），
 * 档案/流式两形都在 call.result（预览预算 4000 字符，save_artifact 回执远小于此——
 * 若截断解析失败 ⇒ null ⇒ 该调用**留在工具列表**走原样，不猜半份卡）。
 */
export function projectArtifactFromCall(call: any): {artifactCode: string; name?: string; kind?: string; sizeBytes?: number} | null {
  if (!call || call.name !== 'save_artifact') return null
  const r = parseArgs(call.result)
  if (!r || r.success !== true) return null
  const code = typeof r.data?.artifactCode === 'string' ? r.data.artifactCode.trim() : ''
  if (!code) return null
  const out: {artifactCode: string; name?: string; kind?: string; sizeBytes?: number} = {artifactCode: code}
  // 缺席如实不带键（关联列纪律）：name 空串渲染会出《》，kind 未知不编 file
  if (typeof r.data?.name === 'string' && r.data.name.trim()) out.name = r.data.name.trim()
  if (typeof r.data?.kind === 'string' && r.data.kind.trim()) out.kind = r.data.kind.trim()
  // sizeBytes=null（账上没记）≠ 0：null 显式先判再 Number（陷阱第三次现身）
  const sz = r.data?.sizeBytes
  if (sz !== null && sz !== undefined && Number.isFinite(Number(sz))) out.sizeBytes = Number(sz)
  return out
}

const PLAN_STATUSES: PlanStepStatus[] = ['pending', 'in_progress', 'done', 'failed', 'abandoned']

/** args 可能是对象（流式累积）或 JSON 字符串（档案回放）——两形都认，坏形返回 null（不猜） */
function parseArgs(args: any): any | null {
  if (args && typeof args === 'object') return args
  if (typeof args === 'string' && args.trim()) {
    try { const j = JSON.parse(args); return j && typeof j === 'object' ? j : null } catch { return null }
  }
  return null
}

/**
 * @description 从 toolCalls 里取最后一份有效计划（整份替换语义）；无有效计划 ⇒ null
 */
export function projectPlan(calls: any[]): {steps: PlanStep[]; note?: string} | null {
  const plans = (calls || []).filter((c) => c && c.name === 'update_plan')
  for (let i = plans.length - 1; i >= 0; i--) {
    const a = parseArgs((plans[i] as any).args)
    const raw = Array.isArray(a?.items) ? a.items : []
    const steps: PlanStep[] = []
    for (const it of raw) {
      const title = typeof it?.title === 'string' ? it.title.trim() : ''
      if (!title) continue
      const status = PLAN_STATUSES.includes(it?.status) ? it.status : 'pending'
      steps.push({id: typeof it?.id === 'string' ? it.id : undefined, title, status})
    }
    if (steps.length) {
      const out: {steps: PlanStep[]; note?: string} = {steps}
      // 空 note ⇒ 不带键（"键缺席"与"值 undefined"是两回事——关联列同款纪律）
      if (typeof a?.note === 'string' && a.note.trim()) out.note = a.note.trim()
      return out
    }
  }
  return null
}

/**
 * @description 工具行的连续归并（属主 2026-11-19）：相邻**同名同状态**的调用折成一行 ×N。
 * 只算"连续"不做全局分组——时间顺序是过程的一部分，跳着合并会把"搜索→代码→又搜索"
 * 的节奏抹平；状态参与分组是因为 pending/done 折一行会谎报"已完成 ×N"。
 */
export function projectToolRuns(calls: any[] | null | undefined): Array<{key: string; name?: string | null; status: string; count: number}> {
  const runs: Array<{key: string; name?: string | null; status: string; count: number}> = []
  for (const c of calls || []) {
    const status = c?.status || 'done'
    const name = c?.name ?? null
    const last = runs[runs.length - 1]
    if (last && last.name === name && last.status === status) { last.count++; continue }
    runs.push({key: String(c?.id ?? `i${runs.length}`), name, status, count: 1})
  }
  return runs
}

/**
 * 长回答收放（属主 2026-11-19：太长把页面撑得很高）：纯文本 parts 超过阈值才给"展开/收起"。
 * 阈值按字符数（判据可离线测；jsdom 没有布局，量高度只能等上架），钳高按 px。
 * 1000 字≈一屏半到两屏的阅读墙——低于它不折叠是噪音，高于它整段摊开才是噪音。
 */
export const TEXT_COLLAPSE_MIN_CHARS = 1000
export const TEXT_CLAMP_PX = 420
export function shouldCollapseText(text?: string): boolean {
  return typeof text === 'string' && text.length > TEXT_COLLAPSE_MIN_CHARS
}

/**
 * @description message 字段 → parts 序列（顺序=结果优先；空块过滤）
 * @param {Object} m CommonChatMessage（或历史行的等价形状）
 */
export function projectMessageParts(m: any): MessagePart[] {
  if (!m || typeof m !== 'object') return []
  const parts: MessagePart[] = []
  // 说明行：任务受理/续接结论等系统话语——独立 notice 块，不混进正文（正文是模型产出，说明是界面事实）
  const notices = [m.taskNote, m.resumeNote].filter((t) => typeof t === 'string' && t.trim())
  for (const t of notices) parts.push({type: 'notice', text: t.trim()})
  if (typeof m.errorText === 'string' && m.errorText.trim()) parts.push({type: 'error', text: m.errorText.trim()})
  const content = typeof m.content === 'string' ? m.content : ''
  if (content.trim()) parts.push({type: 'text', text: content})
  // 双源归一走 resolveToolCalls 单源（流式优先、档案兜底——segments.ts 的既有穷举，不在这里重造）
  const calls: any[] = resolveToolCalls(m.toolCalls, m.process?.toolCalls || [])
  // 产物卡（刀 B）：save_artifact 成功回执升格为 artifact 块——产物是"这一轮的产出"，
  // 紧跟正文（结果优先）；解析失败的调用留在工具列表原样可见（不猜半份卡）
  const promoted = new Set<any>()
  for (const c of calls) {
    const art = projectArtifactFromCall(c)
    if (art) {
      parts.push({type: 'artifact', ...art})
      promoted.add(c)
    }
  }
  const plan = projectPlan(calls)
  if (plan) {
    parts.push({
      type: 'plan',
      steps: plan.steps,
      done: plan.steps.filter((s) => s.status === 'done').length,
      total: plan.steps.length,
      note: plan.note,
    })
  }
  // update_plan 已升格为 Plan part，成功的 save_artifact 已升格为产物卡——同一数据不在两处显示；
  // 失败/回执解析不了的 save_artifact **留在**工具列表
  const toolCalls = calls
    .filter((c) => c && c.name !== 'update_plan' && !promoted.has(c))
    .map((c) => {
      /** 失败回执照实降级：status='done' 是传输语义（回执到了），不是业务成功——
       * save_artifact 回执里 success:false 的，投影副本改 'failed'（原对象不动：
       * ProcessPanel/详情面共用它，改源就是渲染层写数据） */
      if (c.name === 'save_artifact') {
        const r = parseArgs(c.result)
        if (r && r.success === false) return {...c, status: 'failed'}
      }
      return c
    })
  if (toolCalls.length) parts.push({type: 'tools', calls: toolCalls})
  const sources = Array.isArray(m.sources) ? m.sources : []
  if (sources.length) parts.push({type: 'sources', items: sources})
  return parts
}

export default {projectMessageParts, projectPlan, projectArtifactFromCall, projectToolRuns, shouldCollapseText, parseArgs}
