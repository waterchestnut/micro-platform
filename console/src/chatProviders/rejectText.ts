/**
 * @fileOverview 服务端"结构化拒绝"的文案判据（零依赖纯函数）
 * @module chatProviders/rejectText
 * @description
 * 2026-11-13 实测出来的缺口：服务端拒绝（并发闸 4290、同会话重复 4291）走的是
 * `HTTP 200 + success:false + message + code`，SDK 的 `jsonResponseHandler` 把它交给
 * `onError(new Error(chunk.message), chunk, headers)`，于是 `requestFallback` 的
 * `info.errorInfo` 里**就躺着那句人话**。但五端当时都写成固定文案
 * `请求失败，请稍后重试!`——用户看到的是"系统坏了"，而事实是"你上一条还在收尾"。
 * 更糟的是这掩盖了 P5 想解决的那件事：拒绝本身是对的，说出来才是有用的。
 *
 * 为什么判据长这样（每条都是刻意选择，不是防御性堆砌）：
 * 1. **只认结构化拒绝体**（`success === false` 严格等号）。不用 `!success`：
 *    `undefined`/缺字段是"我们不知道"，不能当成"服务端说了话"。
 * 2. **不读 `error.message`**。传输失败时它是 `Failed to fetch` 之类的技术串，
 *    把它当业务文案念给用户比"请稍后重试"更差；拒绝体里有 `success:false` 这个凭据才说明
 *    这句话是服务端**有意写给用户看的**。
 * 3. **不区分 4290/4291**。两者都是"这轮没开始"的正当理由，都该念出来；
 *    真要按码分支，那是界面下一步的事，不是这里吞掉文案的理由。
 * 4. **长度上限**。这句话本该是短句；超长的 `message` 更可能是堆栈、HTML 或上游原文，
 *    那种内容出现在气泡里就是新的信息泄漏面，所以宁可不念。
 */

/** 超过这个长度就不认为是"给人看的一句话" */
export const REJECT_TEXT_MAX_CHARS = 200;

/**
 * @description 从拒绝体里取出可以直接展示的一句话
 * @param {any} errorInfo SDK 传给 `requestFallback` 的 `info.errorInfo`（我们的拒绝体，或别的东西）
 * @returns {String} 可展示的文案；**空串表示"没有可信的服务端文案"**，调用方保留原有通用文案
 */
export function structuredRejectText(errorInfo: any): string {
  if (!errorInfo || typeof errorInfo !== 'object' || Array.isArray(errorInfo)) return '';
  if (errorInfo.success !== false) return '';
  const pick = (v: any): string => {
    if (typeof v !== 'string') return '';
    const text = v.trim();
    if (!text || text.length > REJECT_TEXT_MAX_CHARS) return '';
    return text;
  };
  /**
   * `message` 优先，`msg` 只作回退：母本的拒绝体同时给两份（`message` 给 x-sdk 的错误通道、
   * `msg` 给本项目 retSchema 口径），正常时它们同值。
   * 留回退的理由很具体——**万一哪天只写了 `msg`，界面会悄悄退回"请求失败"，
   * 而这正是这次要修的那个症状**，靠人回忆字段名是防不住的。
   * 两者都在但内容不一致时取 `message`：那是 SDK 真正拿去 `new Error(...)` 的那一份，
   * 与 `error.message` 保持一致才不会同一屏出现两句话。
   */
  return pick(errorInfo.message) || pick(errorInfo.msg);
}

/**
 * 请求中占位气泡的文案（`requestPlaceholder` 与终止态判定共用同一个来源）。
 *
 * 为什么它要出现在判据模块里而不是只写在页面里：2026-11-13 在 dev 与 cw2pc 都实测到——
 * 一轮被 4291 拒掉之后，气泡**头部念出了拒绝原因**，**正文却仍然是这句"正在处理，请稍后。。。"**，
 * 而且等 6 秒再读还是它在。用户看到的是一句永远不结束的假状态。
 * 根因不是文案，是 `requestFallback` 返回 `{...messageInfo.message}` 时把占位内容原样带进了终止态。
 * 所以这里把"终止态不许保留加载占位"做成一条能测的判据，页面只负责用它。
 */
export const LOADING_PLACEHOLDER_TEXT = '正在处理，请稍后。。。';

/**
 * @description 终止态下剥掉加载占位文案，其他内容原样保留
 * @param {any} content 气泡当前正文（可能是占位、可能是半截正文、可能没有）
 * @param {String} [placeholder] 占位文案；传空串表示"这一端没有占位机制"，此时一律原样返回
 * @returns {String} 该显示的正文；空串表示什么都不显示
 *
 * 判据刻意用**全等**而不是 `includes`/前缀匹配：
 * 半截真正文（占位句后面还有内容）不是占位，把它清空就是**销毁已有信息**——
 * 那比留着假状态更坏。宁可留着，也不要造出"内容凭空消失"。
 */
export function dropLoadingPlaceholder(content: any, placeholder: string = LOADING_PLACEHOLDER_TEXT): string {
  if (typeof content !== 'string') return '';
  if (!placeholder) return content;
  return content === placeholder ? '' : content;
}

export default {structuredRejectText, REJECT_TEXT_MAX_CHARS, LOADING_PLACEHOLDER_TEXT, dropLoadingPlaceholder};
