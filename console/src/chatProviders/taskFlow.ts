/**
 * @fileOverview 任务编排"受理信封"的分流判据（PR-任务编排 M8 第三仓刀一；零依赖纯函数）
 * @module chatProviders/taskFlow
 * @description
 * 背景（母本 llm.api，判据镜像自 xxzx.callin.console `utils/llmTaskFlow.ts`）：
 * 开了编排 flag 后 `/core/chat/stream` 对某些请求回的不是 SSE，而是 200 JSON 受理信封：
 *   - `{success:true, data:{taskAccepted:true, rootCode, subtasks[]}}` ——扇出已受理，后台执行；
 *   - `{success:true, data:{queued:true, rootCode, queuePosition}}` ——同会话上一轮在跑，本轮排队（§8.0）。
 * SDK 的 `jsonResponseHandler` 对 `success:true` 走 `onSuccess([chunk])`：没有一帧 SSE，
 * 占位气泡会**永远停在"正在处理"**——2026-11-13 P9 实测过的同款假状态，这次由编排信封制造。
 *
 * 本件的三件事都要"错一步就演戏"的位置上收口：
 * 1. **严判受理**（与 callin 母本逐字一致，golden 向量对拍见 test）：键不严格等、rootCode 不非空，
 *    一律 null 走原路径——把普通 JSON 响应猜成"已受理"，用户就干等一个不存在的东西。
 * 2. **信号化**：`fetchWithTaskFlow` 把信封转成带 name 的 Error 抛给既有错误通道
 *    （不合成 SSE 帧——伪造一帧"服务端从没发过"的协议数据，是把假证据灌进渲染链）。
 * 3. **人话**：`taskFlowNoteText` 说什么由信封里有什么决定。位次缺席只说"已排队"不猜第 1 位；
 *    taskAccepted 不说"结果会出现在这里"——综合落 `root:` 隔离会话不回填聊天线（既拍板），
 *    展示层何时能读到是刀二任务卡的事，本刀不许提前承诺。
 */

export interface TaskAcceptedInfo {
  rootCode: string;
  subtasks: Array<{title: string; query: string}>;
  /** §5-1：同 taskCode 重发命中幂等时为 true */
  duplicate?: boolean;
}

export interface TaskQueuedInfo {
  rootCode: string;
  /** 位次来自服务端库内计数；缺席/脏值 ⇒ null（"不知道排第几"就只说已排队） */
  queuePosition: number | null;
  idempotent?: boolean;
}

/**
 * @description 判定"扇出受理信封"。非受理/形状不对 ⇒ null（调用方维持原路径，不猜）
 */
export function matchTaskAccepted(j: any): TaskAcceptedInfo | null {
  const d = j && j.success === true ? j.data : null;
  if (!d || d.taskAccepted !== true) return null;
  const rootCode = typeof d.rootCode === 'string' ? d.rootCode.trim() : '';
  if (!rootCode) return null;
  const raw = Array.isArray(d.subtasks) ? d.subtasks : [];
  const subtasks = raw
    .filter((s: any) => s && typeof s === 'object')
    .map((s: any) => ({
      title: String(s.title || '').trim() || String(s.query || '').slice(0, 24) || '子任务',
      query: String(s.query || '').trim(),
    }))
    .filter((s: any) => s.query);
  return {rootCode, subtasks, ...(d.duplicate === true ? {duplicate: true} : {})};
}

/**
 * @description 判定"排队受理信封"（已受理≠错误≠拆树）。严判同款；位次脏 ⇒ null 不猜
 */
export function matchQueuedAccepted(j: any): TaskQueuedInfo | null {
  const d = j && j.success === true ? j.data : null;
  if (!d || d.queued !== true) return null;
  const rootCode = typeof d.rootCode === 'string' ? d.rootCode.trim() : '';
  if (!rootCode) return null;
  const pos = Number(d.queuePosition);
  const queuePosition = Number.isFinite(pos) && pos >= 1 ? Math.floor(pos) : null;
  return {rootCode, queuePosition, ...(d.idempotent === true ? {idempotent: true} : {})};
}

export type TaskFlowKind = 'accepted' | 'queued';

/* ------------------------------------------------------------------ */
/* 以下判据为 callin.console `utils/llmTaskFlow.ts` 的**跨仓镜像**（同一契约，行为对拍用例   */
/* 见 taskFlow.test.ts 的 golden 向量块；相位语义单源在 llm.api taskDetail.js 的           */
/* CHILD_PHASE/taskPhase——两仓 UI 都只是消费者，谁都不许自造相位）。                        */
/* ------------------------------------------------------------------ */

/** detail.subtasks 行（llm.api buildTaskDetailView 原样字段，只声明消费的；slot=retryOf||agentCode） */
export interface TaskSubtaskLite {
  agentCode?: string;
  title?: string;
  phase?: string;
  handleStatus?: number;
  active?: boolean;
  slot?: string;
  planRound?: number;
  followRound?: number;
  preview?: string | null;
  previewTruncated?: boolean;
  note?: string | null;
  credits?: number | null;
  insertTime?: string | null;
  updateTime?: string | null;
}

/** /core/agentTask/detail 的 data 形状（只声明本 UI 消费的字段，其余透传不猜） */
export interface TaskDetailLite {
  phase?: string;
  subtasks?: TaskSubtaskLite[];
  usage?: {tokens?: number; credits?: number; byRole?: Record<string, {rows?: number}>};
  orchestration?: {cancelled?: boolean; credits?: {priced?: boolean; missing?: unknown[]}};
}

/** 相位→人话映射（root+child 两表并集；未收录值"状态未知"——服务端扩值时 UI 绝不猜能看的词） */
const PHASE_TEXT: Record<string, string> = {
  queued: '排队中', running: '执行中', synthesizing: '收尾中', synthesized: '已完成', done: '已完成',
  'done-with-error': '完成（有异常）', partial: '部分完成', failed: '失败', cancelled: '已取消',
};
export const phaseText = (p?: string): string => PHASE_TEXT[String(p || '')] || '状态未知';

/** 树终局相位（轮询该停的判据；synthesizing 不在列——"收尾中"恰恰是最要盯的窗口） */
export const TASK_FLOW_TERMINAL_PHASES = ['synthesized', 'partial', 'failed', 'cancelled'];
export const isTaskTreeTerminal = (view: TaskDetailLite | null | undefined): boolean =>
  !!view && typeof view === 'object' && TASK_FLOW_TERMINAL_PHASES.indexOf(String(view.phase || '')) >= 0;

/**
 * 槽位分组：同 slot 多次尝试=重试换代史。不猜三处（镜像母本注释同步）——
 * slot 缺失⇒该行独立成槽；组内无 active===true⇒current=null；多 active⇒插入序末行。
 */
export function groupSlots(subtasks: TaskSubtaskLite[] | undefined | null) {
  const rows = (subtasks || []).filter((r) => r && typeof r === 'object' && r.agentCode) as TaskSubtaskLite[];
  const tsOf = (r: TaskSubtaskLite) => { const t = Date.parse(String(r.insertTime || '')); return Number.isFinite(t) ? t : 0; };
  const byKey = new Map<string, TaskSubtaskLite[]>();
  for (const r of rows) {
    const key = String(r.slot || r.agentCode);
    const list = byKey.get(key);
    if (list) list.push(r); else byKey.set(key, [r]);
  }
  const groups = [...byKey.entries()].map(([slot, list]) => {
    const sorted = [...list].sort((a, b) => tsOf(a) - tsOf(b));
    const actives = sorted.filter((x) => x.active === true);
    const current = actives.length ? actives[actives.length - 1] : null;
    return {slot, current, history: sorted.filter((x) => x !== current), attempts: sorted.length, firstTs: sorted.length ? tsOf(sorted[0]) : 0};
  });
  groups.sort((a, b) => a.firstTs - b.firstTs);
  return groups;
}

/** 用时只对终局行说真话；两端缺失/倒挂 ⇒ null */
const TERMINAL_PHASES = ['done', 'failed', 'done-with-error'];
export function elapsedText(row: TaskSubtaskLite | null | undefined): string | null {
  if (!row || TERMINAL_PHASES.indexOf(String(row.phase || '')) < 0) return null;
  const a = Date.parse(String(row.insertTime || ''));
  const b = Date.parse(String(row.updateTime || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
}

/** 会话读回取末条非空 answer（child 产出/综合正文共用；全空 ⇒ null 不演正文） */
export function pickLatestAnswer(rows: any[]): {text: string; msgCode: string} | null {
  const list = (rows || []).filter(Boolean);
  for (let i = list.length - 1; i >= 0; i--) {
    const answer = String(list[i].answer || '');
    if (answer.trim()) return {text: answer, msgCode: String(list[i].messageCode || '')};
  }
  return null;
}

/**
 * 详情视图 → 卡片模型。进度只数 active（每槽最新尝试，与 llm.api activeAttempts 同语义）；
 * done/failed 都算跑完一格，failedCount 单列；creditsPriced 三值透传（未计价由渲染层标注）。
 */
export function mapCardProgress(view: TaskDetailLite | null | undefined) {
  if (!view || typeof view !== 'object') return null;
  const kids = Array.isArray(view.subtasks) ? view.subtasks : [];
  const active = kids.filter((k) => k && k.active !== false);
  const isDone = (k: TaskSubtaskLite) => k.phase === 'done' || k.phase === 'failed' || k.phase === 'done-with-error';
  return {
    phase: String(view.phase || ''),
    phaseLabel: phaseText(view.phase),
    total: active.length,
    doneCount: active.filter(isDone).length,
    failedCount: active.filter((k) => k.phase === 'failed').length,
    items: active.map((k) => ({
      title: String(k.title || '子任务'), label: phaseText(k.phase),
      agentCode: typeof k.agentCode === 'string' ? k.agentCode : '',
      preview: typeof k.preview === 'string' && k.preview ? k.preview : null,
      previewTruncated: k.previewTruncated === true,
      elapsed: elapsedText(k),
    })),
    slots: view.subtasks && view.subtasks.length ? groupSlots(view.subtasks) : [],
    tokens: Number(view.usage?.tokens) || 0,
    credits: Number(view.usage?.credits) || 0,
    creditsPriced: view.orchestration?.credits?.priced,
    cancelled: view.orchestration?.cancelled === true || view.phase === 'cancelled',
    terminal: isTaskTreeTerminal(view),
  };
}

/** 任务信号错误与文案（刀一段，保持原位） */

export const TASK_FLOW_ERROR_NAME: Record<TaskFlowKind, string> = {
  accepted: 'TaskAccepted',
  queued: 'TaskQueued',
};

/** 信号错误：走 x-request 的 catch→onError→requestFallback 既有通道（retryInterval 未配=不会重试，已核 SDK） */
export function makeTaskFlowError(kind: TaskFlowKind, payload: TaskAcceptedInfo | TaskQueuedInfo): Error {
  const err = new Error(kind === 'queued' ? '本轮已排队' : '任务已受理') as Error & {taskFlow?: {kind: TaskFlowKind; payload: any}};
  err.name = TASK_FLOW_ERROR_NAME[kind];
  err.taskFlow = {kind, payload};
  return err;
}

/**
 * @description 从 fallback 收到的 error 里读任务信号。判据不只看 name：payload.rootCode 必须真在——
 * 别的错误恰好撞名（未来某个 fetch polyfill 也叫这个）时，宁可退回通用文案，不演"已受理"。
 */
export function readTaskFlowError(e: any): {kind: TaskFlowKind; payload: TaskAcceptedInfo | TaskQueuedInfo} | null {
  if (!e || typeof e !== 'object') return null;
  const kind: TaskFlowKind | null =
    e.name === TASK_FLOW_ERROR_NAME.accepted ? 'accepted' : e.name === TASK_FLOW_ERROR_NAME.queued ? 'queued' : null;
  if (!kind) return null;
  const p = (e as any).taskFlow?.payload;
  if (!p || typeof p.rootCode !== 'string' || !p.rootCode) return null;
  if ((e as any).taskFlow?.kind !== kind) return null;
  return {kind, payload: p};
}

/**
 * @description 气泡上那句人话（结论行，与 resumeNote 同通道，不进 content 不污染正文/档案语义）
 */
export function taskFlowNoteText(kind: TaskFlowKind, payload: TaskAcceptedInfo | TaskQueuedInfo): string {
  if (kind === 'queued') {
    const q = payload as TaskQueuedInfo;
    const base = q.queuePosition
      ? `上一条还在处理，本轮已排队（第 ${q.queuePosition} 位），轮到后自动开始`
      : '上一条还在处理，本轮已排队，轮到后自动开始';
    return q.idempotent ? `${base}（重复提交已并入同一排队轮）` : base;
  }
  const a = payload as TaskAcceptedInfo;
  const n = Array.isArray(a.subtasks) ? a.subtasks.length : 0;
  return n > 0
    ? `任务已受理：${n} 个子任务并行执行中，后台综合（本轮不直播，结果不进这条聊天档案）`
    : '任务已受理，后台执行中（本轮不直播）';
}

/* ------------------------------------------------------------------ */
/* M8 排查刀：在途任务的续跟进账目（localStorage 条目判据，纯函数）                        */
/* ------------------------------------------------------------------ */

export interface PendingTaskEntry {
  kind: 'accepted' | 'queued';
  rootCode: string;
  /** queued 的兑现凭据=排水后本会话出现同 messageCode 的档案行；accepted 存受理轮码仅作记录 */
  messageCode: string;
  note: string;
  startedAt: number;
}

/** 幂等 upsert：同 rootCode 只留最早一条（双击/重发不该堆出多张跟进气泡） */
export function upsertPendingTask(list: PendingTaskEntry[], entry: PendingTaskEntry): PendingTaskEntry[] {
  const clean = (list || []).filter((e) => e && e.rootCode)
  if (clean.some((e) => e.rootCode === entry.rootCode)) return clean
  return [...clean, entry]
}

export function removePendingTask(list: PendingTaskEntry[], rootCode: string): PendingTaskEntry[] {
  return (list || []).filter((e) => e && e.rootCode !== rootCode)
}

/**
 * 恢复时该不该把条目丢掉（每种"丢"都必须有事实撑腰）：
 * - queued 且**本会话档案已出现同 messageCode 行** ⇒ 排水兑现，跟进气泡退场；
 * - tree 相位终局（synthesized/partial/failed/cancelled）⇒ 卡片已说完结局，退场；
 * - 其余一律保留——"没读到"不构成删除理由（观测失败不动账目）。
 */
export function shouldDropPendingTask(e: PendingTaskEntry, facts: {archivedMessageCodes?: string[]; treeTerminal?: boolean}): boolean {
  if (!e) return true
  if (e.kind === 'queued') {
    const codes = facts?.archivedMessageCodes || []
    if (e.messageCode && codes.includes(e.messageCode)) return true
  }
  if (facts?.treeTerminal) return true
  return false
}

/** 从 detail 视图判终局（复用 isTaskTreeTerminal 单源；view 拉不到 ⇒ 非终局，账目保留） */
export const pendingTreeTerminalFromView = (view: TaskDetailLite | null | undefined): boolean => isTaskTreeTerminal(view)

export default {
  matchTaskAccepted, matchQueuedAccepted, makeTaskFlowError, readTaskFlowError, taskFlowNoteText, TASK_FLOW_ERROR_NAME,
  phaseText, mapCardProgress, groupSlots, elapsedText, pickLatestAnswer, isTaskTreeTerminal, TASK_FLOW_TERMINAL_PHASES,
  upsertPendingTask, removePendingTask, shouldDropPendingTask, pendingTreeTerminalFromView,
};
