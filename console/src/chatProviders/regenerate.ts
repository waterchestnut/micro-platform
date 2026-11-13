/**
 * 「重新生成」的界面判据（P3 最小安全版）
 *
 * 为什么这里也要一个纯模块：按钮该不该出现、点之前该说什么，
 * 都是**能被穷举测的事实判断**，不该散在 JSX 的条件里靠肉眼点。
 *
 * 三条口径：
 * 1. **只对最后一条回答开放**。中间某轮重跑会改变后续所有轮的上下文，
 *    那是"会话分叉"，属于另一个产品决定，不在最小安全版里。
 * 2. **正在生成时不给**。此时重发就是并发第二轮，撞上的正是 P5 那条闸。
 * 3. **确认文案只说可核对的事实**：会再发起一次模型调用、会产生费用、
 *    旧回答保留、新回答另起一条。不编"预计多少 token"这种我算不出来的数。
 */

export type RegenerateTarget = {
  ok: boolean;
  reason: string;
  query?: string;
  messageCode?: string;
  attachments?: any[];
};

/**
 * @description 把消息正文取成纯文本
 * @param {any} content 字符串、分段数组或其它
 * @returns {String} 结果
 *
 * 必须是两种都认：**实时发送**时用户消息的 content 是字符串，
 * 而**历史载入**时它是 `[{type:'text', text:…}]` 这样的分段数组（Chat/index.tsx 的
 * `queryContent`）。第一版只认字符串，于是刷新页面后按钮一律显示"找不到原始问题"——
 * 这个缺陷是 2026-11-13 在 dev 界面上点出来的，单测当时全绿（因为用例只喂了字符串）。
 */
export function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') return String(p.text ?? p.content ?? '');
      return '';
    }).join('');
  }
  return '';
}

/**
 * @description 这一条会话能不能、该对哪一条重新生成
 * @param {any[]} messages useXChat 的消息列表
 * @param {Object} [opts] 选项
 * @param {Boolean} [opts.requesting] 是否正在请求中
 * @returns {RegenerateTarget} 结果，`ok:false` 时 `reason` 必须能说明为什么不给
 */
export function regenerateTarget(messages: any[], opts: {requesting?: boolean} = {}): RegenerateTarget {
  if (opts.requesting) return {ok: false, reason: 'requesting'};
  if (!Array.isArray(messages) || messages.length === 0) return {ok: false, reason: 'no-messages'};
  const last = messages[messages.length - 1];
  const msg = last?.message || {};
  /** 只有 AI 侧的成品回答才谈得上"重新生成" */
  if (msg.role !== 'ai') return {ok: false, reason: 'last-not-answer'};
  /** 空回答（还在 loading、或失败留白）：重跑没有"旧答案"可替换，说清楚而不是给个哑按钮 */
  if (!textOf(msg.content).trim()) return {ok: false, reason: 'empty-answer'};
  const messageCode = msg.messageCode || last?.extraInfo?.messageCode;
  if (typeof messageCode !== 'string' || !messageCode) return {ok: false, reason: 'no-message-code'};
  /** 往回找最近一条用户提问：重跑必须复用同一个问题，不能让用户重写一遍 */
  let query = '';
  let attachments: any[] = [];
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const m = messages[i]?.message || {};
    if (m.role === 'my' || m.role === 'user') {
      query = textOf(m.content);
      attachments = Array.isArray(m.attachments) ? m.attachments : [];
      break;
    }
  }
  if (!query.trim()) return {ok: false, reason: 'no-question'};
  return {ok: true, reason: 'ok', query, messageCode, attachments};
}

/**
 * @description 点按钮之前要告诉用户的话
 * @param {RegenerateTarget} target `regenerateTarget` 的结果
 * @returns {String} 确认文案；`ok:false` 时返回空串（不给哑按钮配话）
 *
 * 句子结构是刻意的：**先说花钱**，再说旧答案不会消失，最后说新答案另起一条。
 * 顺序反了会让人以为"重新生成"是把原答案改掉——那是引用场景下的误会。
 */
export function regenerateConfirmText(target: RegenerateTarget): string {
  if (!target || target.ok !== true) return '';
  return '重新生成会再发起一次模型调用，并产生相应费用。'
    + '当前这条回答不会被删除或修改，新的回答会作为新的一轮出现在下方。';
}

/**
 * @description 按钮上该写什么（失败原因不藏进 tooltip，直接写在禁用态里）
 * @param {RegenerateTarget} target 判定结果
 * @returns {String} 说明文案，可为空
 */
export function regenerateBlockedText(target: RegenerateTarget): string {
  if (!target || target.ok) return '';
  switch (target.reason) {
    case 'requesting':
      return '正在回答中，先等这一轮结束';
    case 'empty-answer':
      return '这一轮没有可替换的成品回答';
    case 'last-not-answer':
      return '只能对最后一条回答重新生成';
    case 'no-message-code':
      return '这一轮没有可核对的消息标识，不能声明替换的是哪条';
    case 'no-question':
      return '找不到原始问题，无法原样重跑';
    default:
      return '当前不能重新生成';
  }
}
