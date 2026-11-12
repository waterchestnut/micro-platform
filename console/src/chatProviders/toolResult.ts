/**
 * @fileOverview 工具结果全文取回的判据与分页循环（纯逻辑，不依赖 React / SDK / fetch）
 * @module chatProviders/toolResult
 * @description
 * H3 把正文放进了只读路由，H2b 让界面承认"这是片段"。**这一步才是让用户能看到全文的那一下**，
 * 而它最容易出的三种错都在"什么时候该取、取到什么算完"上：
 *
 * 1. **没必要却去取**：全文本来就在 `result` 里（`chars <= 到手长度`），点了等于白打一次接口；
 * 2. **知道取不全却不吭声**：`stored:false` 时尾部**在哪儿都不存在**（超出 `limits.overflowStoreChars`），
 *    取回来的只是一段更长的片段。界面如果照常显示"展开全文"而不说这件事，用户会以为看到的是全文——
 *    这与 H2b 反对的是同一件事，只是换了个位置；
 * 3. **翻页不停或假装取完**：`truncatedMore:true` 但正文为空（服务端 bug 或旧数据）时必须**中止**，
 *    否则会无限请求；页数上限到了还没完必须标 `partial`，不能把"取了一部分"报成"取完了"。
 *
 * 所以这里的每个出口都有对应用例，`runToolResultFetch` 的 `load` 由调用方注入
 * （真实实现是 fetch；测试里是假数据），**模块本身零 import**，与 `segments.ts` 同口径。
 */

/** 一页取多少字符：与 llm.api `OVERFLOW_DEFAULT_LIMIT` 同值，改一边不改另一边就会出现"前端以为 4000、后端给 20000" */
export const PAGE_SIZE = 4000;

/** 最多翻几页：10 页 = 4 万字。取这个数的理由是"一屏 <pre> 能读完的量"，不是协议限制 */
export const MAX_PAGES = 10;

/** 取回一页的形状（与 llm.api `/core/message/tool-result` 的 data 对齐） */
export type ToolResultPage = {
  content: string;
  offset: number;
  end: number;
  remaining: number;
  truncatedMore: boolean;
  stored?: boolean | null;
  chars?: number | null;
  availableChars?: number | null;
};

/** 该不该给"取回全文"这个动作 */
export type ToolResultIntent = {
  /** 允许动作 */
  ok: boolean;
  /** 分类，供文案与埋点使用 */
  reason: 'ok' | 'no-magnitude' | 'already-full' | 'tail-lost' | 'retention-unknown';
  /** 动作旁该说的话；空串表示不需要额外声明 */
  note: string;
};

/**
 * @description 判断某条工具结果能否/该不该取回全文
 * @param {any} call 一条工具调用（`result` 是预览正文）
 * @param {any[]} toolResults 视图的 `process.toolResults`
 * @returns {ToolResultIntent} 意图
 *
 * `no-magnitude`（有截断标记但没有量级条目）刻意**不给动作**：
 * 我们连"原文多长"都不知道，取回能不能成功也不知道，那就先别承诺。
 */
/**
 * 取回结果的模块级缓存（**必须在函数体外**：放函数里就是每次调用新建，等于没有缓存）。
 * 键 = `messageCode|ref`；面板传不出 messageCode（页面把它闭包在 loader 里），
 * 于是实际常退化成 `|ref`。ref 是服务端生成的 tool_call_id，全局唯一，够用——
 * 但这是接线限制带来的妥协，写出来，不粉饰成设计。
 */
const TOOL_RESULT_CACHE = new Map<string, ToolResultRun>();

/**
 * @description 清空缓存（测试用，也留出"强制重新取一次"的口子）
 * @returns {void}
 */
export function clearToolResultCache(): void {
  TOOL_RESULT_CACHE.clear();
}

export function toolResultIntent(call: any, toolResults?: any[]): ToolResultIntent {
  const held = typeof call?.result === 'string' ? call.result : '';
  const clipped = /\[truncated\]$/.test(held);
  const entry = Array.isArray(toolResults)
    ? toolResults.find((t: any) => t && (t.ref === call?.id || t.ref === call?.toolCallId))
    : undefined;
  if (!entry) {
    return clipped
      ? { ok: false, reason: 'no-magnitude', note: '全文量级未记录，暂不提供取回' }
      : { ok: false, reason: 'already-full', note: '' };
  }
  const chars =
    typeof entry.chars === 'number' && Number.isFinite(entry.chars) ? entry.chars : null;
  if (chars !== null && chars <= held.length) {
    /** 全文已经在手上：不请求，也不说一句多余的话 */
    return { ok: false, reason: 'already-full', note: '' };
  }
  if (entry.stored === false) {
    return {
      ok: true,
      reason: 'tail-lost',
      note: '全文超出服务端留档上限，尾部未留存：取回的内容仍可能不完整',
    };
  }
  if (entry.stored !== true) {
    return {
      ok: true,
      reason: 'retention-unknown',
      note: '这条结果的留档情况未记录，取回可能失败',
    };
  }
  return { ok: true, reason: 'ok', note: '' };
}

/**
 * 面板一次显示多少字符。**五端共享这一个常量**：原先每端各自写着 `RESULT_PREVIEW = 600`，
 * 于是"取回全文"这件事在界面侧被二次截断、而截断值没有任何一处是权威的
 * （2026-11-12 审计的 P0：结论句说 73,214 字，屏幕上只有 612 字符）。
 */
export const PREVIEW_CHARS = 600;

/** 全文视图的动作（展开 / 收起） */
export type ToolResultViewAction = {show: boolean; label: string};

/** 全文视图的结果 */
export type ToolResultDisplay = {
  /** 现在该渲染的文本（已按需截断并带标记） */
  text: string;
  /** 手上正文的**真实**字符数（不是美化后的长度） */
  sourceChars: number;
  /** 实际显示出来的原文字符数 */
  shownChars: number;
  /** 是否仍在截断状态 */
  truncated: boolean;
  /** 该说的一句量级说明；空串表示不用说 */
  note: string;
  /** 展开/收起入口 */
  expand: ToolResultViewAction;
};

/**
 * @description 把 JSON 文本美化，失败原样返回（纯函数，不抛）
 * @param {String} raw 原文
 * @returns {String} 结果
 */
export function prettyToolResultText(raw: string): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (e) {
    return raw;
  }
}

/**
 * @description 决定工具结果正文怎么显示、还剩多少、给不给展开入口
 * @param {Object} p 参数
 * @param {String} [p.held] 服务端给的预览（`process.toolCalls[].result`）
 * @param {String} [p.fetched] 已经取回/缓存住的正文（比 held 长时以它为准）
 * @param {Boolean} [p.expanded] 用户是否已选择展开
 * @param {Number} [p.previewChars] 覆盖默认预算（测试与特殊布局用）
 * @returns {ToolResultDisplay} 显示结果
 *
 * 三件事必须在这里定，不让组件自己拼：
 * 1. **数字用原文长度，不用美化后的长度**。原先组件先 `JSON.stringify(..., null, 2)` 再数长度，
 *    于是"共 73340 字"与真实 73,214 字差了 126 个美化空白——界面报了一个不存在的字数。
 * 2. 显示与"还有多少没显示"必须同时给，否则"取回全文"变成"取回后仍然看不全"（审计 P0）。
 * 3. 展开入口由这里给，**界面不承诺没有入口的动作**（H2b 那条纪律在这继续适用）。
 */
export function toolResultDisplay(p: {
  held?: string;
  fetched?: string;
  expanded?: boolean;
  previewChars?: number;
} = {}): ToolResultDisplay {
  const fetchedText = typeof p.fetched === 'string' ? p.fetched : '';
  const heldText = typeof p.held === 'string' ? p.held : '';
  /** 取回过的以取回为准；没取回过用服务端预览 */
  const source = fetchedText.length >= heldText.length ? fetchedText : heldText;
  const cap = Number(p.previewChars) > 0 ? Number(p.previewChars) : PREVIEW_CHARS;
  const expanded = !!p.expanded;
  const needsCut = source.length > cap;
  const shown = expanded || !needsCut ? source : source.slice(0, cap);
  const text = prettyToolResultText(shown);
  const truncated = needsCut && !expanded;
  return {
    text,
    sourceChars: source.length,
    shownChars: shown.length,
    truncated,
    note: truncated ? `已显示前 ${shown.length} 字，共 ${source.length} 字` : '',
    expand: needsCut
      ? {show: true, label: expanded ? '收起' : `展开全部（${source.length} 字）`}
      : {show: false, label: ''},
  };
}

/** 取回的结果出口 */
export type ToolResultOutcome = 'complete' | 'partial' | 'stopped' | 'failed';

/** 取回的返回 */
export type ToolResultRun = {
  outcome: ToolResultOutcome;
  text: string;
  pages: number;
  remaining: number;
  /** 失败/中止的原因（只有 outcome=failed|stopped 时非空） */
  error: string;
  /** 服务端给的留档事实（用来把"取回到的"与"全文"分开说） */
  stored: boolean | null;
  availableChars: number | null;
  /**
   * 下一次该从哪个字符位续取（服务端 `end` 给的权威游标）。
   * 加这个字段的原因是**一句必须兑现的话**：`toolResultRunNote` 对 partial 说"可再次点击继续"，
   * 而没有续取游标时，第二次点击只会命中缓存原样返回——那句话就成了界面承诺不存在的动作。
   */
  nextOffset: number;
};

/** 取回之后下一步该给什么动作 */
export type ToolResultAction = {show: boolean; label: string};

/**
 * @description 由取回结果决定"还要不要给按钮、按钮叫什么"
 * @param {ToolResultRun|null} run 上一次取回结果（null 表示还没点过）
 * @returns {ToolResultAction} 动作
 *
 * 判据与文案放这里而不是放组件里，是因为它和 `toolResultRunNote` 说的是**同一件事的两面**：
 * 话里叫用户再点，这里就必须真给一个能点的入口；话里说取完了，这里就不该留按钮。
 */
export function toolResultNextAction(run: ToolResultRun | null): ToolResultAction {
  if (!run) return {show: true, label: '取回全文'};
  if (run.outcome === 'partial') {
    return {show: true, label: run.remaining > 0 ? `继续取回（还剩 ${run.remaining} 字）` : '继续取回'};
  }
  /** stopped 与 failed 都不进缓存，所以再点是真的再取一次，不是装样子 */
  if (run.outcome === 'stopped') return {show: true, label: '继续取回'};
  if (run.outcome === 'failed') return {show: true, label: '重新取回'};
  return {show: false, label: ''};
}

/**
 * @description 分页取回全文（循环判据全在这里，IO 由 `load` 注入）
 * @param {Object} p 参数
 * @param {Function} p.load `(body) => Promise<ToolResultPage|undefined>`，取一页；抛错即失败
 * @param {String} p.messageCode 会话消息标识
 * @param {String} p.ref 留档标识
 * @param {Number} [p.pageSize] 每页字符数
 * @param {Number} [p.maxPages] 页数上限
 * @param {Function} [p.shouldStop] 每页前检查（组件卸载/用户关闭时要停）
 * @returns {Promise<ToolResultRun>} 结果
 *
 * 终止条件有四个，缺任何一个都会变成"看起来能用的按钮"：
 * - `truncatedMore:false` ⇒ **complete**；
 * - 到 `maxPages` 仍有剩余 ⇒ **partial**（`remaining` 必须带出来，不能报成取完）；
 * - 某页正文为空却还说着 `truncatedMore:true` ⇒ **failed:no-progress**，
 *   这条是唯一能挡住"服务端返回异常导致无限翻页"的闸；
 * - `shouldStop()` ⇒ **stopped**，已取回的部分仍然返回（用户关了弹窗不该把已取到的字丢掉）。
 */
export async function runToolResultFetch(p: {
  load: (body: { messageCode: string; ref: string; offset: number; limit: number }) => Promise<any>;
  messageCode: string;
  ref: string;
  pageSize?: number;
  maxPages?: number;
  shouldStop?: () => boolean;
}): Promise<ToolResultRun> {
  const pageSize = Number(p.pageSize) > 0 ? Number(p.pageSize) : PAGE_SIZE;
  const maxPages = Number(p.maxPages) > 0 ? Number(p.maxPages) : MAX_PAGES;
  const cacheKey = `${p.messageCode || ''}|${p.ref || ''}`;
  const cached = TOOL_RESULT_CACHE.get(cacheKey);
  /**
   * complete ⇒ 复用缓存：全文已经在手上，再点一次就是白打接口（H2d 加缓存就是为了这件事）。
   */
  if (cached && cached.outcome === 'complete') {
    return {...cached, pages: 0};
  }
  /**
   * partial ⇒ **从断点续取，而不是返回缓存**。这是对 H2d 的一处改判：
   * 那版把 partial 也"命中即返回"，于是第二次点击一个新字都不取，
   * 而同一屏上 `toolResultRunNote` 还写着"可再次点击继续"——界面承诺了一个不会发生的动作。
   * 现在 partial 的缓存只剩一个意义：已经取回的那部分正文与它的服务端游标；
   * 续取时既不重放已取页，也不把正文拼两遍。
   */
  const resume = cached && cached.outcome === 'partial' ? cached : null;
  let offset = resume ? resume.nextOffset : 0;
  let text = resume ? resume.text : '';
  let pages = 0;
  let remaining = resume ? resume.remaining : 0;
  let stored: boolean | null = resume ? resume.stored : null;
  let availableChars: number | null = resume ? resume.availableChars : null;
  const base: ToolResultRun = {
    outcome: 'failed',
    text,
    pages,
    remaining,
    error: '',
    stored,
    availableChars,
    nextOffset: offset,
  };
  for (let i = 0; i < maxPages; i++) {
    if (p.shouldStop && p.shouldStop()) {
      return {
        ...base,
        outcome: 'stopped',
        text,
        pages,
        remaining,
        stored,
        availableChars,
        /** 续取游标必须现场取：base 是在循环外建的，沿用它会指到已拼进正文的位置之前 ⇒ 续取会重复拼接 */
        nextOffset: offset,
        error: 'stopped',
      };
    }
    let page: ToolResultPage;
    try {
      page = await p.load({ messageCode: p.messageCode, ref: p.ref, offset, limit: pageSize });
    } catch (e: any) {
      return {
        ...base,
        outcome: 'failed',
        text,
        pages,
        remaining,
        stored,
        availableChars,
        nextOffset: offset,
        error: String((e && e.message) || e || 'load failed'),
      };
    }
    if (!page || typeof page.content !== 'string') {
      return {
        ...base,
        outcome: 'failed',
        text,
        pages,
        remaining,
        stored,
        availableChars,
        nextOffset: offset,
        error: 'bad-response',
      };
    }
    pages++;
    if (typeof page.stored === 'boolean') stored = page.stored;
    if (typeof page.availableChars === 'number') availableChars = page.availableChars;
    remaining = Number(page.remaining) > 0 ? Number(page.remaining) : 0;
    if (!page.content.length) {
      /** 空正文却还说有更多：只能是服务端不对劲，继续翻就是无限循环 */
      return {
        ...base,
        outcome: 'failed',
        text,
        pages,
        remaining,
        stored,
        availableChars,
        nextOffset: offset,
        error: page.truncatedMore ? 'no-progress' : 'empty',
      };
    }
    text += page.content;
    /** 游标以服务端给的 end 为准：自己算 `offset + content.length` 会在多字节/换行处理差异上走偏 */
    offset = Number(page.end) > offset ? Number(page.end) : offset + page.content.length;
    if (!page.truncatedMore) {
      const doneCOMPLETE = {...base, outcome: 'complete' as const, text, pages, remaining: 0, error: '', stored, availableChars, nextOffset: offset};
TOOL_RESULT_CACHE.set(cacheKey, doneCOMPLETE);
return doneCOMPLETE;
    }
  }
  /**
   * partial 的正文是"已取回的累计"（续取时从缓存的 text 起步），`nextOffset` 是服务端的游标；
   * 缓存写回后下一次点击就从这里继续，`toolResultRunNote` 那句"可再次点击继续"从此有对应动作
   * （`toolResultNextAction` 给按钮）。
   */
  const donePARTIAL = {...base, outcome: 'partial' as const, text, pages, remaining: remaining, error: 'max-pages', stored, availableChars, nextOffset: offset};
TOOL_RESULT_CACHE.set(cacheKey, donePARTIAL);
return donePARTIAL;
}

/**
 * @description 取回之后该怎么说（出口不同，话就不同）
 * @param {ToolResultRun} run 取回结果
 * @returns {String} 一行说明；空串表示不必说
 *
 * `partial` 与 `failed` 必须留下字数与原因：**"取了一部分"显示成"完成"就是本轮要消灭的那类谎**。
 */
export function toolResultRunNote(run: ToolResultRun): string {
  if (!run) return '';
  if (run.outcome === 'complete') {
    /**
     * complete 也要说话（现网点验发现的缺陷）：原先返回空串，
     * 而面板还会把正文二次截断显示，用户分不清"取到了"和"点了没反应"。
     * 只报可核对的事实（已取回多少字），不评价内容对不对。
     */
    return run.stored === false
      ? `已取回 ${run.text.length} 字；留档之外的尾部不存在`
      : `已取回 ${run.text.length} 字`;
  }
  if (run.outcome === 'partial') {
    return `已取回 ${run.text.length} 字，还有 ${run.remaining} 字未取回（达到单次翻页上限，可再次点击继续）`;
  }
  if (run.outcome === 'stopped') {
    return run.text.length ? `已停止，取回 ${run.text.length} 字` : '';
  }
  return run.error === 'no-progress'
    ? `取回中断：服务端返回了空正文却仍标记有更多（已取回 ${run.text.length} 字）`
    : `取回失败：${run.error}`;
}
