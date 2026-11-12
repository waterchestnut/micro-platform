/**
 * @fileOverview `/core/message/tool-result` 的取回客户端（IO 层，判据在 `@/chatProviders/toolResult`）
 * @module services/llm/toolResultClient
 * @description
 * 与 `resumeStream.ts` 同一套规矩：**凭据由调用方注入**，这里不 import `@/utils/authority`
 * （那条链会牵进 ESM-only 的 `uuid@13`，本仓 jest 配置下转换不了；把 IO 与判据分开，
 * 才既能让分页循环被穷举测覆盖，又不至于让鉴权写法长出第二份）。
 *
 * 一件必须做对的事：**HTTP 200 不等于取到了正文**。本仓的回复包装是 `{code,msg,data}`，
 * 拒绝路径（401/403/404）在这里都是非 0 的 `code`，而 404 那句话正是界面要显示给用户的
 * "最常见原因是这条根本没被裁剪过"。所以非 0 一律 throw，让上层的 `failed` 出口把原因带出来；
 * 如果这里"宽容地"返回空页，用户看到的就是一个点了没反应的按钮。
 */
import type { ToolResultPage } from '@/chatProviders/toolResult';

/** 服务端回复包装 */
type Envelope = { code?: number; msg?: string; data?: Partial<ToolResultPage> };

/**
 * @description 取一页留档正文
 * @param {Object} opts 参数
 * @param {String} opts.url 端点（`${LLM_API_BASE}/core/message/tool-result`）
 * @param {String} opts.messageCode 消息标识
 * @param {String} opts.ref 留档标识
 * @param {Number} opts.offset 起始字符
 * @param {Number} opts.limit 本次字符数
 * @param {Object} opts.headers 鉴权头，**由调用方注入**
 * @param {AbortSignal} [opts.signal] 取消信号
 * @returns {Promise<ToolResultPage>} 一页
 * @throws {Error} HTTP 失败、包装 code 非 0、或 data 形状不对
 */
export async function openToolResultPage(opts: {
  url: string;
  messageCode: string;
  ref: string;
  offset: number;
  limit: number;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<ToolResultPage> {
  const resp = await fetch(opts.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: JSON.stringify({
      messageCode: opts.messageCode,
      ref: opts.ref,
      offset: opts.offset,
      limit: opts.limit,
    }),
    signal: opts.signal,
  });
  const env = (await resp.json().catch(() => null)) as Envelope | null;
  if (!resp.ok) {
    /** 404 的 msg 是给用户看的（"找不到该标识的留档内容…"），原样抛上去 */
    throw new Error(env?.msg || `HTTP ${resp.status}`);
  }
  if (env && typeof env.code === 'number' && env.code !== 0) {
    throw new Error(env.msg || `code=${env.code}`);
  }
  const d = env?.data;
  if (!d || typeof d.content !== 'string') {
    throw new Error('响应形状不对：缺少 data.content');
  }
  return {
    content: d.content,
    offset: Number(d.offset) || 0,
    end: Number(d.end) || 0,
    remaining: Number(d.remaining) || 0,
    truncatedMore: !!d.truncatedMore,
    stored: typeof d.stored === 'boolean' ? d.stored : null,
    chars: Number.isFinite(d.chars as number) ? (d.chars as number) : null,
    availableChars: Number.isFinite(d.availableChars as number)
      ? (d.availableChars as number)
      : null,
  };
}

/**
 * @description 造一个"取一页"的函数，把 messageCode 与凭据闭包进去
 * @param {Object} opts 参数
 * @param {String} opts.url 端点
 * @param {String} opts.messageCode 消息标识
 * @param {Object} opts.headers 鉴权头
 * @returns {Function} `(body) => Promise<ToolResultPage>`
 *
 * 面板不该知道 messageCode 从哪来、也不该知道 token 怎么取：
 * 它只拿到一个"能取就给我"的函数。**取不到就不给函数**，按钮也就不出现——
 * 界面不承诺没有入口的动作，这条在 H2b 已经立过。
 */
export function makeToolResultLoader(opts: {
  url: string;
  messageCode: string;
  headers: Record<string, string>;
}) {
  return (body: { ref: string; offset: number; limit: number }) =>
    openToolResultPage({
      url: opts.url,
      messageCode: opts.messageCode,
      ref: body.ref,
      offset: body.offset,
      limit: body.limit,
      headers: opts.headers,
    });
}

export default { openToolResultPage, makeToolResultLoader };
