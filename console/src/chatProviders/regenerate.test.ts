import {
  textOf,
  regenerateTarget,
  regenerateConfirmText,
  regenerateBlockedText,
} from './regenerate';

/**
 * P3 最小安全版的界面判据：按钮什么时候给、给之前说什么、不给时怎么说。
 * 每条 `ok:false` 都必须有自己的 reason——"按钮不见了"和"为什么不见"是两件事。
 */

const ai = (content = '答案正文', messageCode = 'mc-1') => ({message: {role: 'ai', content, messageCode}, extraInfo: {}});
const my = (content = '原始问题') => ({message: {role: 'my', content}, extraInfo: {}});

describe('regenerateTarget：只对最后一条成品回答开放', () => {
  test('正常形状：给出问题与消息标识', () => {
    const t = regenerateTarget([my('什么是幂等'), ai('同一操作多次执行结果不变', 'abc123')]);
    expect(t).toEqual({ok: true, reason: 'ok', query: '什么是幂等', messageCode: 'abc123', attachments: []});
  });

  test('正在请求中 ⇒ 不给（重发就是并发第二轮，会撞上 P5 那条闸）', () => {
    const t = regenerateTarget([my(), ai()], {requesting: true});
    expect(t.ok).toBe(false);
    expect(t.reason).toBe('requesting');
  });

  test('没有消息 ⇒ no-messages', () => {
    expect(regenerateTarget([]).reason).toBe('no-messages');
    expect(regenerateTarget(undefined as any).reason).toBe('no-messages');
    expect(regenerateTarget(null as any).reason).toBe('no-messages');
  });

  test('最后一条不是回答 ⇒ last-not-answer', () => {
    expect(regenerateTarget([ai(), my()]).reason).toBe('last-not-answer');
  });

  test('空回答与纯空白回答都算没有成品（不给一个点了没反应的哑按钮）', () => {
    expect(regenerateTarget([my(), ai('')]).reason).toBe('empty-answer');
    expect(regenerateTarget([my(), ai('   \n ')]).reason).toBe('empty-answer');
  });

  test('回答没有消息标识 ⇒ no-message-code（不能声明"替换的是哪条"就不许说重新生成）', () => {
    const t = regenerateTarget([my(), {message: {role: 'ai', content: '有内容'}, extraInfo: {}}]);
    expect(t.reason).toBe('no-message-code');
  });

  test('标识也可以来自 extraInfo（历史行的两种形状都要认）', () => {
    const t = regenerateTarget([my(), {message: {role: 'ai', content: '有内容'}, extraInfo: {messageCode: 'from-extra'}}]);
    expect(t.ok).toBe(true);
    expect(t.messageCode).toBe('from-extra');
  });

  test('找不到原始问题 ⇒ no-question，且不编一个空查询去重跑', () => {
    expect(regenerateTarget([ai()]).reason).toBe('no-question');
    expect(regenerateTarget([my('   '), ai()]).reason).toBe('no-question');
  });

  test('往回找最近一条用户提问（多轮里不能拿第一句去重跑）', () => {
    const t = regenerateTarget([my('第一问'), ai('答一', 'm1'), my('第二问'), ai('答二', 'm2')]);
    expect(t.query).toBe('第二问');
    expect(t.messageCode).toBe('m2');
  });

  test('附件随原问题一起带上：重跑必须复用同一个输入，否则不是同一件事', () => {
    const withFile = {message: {role: 'my', content: '看这份文件', attachments: [{uid: 'u1', status: 'done'}]}, extraInfo: {}};
    const t = regenerateTarget([withFile, ai('读完的回答', 'm9')]);
    expect(t.attachments).toEqual([{uid: 'u1', status: 'done'}]);
  });

  test('畸形条目不抛', () => {
    for (const bad of [[null], [undefined], [{}, {}], [{message: null}], [{message: {role: 'ai', content: 42}}]]) {
      expect(() => regenerateTarget(bad as any)).not.toThrow();
    }
  });
});

describe('确认文案与禁用文案', () => {
  test('确认文案必须先说费用、再说旧答案不删', () => {
    const s = regenerateConfirmText({ok: true, reason: 'ok', query: 'q', messageCode: 'm'});
    expect(s).toContain('再发起一次模型调用');
    expect(s).toContain('费用');
    expect(s).toContain('不会被删除或修改');
    expect(s.indexOf('费用') < s.indexOf('不会被删除或修改')).toBe(true);
    /** 不许出现我算不出来的具体数字 */
    expect(/\d+\s*(token|元|分)/i.test(s)).toBe(false);
  });

  test('ok:false 时确认文案为空（没有可确认的动作就不配话）', () => {
    expect(regenerateConfirmText({ok: false, reason: 'requesting'})).toBe('');
    expect(regenerateConfirmText(null as any)).toBe('');
  });

  test('每种禁用原因都有各自的说法，且互不相同', () => {
    const reasons = ['requesting', 'empty-answer', 'last-not-answer', 'no-message-code', 'no-question', 'no-messages'];
    const texts = reasons.map((reason) => regenerateBlockedText({ok: false, reason}));
    texts.forEach((t, i) => expect(t.length).toBeGreaterThan(0));
    expect(new Set(texts).size).toBe(reasons.length);
  });

  test('未知原因落到通用句，不返回空串（禁用但没有解释是最难查的）', () => {
    expect(regenerateBlockedText({ok: false, reason: 'whatever'})).toBe('当前不能重新生成');
    expect(regenerateBlockedText({ok: true, reason: 'ok'})).toBe('');
  });
});

describe('历史形状（2026-11-13 dev 点验抓到的缺陷）', () => {
  /**
   * 实时发送时用户消息 content 是字符串；历史载入时它是 [{type:'text', text:…}]。
   * 第一版只认字符串 ⇒ 刷新页面后按钮一律显示"找不到原始问题，无法原样重跑"。
   * 单测当时全绿，因为用例只喂了字符串——**用例的形状必须覆盖真实数据的两种形状**。
   */
  const historyMy = (text: string) => ({message: {role: 'my', content: [{type: 'text', text}], messageCode: 'q1'}, id: 'q1-query', status: 'success', extraInfo: {}});
  const historyAi = (content = '回答', messageCode = 'a1') => ({message: {role: 'ai', content, messageCode}, id: messageCode + '-answer', status: 'success', extraInfo: {}});

  test('分段数组的用户消息要能被认出来，并把纯文本作为重跑的 query', () => {
    const t = regenerateTarget([historyMy('什么是幂等性'), historyAi('同一操作多次执行结果不变')]);
    expect(t.ok).toBe(true);
    expect(t.query).toBe('什么是幂等性');
    expect(t.messageCode).toBe('a1');
  });

  test('role 为 user（不是 my）的历史形状同样认', () => {
    const t = regenerateTarget([
      {message: {role: 'user', content: '一个问题'}, extraInfo: {}},
      historyAi(),
    ]);
    expect(t.ok).toBe(true);
    expect(t.query).toBe('一个问题');
  });

  test('分段里混有非文本片段时只取文本，不报"找不到原始问题"', () => {
    const t = regenerateTarget([
      {message: {role: 'my', content: [{type: 'image', url: 'x'}, {type: 'text', text: '看图说话'}]}, extraInfo: {}},
      historyAi(),
    ]);
    expect(t.ok).toBe(true);
    expect(t.query).toBe('看图说话');
  });

  test('分段数组全空才真的算没有问题', () => {
    const t = regenerateTarget([
      {message: {role: 'my', content: [{type: 'image', url: 'x'}]}, extraInfo: {}},
      historyAi(),
    ]);
    expect(t.reason).toBe('no-question');
  });

  test('textOf 对各形状的返回值', () => {
    expect(textOf('abc')).toBe('abc');
    expect(textOf([{type: 'text', text: 'a'}, {type: 'text', text: 'b'}])).toBe('ab');
    expect(textOf(['x', 'y'])).toBe('xy');
    expect(textOf([{content: 'c'}])).toBe('c');
    expect(textOf(null)).toBe('');
    expect(textOf(undefined)).toBe('');
    expect(textOf(42)).toBe('');
    expect(textOf([{type: 'image'}])).toBe('');
  });
});
