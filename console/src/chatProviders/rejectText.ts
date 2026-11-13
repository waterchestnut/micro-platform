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

export default {structuredRejectText, REJECT_TEXT_MAX_CHARS};
