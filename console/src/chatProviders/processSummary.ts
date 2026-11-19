/**
 * @fileOverview 过程面板的摘要行与分组判据（现代化改造刀一；零依赖纯函数）
 * @module chatProviders/processSummary
 * @description
 * 背景（2026-11-19 用户点验反馈 + 调研）：通用频道会话的过程展示数据齐全（段时间线/工具/
 * 来源/技能/上下文），但交互是"全量平铺"——调研对照的现代表率（ChatGPT "Thought for 41s"、
 * Claude 工具块、Cursor 过程折叠）共同点是 **progressive disclosure**：默认一行摘要，
 * 点开才分层。本件把"摘要行说什么、默认开不开、条目怎么分组"三张判据从组件里剥出来——
 * 判错就演错戏（摘要说 12s 而实际没有时长数据=假数据；完成轮还摊开=噪音），所以全部可穷举测。
 *
 * 性格：
 * 1. **摘要只说数得出的事实**：时长=Σ段 metrics.ms（服务端给，前端不量墙钟）；没有 ms 数据
 *    就不说时长（"约 0 秒"是被禁止的形状，lostChars 之训同款）。
 * 2. **默认展开态只看流式与否**：流式中展开（跟随过程是"它还活着"的信号），终局收起
 *    （结果才是主角）。不给用户配置项——两个状态一个规则，简单是设计。
 * 3. **分组按 key 归组，不按内容猜**：ProcessPanel 的条目 key 是稳定契约（segments.ts 产出），
 *    归组函数只认 key 前缀/常量，未知 key 落"执行过程"组（保守：新条目默认进时间线，不失踪）。
 */

export type SummaryInput = {
  /** 段列表（服务端 metrics 权威） */
  segments?: Array<{kind?: string; category?: string; metrics?: {ms?: number; toolCount?: number; chars?: number}; open?: boolean}> | null;
  toolCalls?: Array<{name?: string | null; status?: string | null}> | null;
  sources?: unknown[] | null;
  usage?: {total?: number; budget?: number} | null;
  fromCache?: boolean;
  /** 本轮是否仍在流式（provider 状态） */
  streaming?: boolean;
};

/** 毫秒 → 人话；非有限/负数 ⇒ null（"没有时长数据"与"0 秒"是两件事） */
export function durationText(ms: number | null | undefined): string | null {
  // null/undefined 显式先判再转换——Number(null)===0 会把"没数据"洗成"0 秒的真值"（§7 在案陷阱，本函数首写即中招，用例抓获）
  if (ms === null || ms === undefined) return null
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${(n / 1000).toFixed(1)} 秒`
  const s = Math.round(n / 100) / 10
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60), rest = Math.round(s % 60)
  return rest > 0 ? `${m} 分 ${rest} 秒` : `${m} 分`
}

/**
 * @description 摘要行：一行说清"这一轮做了什么"。各段只在有数据时出现；全空 ⇒ 空串（不渲染）
 */
export function processSummaryLine(p: SummaryInput = {}): string {
  const parts: string[] = []
  const segs = p.segments || []
  const calls = (p.toolCalls || []).length
  if (calls > 0) parts.push(`调用工具 ${calls} 次`)
  // 时长只在"至少一段有正 ms 数据"时说——reduce 初值 0 不是测量结果（"0.0 秒"全项目没有一处是真测量）
  const msVals = segs.map((s) => Number(s?.metrics?.ms)).filter((n) => Number.isFinite(n) && n > 0)
  if (msVals.length) {
    const dur = durationText(msVals.reduce((a, b) => a + b, 0))
    if (dur) parts.push(dur)
  }
  const srcs = (p.sources || []).length
  if (srcs > 0) parts.push(`引用 ${srcs} 条来源`)
  if (p.usage && Number.isFinite(Number(p.usage.total)) && Number(p.usage.budget) > 0) {
    parts.push(`上下文 ${Math.min(100, Math.round((p.usage.total! / p.usage.budget!) * 100))}%`)
  }
  if (p.fromCache) parts.push('来自缓存')
  return parts.join(' · ')
}

/** 默认展开？流式中展开跟随，终局收起（判据就这一条，多状态是过度设计） */
export function processCollapsedByDefault(streaming?: boolean): boolean {
  return streaming !== true
}

/** 分组：key → 组。未知 key 保守落 flow（新条目不许从面板失踪） */
export type ProcessGroup = 'flow' | 'tools' | 'refs'
export function processGroupOf(key: string): ProcessGroup {
  if (key === 'tools' || key === 'model-calls') return 'tools'
  if (key === 'sources' || key === 'skills' || key === 'context') return 'refs'
  return 'flow'
}

/** 组的呈现顺序与标题（顺序稳定=肌肉记忆；标题是名词不是句子） */
export const PROCESS_GROUP_META: Record<ProcessGroup, {title: string; order: number}> = {
  flow: {title: '执行过程', order: 0},
  tools: {title: '工具与模型', order: 1},
  refs: {title: '来源与用量', order: 2},
}

export default {processSummaryLine, processCollapsedByDefault, processGroupOf, PROCESS_GROUP_META, durationText}
