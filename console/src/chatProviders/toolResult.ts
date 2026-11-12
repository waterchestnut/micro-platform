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
};

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
  /** 只复用成功过的（complete/partial）；failed 与 stopped 不缓存，否则一次抖动或一次主动停止会被永久记住 */
  if (cached && (cached.outcome === 'complete' || cached.outcome === 'partial')) {
    return {...cached, pages: 0};
  }
  let offset = 0;
  let text = '';
  let pages = 0;
  let remaining = 0;
  let stored: boolean | null = null;
  let availableChars: number | null = null;
  const base: ToolResultRun = {
    outcome: 'failed',
    text: '',
    pages: 0,
    remaining: 0,
    error: '',
    stored: null,
    availableChars: null,
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
        error: page.truncatedMore ? 'no-progress' : 'empty',
      };
    }
    text += page.content;
    /** 游标以服务端给的 end 为准：自己算 `offset + content.length` 会在多字节/换行处理差异上走偏 */
    offset = Number(page.end) > offset ? Number(page.end) : offset + page.content.length;
    if (!page.truncatedMore) {
      const doneCOMPLETE = {...base, outcome: 'complete' as const, text, pages, remaining: 0, error: '', stored, availableChars};
TOOL_RESULT_CACHE.set(cacheKey, doneCOMPLETE);
return doneCOMPLETE;
    }
  }
  const donePARTIAL = {...base, outcome: 'partial' as const, text, pages, remaining: remaining, error: 'max-pages', stored, availableChars};
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
