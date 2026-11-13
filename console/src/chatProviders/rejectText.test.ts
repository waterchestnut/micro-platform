/**
 * @fileOverview `structuredRejectText` 的穷举用例（判据在纯模块，所以这里能量出它的边界）
 * @module test/chatProviders/rejectText
 * @description
 * 这个函数只做一件事：决定"界面上这句是服务端给的，还是我们自己编的"。
 * 它的价值全在**不该念的时候闭嘴**——把堆栈、上游原文或传输层的英文技术串念给用户，
 * 比原来那句通用的"请求失败，请稍后重试"更糟。所以下面每一组都在测闭嘴的边界。
 */

import {structuredRejectText, REJECT_TEXT_MAX_CHARS} from './rejectText';

describe('structuredRejectText：只念服务端有意写给用户看的那句话', () => {
  test('4290 与 4291 的拒绝体都念出原句（这就是这次要修的那件事）', () => {
    expect(
      structuredRejectText({
        success: false,
        name: 'ConcurrencyLimited',
        message: '你有多个问题正在处理中，请等待其中一个完成后再问',
        code: 4290,
        msg: '你有多个问题正在处理中，请等待其中一个完成后再问',
      }),
    ).toBe('你有多个问题正在处理中，请等待其中一个完成后再问');
    expect(
      structuredRejectText({
        success: false,
        name: 'ConcurrencyLimited',
        message: '这个问题上一条还在处理中，请等它结束后再问',
        code: 4291,
        data: {reason: 'same-conversation-duplicate', prevMessageCode: 'MC-1', ageMs: 861},
      }),
    ).toBe('这个问题上一条还在处理中，请等它结束后再问');
  });

  test('success 必须严格等于 false：缺键、true、字符串 "false" 都不算服务端发话', () => {
    expect(structuredRejectText({message: '随便一句话'})).toBe('');
    expect(structuredRejectText({success: true, message: '随便一句话'})).toBe('');
    expect(structuredRejectText({success: 'false', message: '随便一句话'})).toBe('');
    expect(structuredRejectText({success: 0, message: '随便一句话'})).toBe('');
  });

  test('message 缺失 / 空 / 纯空格 / 非字符串 ⇒ 空串（没有可信文案就别编）', () => {
    expect(structuredRejectText({success: false})).toBe('');
    expect(structuredRejectText({success: false, message: ''})).toBe('');
    expect(structuredRejectText({success: false, message: '   \t '})).toBe('');
    expect(structuredRejectText({success: false, message: 4291})).toBe('');
    expect(structuredRejectText({success: false, message: null})).toBe('');
    expect(structuredRejectText({success: false, message: {text: '嵌套'}})).toBe('');
  });

  test('首尾空白被去掉，中间的标点原样保留（不重排服务端的话）', () => {
    expect(structuredRejectText({success: false, message: '  请等一下，上一条还没结束。 \n'})).toBe(
      '请等一下，上一条还没结束。',
    );
    expect(structuredRejectText({success: false, message: ' 服务当前繁忙，请稍后再问 '})).toBe('服务当前繁忙，请稍后再问');
  });

  test('超长不念：那是堆栈/HTML/上游原文的形状，出现在气泡里就是泄漏面', () => {
    const 刚好上限 = '字'.repeat(REJECT_TEXT_MAX_CHARS);
    const 超一个 = '字'.repeat(REJECT_TEXT_MAX_CHARS + 1);
    expect(structuredRejectText({success: false, message: 刚好上限})).toBe(刚好上限);
    expect(structuredRejectText({success: false, message: 超一个})).toBe('');
    expect(
      structuredRejectText({
        success: false,
        message: `<html><body>AssertionError: ... ${'x'.repeat(300)}`,
      }),
    ).toBe('');
  });

  test('非对象输入一律空串且不抛（SDK 可能把 Error、字符串或 undefined 交进来）', () => {
    for (const bad of [undefined, null, '', '请求失败', 0, 4291, true, ['a'], () => 1]) {
      expect(() => structuredRejectText(bad as any)).not.toThrow();
      expect(structuredRejectText(bad as any)).toBe('');
    }
  });

  test('数组虽然 typeof 是 object，但不是拒绝体 ⇒ 不念', () => {
    expect(structuredRejectText([{success: false, message: '假装一句'}])).toBe('');
  });

  test('把 Error 实例当 errorInfo 传进来 ⇒ 不念（这条正是"不读 error.message"的代价测试）', () => {
    const e = new Error('Failed to fetch');
    e.name = 'TypeError';
    expect(structuredRejectText(e)).toBe('');
  });

  test('拒绝体里其他键再丰富也不影响取值（不承诺拼任何句子）', () => {
    expect(
      structuredRejectText({
        success: false,
        message: '上一条还在处理中',
        code: 4291,
        msg: '上一条还在处理中',
        data: {reason: 'same-conversation-duplicate', active: 1, limit: 3, prevMessageCode: 'MC-9', ageMs: 861},
        statusCode: 200,
      }),
    ).toBe('上一条还在处理中');
  });

  test('msg 回退：只写 msg 也要念出来——否则字段名一变，界面就悄悄退回"请求失败"', () => {
    expect(structuredRejectText({success: false, msg: '服务当前繁忙，请稍后再问'})).toBe('服务当前繁忙，请稍后再问');
    expect(structuredRejectText({success: false, message: '   ', msg: '这句能用'})).toBe('这句能用');
    expect(structuredRejectText({success: false, message: 'x'.repeat(201), msg: '短句可用'})).toBe('短句可用');
  });

  test('两份都在但内容不同时取 message（那是 SDK 真正 new Error 用的那一份，同屏不能出两句话）', () => {
    expect(structuredRejectText({success: false, message: '以这份为准', msg: '另一份'})).toBe('以这份为准');
  });

  test('回退也要过同一套约束：msg 为空/超长/非字符串 ⇒ 仍然闭嘴', () => {
    expect(structuredRejectText({success: false, msg: ''})).toBe('');
    expect(structuredRejectText({success: false, msg: 'x'.repeat(201)})).toBe('');
    expect(structuredRejectText({success: false, msg: 4291})).toBe('');
  });
});
