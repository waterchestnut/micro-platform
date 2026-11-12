/**
 * 协议 3 的过程分段与"这一轮为什么没有正文"的判定（纯逻辑，不依赖 React / SDK）。
 *
 * 为什么单独成文件：**这两件事的判据来自服务端实测，不是前端想象出来的**，
 * 而它们一旦被写进组件里就没法测（组件测试要起整个 Umi 环境）。
 * 判据出处：`llm.api/docs/api/chat-sse.md` §3.5 与 §"一轮没有正文时该怎么显示"，
 * 那两张表的数字是 2026-11-11 从 dev 现网读出来的（54 条 abort 行：3 有段 / 9 被回填 / 3 确实空）。
 *
 * 两条硬规矩写在这里：
 * 1. **段以 `seq` 为唯一关联键且必须幂等**——断线续接会带**原始 id 重放**已发过的事件，
 *    非幂等的合并会把同一段变成两段。
 * 2. **`lostChars` 只有 `> 0` 才能引用**：回填行历史数据里存在 `0`（当时的代码把"没估过"写成了 0），
 *    照着说就成了"约 0 字未保存"——既精确又假。
 */

/** 段的种类由服务端给全，前端不要从事件顺序反推（反推会把 finalize 猜成 tool-round） */
export type ChatSegmentKind = 'tool-round' | 'skill-reload' | 'finalize' | 'answer' | 'cancelled';

export type ChatSegmentMetrics = {
  chars?: number;
  toolCount?: number;
  ms?: number;
};

export type ChatSegment = {
  /** 一轮内从 1 递增；超限丢段仍占号，所以它可能不连续，但一定唯一 */
  seq: number;
  kind: ChatSegmentKind | string;
  /** 渲染大类：tools / skill / text（服务端给，前端不猜） */
  category?: string;
  title?: string;
  /** 段正文：`answer`/`finalize`/`cancelled` 三类为空，全文在 message.answer（`ref:'answer'` 就是指针） */
  text?: string;
  ref?: string | null;
  tools?: string[];
  metrics?: ChatSegmentMetrics;
  truncated?: boolean;
  /** 只在本端为真：收到 segment_start 还没收到 segment_end（渲染成"进行中"） */
  open?: boolean;
};

/** 防御性上限：异常长流不该把段列表无限撑大（服务端自己有收敛上限，前端不信任输入） */
export const MAX_CLIENT_SEGMENTS = 500;

/**
 * @description `segment_start` 的载荷形状
 * @param {any} payload 解析后的 data
 * @returns {boolean} 是否可用
 */
export function isSegmentPayload(payload: any): boolean {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof payload.seq === 'number' &&
    Number.isFinite(payload.seq)
  );
}

/**
 * @description 按 seq 取出旧段（没有则 undefined）
 * @param {ChatSegment[]} segments 现有段
 * @param {number} seq 段号
 * @returns {ChatSegment | undefined} 段
 */
function findSeg(segments: ChatSegment[], seq: number): ChatSegment | undefined {
  return segments.find((s) => s.seq === seq);
}

/**
 * @description 处理 `segment_start`：开一个"进行中"的段；重复收到同 seq 不新增
 * @param {ChatSegment[]} segments 现有段
 * @param {any} payload 事件载荷
 * @returns {ChatSegment[]} 新数组（不可变，React 状态要比较引用）
 */
export function applySegmentStart(segments: ChatSegment[], payload: any): ChatSegment[] {
  if (!isSegmentPayload(payload)) return segments;
  const seq = payload.seq as number;
  const list = segments || [];
  const prev = findSeg(list, seq);
  const next: ChatSegment = {
    ...(prev || {}),
    seq,
    kind: payload.kind || prev?.kind || 'tool-round',
    category: payload.category || prev?.category,
    title: payload.title ?? prev?.title,
    open: true,
  };
  if (prev) {
    return list.map((s) => (s.seq === seq ? next : s));
  }
  /**
   * 必须排序：`segment_start` 与 `segment_end` 都可能**乱序到达**（断线续接从中间游标重放、
   * 或 start 在断线前已丢弃而 end 后到）。不排序的话时间线会把后到的低 seq 排在末尾，
   * 用户看到的执行顺序就是错的——这条是它自己的用例抓出来的，不是设想。
   */
  return [...list, next].sort((a, b) => a.seq - b.seq).slice(-MAX_CLIENT_SEGMENTS);
}

/**
 * @description 处理 `segment_end`：合上该段并带上计数；**允许先收到 end**（续接时 start 可能已在断线前落定）
 * @param {ChatSegment[]} segments 现有段
 * @param {any} payload 事件载荷
 * @returns {ChatSegment[]} 新数组
 */
export function applySegmentEnd(segments: ChatSegment[], payload: any): ChatSegment[] {
  if (!isSegmentPayload(payload)) return segments;
  const seq = payload.seq as number;
  const list = segments || [];
  const prev = findSeg(list, seq);
  const next: ChatSegment = {
    ...(prev || {}),
    seq,
    kind: payload.kind || prev?.kind || 'tool-round',
    category: payload.category || prev?.category,
    title: payload.title ?? prev?.title,
    metrics: payload.metrics || prev?.metrics,
    truncated: payload.truncated ?? prev?.truncated,
    ref: payload.ref !== undefined ? payload.ref : prev?.ref,
    tools: payload.tools || prev?.tools,
    /** end 就是"这段结束了"，无论之前有没有见过 start */
    open: false,
  };
  if (prev) {
    return list.map((s) => (s.seq === seq ? next : s));
  }
  return [...list, next].sort((a, b) => a.seq - b.seq).slice(-MAX_CLIENT_SEGMENTS);
}

/**
 * @description 历史回填：把 `/core/message/list` 的 `process.segments` 归一成前端段形状
 * @param {any[]} raw 视图里的段数组
 * @returns {ChatSegment[]} 段列表
 */
export function fromHistorySegments(raw: any[]): ChatSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => isSegmentPayload(s))
    .map((s) => ({ ...s, open: false } as ChatSegment))
    .sort((a, b) => a.seq - b.seq);
}

/** 段的渲染标签：图标/分组只看 `category`（服务端给），缺失时按 kind 兜底但不猜内容 */
const CATEGORY_BY_KIND: Record<string, string> = {
  'tool-round': 'tools',
  'skill-reload': 'skill',
  finalize: 'text',
  answer: 'text',
  cancelled: 'text',
};

/**
 * @description 取段的渲染大类
 * @param {ChatSegment} seg 段
 * @returns {String} tools / skill / text
 */
export function segmentCategory(seg: ChatSegment): string {
  if (seg?.category) return seg.category;
  return CATEGORY_BY_KIND[seg?.kind as string] || 'text';
}

/**
 * @description 段的度量文案（只说服务端确实给了的数）
 * @param {ChatSegment} seg 段
 * @returns {String} 形如 `35 字 · 1 个工具 · 1.6s`；一个都没有时给空串
 */
export function segmentMetricsText(seg: ChatSegment): string {
  const m = seg?.metrics || {};
  const parts: string[] = [];
  if (typeof m.chars === 'number') parts.push(`${m.chars} 字`);
  if (typeof m.toolCount === 'number' && m.toolCount > 0) parts.push(`${m.toolCount} 个工具`);
  if (typeof m.ms === 'number' && m.ms > 0) parts.push(`${(m.ms / 1000).toFixed(1)}s`);
  if (seg?.truncated) parts.push('已截断');
  return parts.join(' · ');
}

/**
 * @description 段下方该不该再放一份正文，该放什么提示
 * @param {ChatSegment} seg 段
 * @returns {String | null} null 表示不渲染任何正文区
 *
 * 为什么这条判断在纯模块里而不是组件里：`answer`/`finalize`/`cancelled` 三类的全文**已经在
 * `message.answer` 里**（`ref:'answer'` 就是指针），组件里再抄一份就会出现"流里看到的字数"
 * 与"库里回放的字数"两套数。这是个业务判据，不是样式决定，所以要能被穷举测试。
 */
export function segmentBodyHint(seg: ChatSegment): string | null {
  if (!seg) return null;
  if (seg.text) return null; // 有段内文本时由组件直接渲染文本
  if (seg.ref === 'answer') return '正文见下方回答';
  return null;
}

/**
 * kind → 中文类别名。**只在服务端没给 title 时用**：兜底只说"这是什么类别"，
 * 不编造具体动作——"调用了 1 个工具"这种话必须由服务端给，前端猜出来的就是伪造。
 */
const KIND_LABEL: Record<string, string> = {
  'tool-round': '工具往返',
  'skill-reload': '技能加载',
  finalize: '整理最终回答',
  answer: '最终回答',
  cancelled: '被中断的一段',
};

/**
 * @description 段标题：优先服务端的 title，缺失时按 kind 兜底
 * @param {ChatSegment} seg 段
 * @returns {String} 标题
 */
export function segmentTitle(seg: ChatSegment): string {
  if (seg?.title) return seg.title;
  return KIND_LABEL[seg?.kind as string] || '执行过程';
}

/**
 * @description 段 → 时间线条目的视图数据（纯数据，不含 JSX）
 * @param {ChatSegment} seg 段
 * @returns {{key: String, title: String, description: String|null, status: String, collapsible: Boolean, bodyKind: String, body: String|null}} 条目
 *
 * 为什么把这段映射抽出来（它本该由渲染测试覆盖）：这仓**跑不了引入 `@ant-design/x` 的组件测试**——
 * 它的依赖链上有 `refractor@5`、`mermaid@11` 等 ESM-only 包，而 jest 用的那条 babel 链是
 * `@babel/core@7.4.5`，转换它们会报 `Requires Babel "^7.22.0"`，不转换则报
 * `Cannot use import statement outside a module`（两个方向都实测过）。逐个打桩等于手工再造一个模块图，
 * 那不是验证。⇒ 判断留在这里、可穷举测；组件只负责把字段交给 ThoughtChain。
 */
export function segmentTimelineView(seg: ChatSegment): {
  key: string;
  title: string;
  description: string | null;
  status: 'loading' | 'error' | 'success';
  collapsible: boolean;
  bodyKind: 'text' | 'hint' | 'none';
  body: string | null;
} {
  const metric = segmentMetricsText(seg);
  const openText = seg.open ? '进行中' : '';
  const description = [metric, openText].filter(Boolean).join(' · ') || null;
  /** `cancelled` 是"被打断的一段"，不能标成 success：那是把中断粉饰成收尾 */
  const status: 'loading' | 'error' | 'success' = seg.open
    ? 'loading'
    : seg.kind === 'cancelled'
    ? 'error'
    : 'success';
  const hint = segmentBodyHint(seg);
  return {
    key: `seg-${seg.seq}`,
    title: segmentTitle(seg),
    description,
    status,
    collapsible: Boolean(seg.text),
    bodyKind: seg.text ? 'text' : hint ? 'hint' : 'none',
    body: seg.text ? seg.text : hint,
  };
}

/** 空正文轮次的说明 */
export type EmptyRoundNotice = {
  /** 语气：warning=有损失，info=中性说明 */
  tone: 'warning' | 'info';
  text: string;
  /** 分类标签，写日志/埋点用，便于日后统计到底是哪类多 */
  reason: 'has-segments' | 'abandoned' | 'no-content';
};

/**
 * @description `lostChars` 的可说部分：**只有正数才是事实**
 * @param {any} lostChars 视图字段
 * @returns {String} 空串表示"不要引用字数"
 */
export function lostCharsText(lostChars: any): string {
  if (typeof lostChars !== 'number' || !Number.isFinite(lostChars) || lostChars <= 0) return '';
  return `约 ${lostChars} 字未能保存`;
}

/**
 * @description 一轮没有正文时，该对用户说什么
 * @param {Object} p 参数
 * @param {String} p.content 已渲染的正文（可能来自流式累积）
 * @param {ChatSegment[]} p.segments 段列表（流式或历史回填）
 * @param {String} [p.error] 视图 `error` 字段
 * @param {Object} [p.process] 视图 `process` 字段
 * @param {String} [p.streamState] 流状态
 * @returns {EmptyRoundNotice | null} 有正文时返回 null（不需要说明）
 *
 * 三类各有不同说法，依据是 dev 实测的分布（15 条空 answer = 3 有段 + 9 被回填 + 3 确实空）：
 * **把空正文一律写成"内容不完整"是不诚实的**——第 3 类根本没产出任何内容，
 * 而第 2 类的损失在服务端是有记录的（中断原因 + 是否回填）。
 */
export function deriveEmptyRoundNotice(p: {
  content?: string;
  segments?: ChatSegment[];
  error?: string;
  process?: any;
  streamState?: string;
}): EmptyRoundNotice | null {
  const text = (p?.content || '').trim();
  if (text) return null;
  const segs = p?.segments || [];
  const proc = p?.process || {};
  const err = String(p?.error || '');
  const abandoned = err.startsWith('abandoned:') || proc.interruptedBy === 'process-lost';
  if (abandoned) {
    const chars = lostCharsText(proc.lostChars);
    return {
      tone: 'warning',
      reason: 'abandoned',
      text: `本轮因服务重启中断${chars ? `，${chars}` : '，未产出可保存的正文'}`,
    };
  }
  if (segs.length) {
    /** 有段可回放：正文确实空，但过程不是空的（段里有 cancelled 的半句、工具往返） */
    return {
      tone: 'info',
      reason: 'has-segments',
      text: '本轮已中断，下面是当时的执行过程' + (p.streamState === 'aborted' ? '' : ''),
    };
  }
  const noUsage = proc.usage && proc.usage.hasUsage === false;
  if (noUsage) {
    return { tone: 'info', reason: 'no-content', text: '本轮在模型开始输出前已被取消' };
  }
  /** 兜底：说"未产出内容"而不是"内容不完整"——我们没有证据说它本来会有内容 */
  return { tone: 'info', reason: 'no-content', text: '本轮未产出回答内容' };
}

/**
 * @description 上游模型调用次数要不要说、怎么说（审计 P1 里唯一仍然值得做的一条，且已收窄）
 * @param {any} process 视图的 `process` 字段
 * @returns {String} 一行说明；**空串表示不说**
 *
 * 为什么默认不说：`modelCalls` 与 `iterationCount` 相等时，这一句只是把"模型往返 N 轮"
 * 换个说法再讲一遍——**重复信息不是信息**。dev 实测 46 条有工具调用的档案里
 * 两者绝大多数相等，所以它只在不等时才有价值（重试、换档、无工具收尾补落都会让
 * 上游调用数多于面板轮次）。
 *
 * 三种"不说"是分开的，不要混成一个：
 * - 没有用量记录（`hasUsage:false` 或 `modelCalls` 非有限数）⇒ 我们不知道，**不许编**；
 * - 没有 `iterationCount` ⇒ 没有可比较的分母，单独报一个调用数容易被读成"轮次数"；
 * - 两者相等 ⇒ 说它是重复。
 *
 * 措辞只报数，不报原因：`6 != 5` 可能是重试也可能是补落，界面没资格替服务端选一个。
 */
export function modelCallNote(process: any): string {
  const iter = Number(process?.iterationCount);
  const usage = process?.usage;
  const calls = Number(usage?.modelCalls);
  if (!Number.isFinite(calls) || calls <= 0) return '';
  if (usage?.hasUsage === false) return '';
  if (!Number.isFinite(iter) || iter <= 0) return '';
  if (calls === iter) return '';
  return `上游模型实际调用 ${calls} 次`;
}

/**
 * @description 这句"上游实际调用次数"该挂在哪儿（B2 的**位置**判据，与 `modelCallNote` 的**内容**判据分开）
 * @param {any} process 视图的 `process` 字段
 * @param {Number} toolCallCount 本轮工具调用条数
 * @returns {String} 'tools' = 挂在工具条目上；'standalone' = 自己单列一条；'' = 不显示
 *
 * 为什么必须有这条判据：2026-11-12 的现网点验发现 B2 上线后**对它自己的动机人群一个字都没说**——
 * 那句话当时只挂在"调用工具 N 次"这个条目里，而触发它的重试场景恰恰通常没有工具调用
 * （dev 那 3 行 `modelCalls=3 / iterationCount=1` 全是零工具轮）。
 * 内容判据是对的，**接线把它 gate 在了一个不相干的条件上**。
 *
 * 两种挂法不能同时出：有工具时挂在工具条目里（同一行讲完"几轮 + 实际几次"），
 * 没工具时单列一条；否则要么重复、要么干脆没有。
 */
export function modelCallPlacement(process: any, toolCallCount: number): string {
  if (!modelCallNote(process)) return '';
  return Number(toolCallCount) > 0 ? 'tools' : 'standalone';
}

/**
 * @description 工具**入参**该怎么说（PR-H H1/H2 的判据都在这里，不在组件里）
 * @param {any} call 工具调用记录（流式累积或历史 `process.toolCalls[]` 的形状）
 * @returns {{recorded: boolean, preview: string, note: string}} recorded=服务端有没有记这个维度
 *
 * 三件事必须分开，混了就是撒谎：
 * - `args`/`argsChars` 两个键**都缺失** ⇒ H1 之前写入的存量行，"没记录"不等于"没传参"；
 * - `argsChars === 0` ⇒ 确实传了空入参（这是事实，可以说"无入参"）；
 * - `argsTruncated` ⇒ 服务端按 `limits.toolArgsChars` 截过，`argsChars` 才是原文真实长度。
 *   所以这里引用字数只用 `argsChars`，**不用**到手正文的长度（面板自己的 `truncate` 又会再截一次，
 *   两个数都叫"共 N 字"的话用户分不清是谁截的）。
 */
export function toolArgsView(call: any): { recorded: boolean; preview: string; note: string } {
  if (!call || typeof call !== 'object')
    return { recorded: false, preview: '', note: '入参未记录' };
  const chars =
    typeof call.argsChars === 'number' && Number.isFinite(call.argsChars) ? call.argsChars : null;
  const hasBody = typeof call.args === 'string';
  if (!hasBody && chars === null) {
    /** 存量行：这个维度当时根本没落库 */
    return { recorded: false, preview: '', note: '入参未记录' };
  }
  const body = hasBody ? (call.args as string) : '';
  if (!body && chars === 0) return { recorded: true, preview: '', note: '无入参' };
  const preview = body.length > 160 ? `${body.slice(0, 160)}…` : body;
  const note = call.argsTruncated ? `${chars} 字，服务端留存前 ${body.length} 字` : '';
  return { recorded: true, preview, note };
}

/**
 * @description 整段丢弃该怎么说：`segmentSummary.dropped` 是服务端给的，此前四端都没渲染
 * @param {any} summary 视图的 `process.segmentSummary`
 * @returns {String} 空串表示"没有丢过段"（这时什么都不该说，别造一句"过程完整"）
 *
 * `dropped.count > 0` 而 `chars` 缺失/为 0 时只说段数：字数不明就说"约 0 字"是假话，
 * 与 `lostChars` 那条同一口径。
 */
export function droppedSegmentsText(summary: any): string {
  const d = summary?.dropped;
  const count = typeof d?.count === 'number' ? d.count : 0;
  if (!(count > 0)) return '';
  const chars = typeof d?.chars === 'number' && d.chars > 0 ? d.chars : null;
  return chars === null
    ? `另有 ${count} 段过程内容未留存`
    : `另有 ${count} 段过程内容未留存（约 ${chars} 字）`;
}

/** 一条工具结果的"片段声明"读数 */
export type ToolResultScope = {
  /** 服务端有没有量级（`process.toolResults` 里没有对应 ref 时为 false） */
  known: boolean;
  /** 给用户看的一句话；空串表示"这里没有需要声明的缺口" */
  text: string;
  /** 全文是否真在库里（决定将来能不能给"展开"）；`stored` 缺键时是 null=不知道 */
  archived: boolean | null;
};

/**
 * @description 判断一条工具结果是全文还是片段（PR-H H2b）
 * @param {any} call 一条 `process.toolCalls[]`（或流式累积的同形状）
 * @param {any[]} [toolResults] 视图的 `process.toolResults`（量级摘要，无正文）。
 *   可选：面板传的是 `process?.toolResults`，类型上是 `T[] | undefined`，
 *   函数体内已有 `Array.isArray` 守卫 ⇒ 这里**必须在签名上接住 undefined**，
 *   否则调用方要么被迫 `|| []`（多一处兜底），要么写 `as any`（把类型检查关掉）——
 *   四种端各兜一次，就变成四份"怎么绕过这个签名"的写法。
 * @returns {ToolResultScope} 读数
 *
 * 为什么需要这个函数：`result` 是预览（预算 `limits.toolResultTraceChars`，默认 4000），
 * 面板自己还会再截一次显示。用户在界面上看到的长度**从来不是**这条结果的实际长度，
 * 而此前界面对这件事一个字都不说——"看起来只有这么多"与"被截到只剩这么多"在屏幕上完全同形。
 *
 * 三条不撒谎的规矩：
 * 1. 没截就不说。`chars <= 到手正文长度` ⇒ 全文已经在手上，不造一句"完整"（那是没依据的断言）；
 * 2. 只声明**读得到的数**：原文字数取 `chars`（服务端量），显示字数取到手 `result` 的长度（本地量），
 *    两个数各自注明来源，不混成一个"共 N 字"；
 * 3. `stored` 缺键 ⇒ `archived:null`，文案说"留存情况未记录"，**不默认成"留住了"**，
 *    也不提前承诺任何"展开/取回"动作——取回入口是下一步的事，界面不能先说有。
 */
export function toolResultScopeNote(call: any, toolResults?: any[]): ToolResultScope {
  const held = typeof call?.result === 'string' ? call.result : '';
  const clipped = /\[truncated\]$/.test(held);
  const entry = Array.isArray(toolResults)
    ? toolResults.find((t: any) => t && (t.ref === call?.id || t.ref === call?.toolCallId))
    : undefined;
  if (!entry) {
    if (!clipped) {
      /** 没有量级条目且正文没截断标记：这条本来就没被裁，没什么可声明 */
      return { known: false, text: '', archived: null };
    }
    /** 截过却没有量级：如实承认两边对不上，而不是安静地把预览当全文 */
    return { known: false, text: '内容较长，此处仅为片段；服务端未记录全文量级', archived: null };
  }
  const chars =
    typeof entry.chars === 'number' && Number.isFinite(entry.chars) ? entry.chars : null;
  const archived = typeof entry.stored === 'boolean' ? entry.stored : null;
  if (chars === null) {
    return { known: true, text: '此处为片段，全文字数未记录', archived };
  }
  if (chars <= held.length) {
    return { known: true, text: '', archived };
  }
  const head = `这条结果共 ${chars} 字，此处显示 ${held.length} 字`;
  if (archived === false) {
    return { known: true, text: head + '；全文超出留档上限，尾部未留存', archived };
  }
  if (archived === null) {
    return { known: true, text: head + '；全文留存情况未记录', archived };
  }
  return { known: true, text: head, archived };
}
/**
 * @description 把"实时累积的 toolCalls"与"历史视图的 process.toolCalls"合成面板要的那一份
 * @param {any} live provider 在本轮里累积的数组（流式路径）
 * @param {any} proc 视图的 `process`（历史路径）
 * @returns {any[]} 每条保留服务端给的**全部字段**，只补 `status`
 *
 * 为什么需要它（真实缺陷，不是重构癖）：四端面板原先写的是
 * `toolCalls?.length ? toolCalls : process.toolCalls.map(t => ({id, name, status}))`，
 * 兜底分支只挑三个字段 ⇒ 历史行的 `result`/`args`/`argsChars`/`argsTruncated` 被丢掉。
 * 后果不是报错而是**说反话**：有返回内容却显示"（无返回内容）"，记了入参却只能说"未记录"。
 * `status` 缺省补 'done'；**已有的 status 不覆盖**，否则 pending 被洗成完成。
 */
export function resolveToolCalls(live: any, proc: any): any[] {
  const fromLive = Array.isArray(live) && live.length ? live : null;
  const fromProc = Array.isArray(proc?.toolCalls) ? proc.toolCalls : [];
  return (fromLive || fromProc).map((t: any) => {
    const one = {...t};
    if (!one.status) one.status = 'done';
    return one;
  });
}
