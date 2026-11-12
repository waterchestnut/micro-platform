import {
  resolveToolCalls,
  toolResultScopeNote,
  toolArgsView,
  droppedSegmentsText,
  modelCallNote,
  applySegmentStart,
  applySegmentEnd,
  fromHistorySegments,
  segmentBodyHint,
  segmentCategory,
  segmentMetricsText,
  segmentTimelineView,
  deriveEmptyRoundNotice,
  lostCharsText,
  isSegmentPayload,
  MAX_CLIENT_SEGMENTS,
} from './segments';

/**
 * 协议 3 段合并 + "空正文轮次该说什么"的判定。
 *
 * 这些用例的存在理由：判据来自服务端实测（`llm.api/docs/api/chat-sse.md`），
 * 而它一旦写进组件就只能靠手点页面验证——手点验证过一次，改坏了不会有人知道。
 */

const start = (seq: number, over: any = {}) => ({
  seq,
  kind: 'tool-round',
  category: 'tools',
  title: `调用 1 个工具`,
  ...over,
});
const end = (seq: number, over: any = {}) => ({
  seq,
  kind: 'tool-round',
  category: 'tools',
  title: `调用 1 个工具`,
  metrics: { chars: 35, toolCount: 1, ms: 1635 },
  truncated: false,
  ref: null,
  ...over,
});

describe('段以 seq 关联，且必须幂等', () => {
  test('start/end 成对合并成一段', () => {
    let s: any[] = [];
    s = applySegmentStart(s, start(1));
    expect(s).toHaveLength(1);
    expect(s[0].open).toBe(true);
    s = applySegmentEnd(s, end(1));
    expect(s).toHaveLength(1);
    expect(s[0].open).toBe(false);
    expect(s[0].metrics).toEqual({ chars: 35, toolCount: 1, ms: 1635 });
  });

  test('重复收到同一 seq 不新增段（断线续接会带**原始 id 重放**已发过的事件）', () => {
    let s = applySegmentStart([], start(2));
    s = applySegmentStart(s, start(2));
    s = applySegmentEnd(s, end(2));
    s = applySegmentEnd(s, end(2));
    expect(s).toHaveLength(1);
    expect(s[0].open).toBe(false);
  });

  test('先收到 end 也能成段（续接时 start 可能早已在断线前落定）', () => {
    const s = applySegmentEnd([], end(3, { seq: 3 }));
    expect(s).toHaveLength(1);
    expect(s[0].seq).toBe(3);
    expect(s[0].open).toBe(false);
  });

  test('乱序到达也按 seq 排好；**seq 可以不连续**（服务端超限丢段仍占号）', () => {
    let s = applySegmentEnd([], end(5));
    s = applySegmentStart(s, start(3));
    s = applySegmentEnd(s, end(3));
    expect(s.map((x) => x.seq)).toEqual([3, 5]);
  });

  test('载荷不是对象 / seq 不是有限数字 ⇒ 原样返回（不信任网络输入）', () => {
    const before = applySegmentStart([], start(1));
    for (const bad of [null, undefined, 'x', 7, {}, { seq: NaN }, { seq: '1' }, []]) {
      expect(isSegmentPayload(bad)).toBe(false);
      expect(applySegmentStart(before, bad)).toBe(before);
      expect(applySegmentEnd(before, bad)).toBe(before);
    }
  });

  test('超过上限只保留最近的段（异常长流不该把内存吃满）', () => {
    let s: any[] = [];
    for (let i = 1; i <= MAX_CLIENT_SEGMENTS + 40; i++) {
      s = applySegmentEnd(s, end(i));
    }
    expect(s.length).toBeLessThanOrEqual(MAX_CLIENT_SEGMENTS);
    expect(s[s.length - 1].seq).toBe(MAX_CLIENT_SEGMENTS + 40);
  });
});

describe('历史回填的 process.segments', () => {
  test('畸形条目被丢掉而不是渲染成 undefined 卡片', () => {
    const raw = [
      { seq: 1, kind: 'answer', category: 'text', metrics: { chars: 770 } },
      { kind: 'no-seq' },
      null,
      'x',
      { seq: 2, kind: 'cancelled', category: 'text', metrics: { chars: 42 } },
    ];
    const s = fromHistorySegments(raw as any);
    expect(s.map((x) => x.seq)).toEqual([1, 2]);
    expect(s.every((x) => x.open === false)).toBe(true);
  });

  test('非数组入参返回空数组', () => {
    expect(fromHistorySegments(undefined as any)).toEqual([]);
  });
});

describe('段的渲染文案只说服务端确实给了的数', () => {
  test('metrics 齐全时给出字数/工具数/耗时', () => {
    const s = applySegmentEnd([], end(1));
    expect(segmentMetricsText(s[0])).toBe('35 字 · 1 个工具 · 1.6s');
  });

  test('缺字段就不编：没有 metrics 时是空串（组件据此不渲染度量行）', () => {
    expect(segmentMetricsText({ seq: 1, kind: 'tool-round' })).toBe('');
    expect(segmentMetricsText({ seq: 1, kind: 'tool-round', metrics: { ms: 0 } })).toBe('');
    /** 0 是服务端确实数出来的字数，与"压根没给这个字段"是两件事 */
    expect(segmentMetricsText({ seq: 1, kind: 'tool-round', metrics: { chars: 0 } })).toBe('0 字');
  });

  test('truncated 要显式说出来（否则用户会把截断段当全文）', () => {
    const s = applySegmentEnd([], end(1, { truncated: true }));
    expect(segmentMetricsText(s[0])).toContain('已截断');
  });

  test('category 优先用服务端给的；缺失时按 kind 兜底，未知 kind 落到 text', () => {
    /** category 由服务端给，优先用它；前端不从事件顺序反推 */
    expect(segmentCategory({ seq: 1, kind: 'answer', category: 'tools' } as any)).toBe('tools');
    expect(segmentCategory({ seq: 1, kind: 'skill-reload' } as any)).toBe('skill');
    expect(segmentCategory({ seq: 1, kind: '未来新增的kind' } as any)).toBe('text');
  });
});

describe('段下方要不要再放一份正文（判据，不是样式决定）', () => {
  test('`ref:"answer"` 的段指向回答，不再抄一份', () => {
    expect(segmentBodyHint({ seq: 1, kind: 'answer', category: 'text', ref: 'answer' })).toBe(
      '正文见下方回答',
    );
    expect(segmentBodyHint({ seq: 2, kind: 'cancelled', category: 'text', ref: 'answer' })).toBe(
      '正文见下方回答',
    );
  });

  test('有段内文本时返回 null（由组件直接渲染文本，别叠两套）', () => {
    expect(
      segmentBodyHint({ seq: 1, kind: 'tool-round', category: 'tools', text: '工具的中间输出' }),
    ).toBeNull();
  });

  test('没有 ref 也没有 text ⇒ 什么都不放（不留空盒子）', () => {
    expect(segmentBodyHint({ seq: 1, kind: 'tool-round', category: 'tools' })).toBeNull();
    expect(segmentBodyHint(null as any)).toBeNull();
  });
});

describe('段时间线条目（组件只渲染它，判断全在这里）', () => {
  test('seq / 标题 / 度量 / key 都来自段本身', () => {
    const v = segmentTimelineView({
      seq: 2,
      kind: 'tool-round',
      category: 'tools',
      title: '调用 1 个工具：search',
      metrics: { chars: 35, toolCount: 1, ms: 1600 },
    });
    expect(v.key).toBe('seg-2');
    expect(v.title).toBe('调用 1 个工具：search');
    expect(v.description).toBe('35 字 · 1 个工具 · 1.6s');
    expect(v.status).toBe('success');
  });

  test('进行中的段是 loading 并写明"进行中"', () => {
    const v = segmentTimelineView({
      seq: 3,
      kind: 'tool-round',
      open: true,
      title: '调用 2 个工具',
    });
    expect(v.status).toBe('loading');
    expect(v.description).toBe('进行中');
  });

  test('`cancelled` 段是 error，不是 success（把中断粉饰成收尾是这个面板最容易犯的错）', () => {
    const v = segmentTimelineView({
      seq: 4,
      kind: 'cancelled',
      category: 'text',
      title: '被中断的一段',
      metrics: { chars: 42 },
    });
    expect(v.status).toBe('error');
    expect(v.description).toBe('42 字');
  });

  test('`ref:"answer"` 的段用 hint 指向回答，且不可展开（正文不在这里）', () => {
    const v = segmentTimelineView({
      seq: 5,
      kind: 'answer',
      category: 'text',
      title: '最终回答',
      ref: 'answer',
      metrics: { chars: 770 },
    });
    expect(v.bodyKind).toBe('hint');
    expect(v.body).toBe('正文见下方回答');
    expect(v.collapsible).toBe(false);
  });

  test('有段内文本才可展开，且 body 就是那段文本', () => {
    const v = segmentTimelineView({
      seq: 6,
      kind: 'tool-round',
      category: 'tools',
      title: '工具往返',
      text: '当时的输出',
    });
    expect(v.collapsible).toBe(true);
    expect(v.bodyKind).toBe('text');
    expect(v.body).toBe('当时的输出');
  });

  test('什么度量都没有 ⇒ description 为 null（组件不渲染空描述行）', () => {
    const v = segmentTimelineView({ seq: 7, kind: 'finalize' });
    expect(v.description).toBeNull();
    expect(v.title).toBe('整理最终回答'); // 没给 title 时按 kind 说类别，不编造具体动作
    expect(v.bodyKind).toBe('none');
  });
});

describe('空正文轮次：三类各有各的说法，不许一律写成"内容不完整"', () => {
  test('有正文 ⇒ 不需要任何说明', () => {
    expect(deriveEmptyRoundNotice({ content: '  有字  ' })).toBeNull();
  });

  test('遗弃回填行 ⇒ 说"因服务重启中断"，有正数量级才带字数', () => {
    const a = deriveEmptyRoundNotice({
      content: '',
      error: 'abandoned:process-lost',
      process: { lostChars: 10772 },
    });
    expect(a?.reason).toBe('abandoned');
    expect(a?.tone).toBe('warning');
    expect(a?.text).toContain('服务重启');
    expect(a?.text).toContain('约 10772 字');
  });

  test('lostChars 是 0 或 null 时**绝不**引用字数（历史数据里的 0 表示"没估过"）', () => {
    for (const bad of [0, null, undefined, -5, '3']) {
      const n = deriveEmptyRoundNotice({
        content: '',
        error: 'abandoned:process-lost',
        process: { lostChars: bad },
      });
      expect(n?.reason).toBe('abandoned');
      expect(n?.text).not.toMatch(/\d+\s*字/);
      expect(n?.text).toContain('未产出可保存的正文');
    }
    expect(lostCharsText(0)).toBe('');
    expect(lostCharsText(1)).toBe('约 1 字未能保存');
  });

  test('有段可回放 ⇒ 说的是"过程可见"，而不是"没内容"', () => {
    const segs = applySegmentEnd(applySegmentStart([], start(1)), end(1));
    const n = deriveEmptyRoundNotice({ content: '', segments: segs });
    expect(n?.reason).toBe('has-segments');
    expect(n?.tone).toBe('info');
    expect(n?.text).toContain('执行过程');
  });

  test('首 token 前就取消 ⇒ 说"在模型开始输出前已被取消"', () => {
    const n = deriveEmptyRoundNotice({
      content: '',
      streamState: 'aborted',
      process: { usage: { hasUsage: false } },
    });
    expect(n?.reason).toBe('no-content');
    expect(n?.text).toContain('开始输出前');
  });

  test('什么都没留下 ⇒ 说"未产出回答内容"，**不许**说"内容不完整"（没有证据说本来会有内容）', () => {
    const n = deriveEmptyRoundNotice({ content: '', streamState: 'aborted', process: {} });
    expect(n?.text).toBe('本轮未产出回答内容');
    expect(n?.text).not.toContain('不完整');
  });

  test('判定的优先级：abandoned 盖过"有段"（丢了正文就是损失，不能被"过程可见"洗白）', () => {
    const segs = applySegmentEnd(applySegmentStart([], start(1)), end(1));
    const n = deriveEmptyRoundNotice({
      content: '',
      segments: segs,
      error: 'abandoned:process-lost',
      process: { lostChars: 900 },
    });
    expect(n?.reason).toBe('abandoned');
  });
});

describe('H2：入参与整段丢弃必须说实话', () => {
  test('存量行（两个键都没有）⇒ 说"未记录"，不画空参数', () => {
    const v = toolArgsView({ id: 'a', name: 'search', result: '3 条' });
    expect(v.recorded).toBe(false);
    expect(v.note).toBe('入参未记录');
    expect(v.preview).toBe('');
  });
  test('空入参（argsChars=0）是事实，可以说"无入参"', () => {
    const v = toolArgsView({ args: '', argsChars: 0, argsTruncated: false });
    expect(v.recorded).toBe(true);
    expect(v.note).toBe('无入参');
    expect(v.preview).toBe('');
  });
  test('被服务端截断时引用 argsChars，不引用到手正文长度', () => {
    const args = 'x'.repeat(4000);
    const v = toolArgsView({ args, argsChars: 12480, argsTruncated: true });
    expect(v.note).toBe('12480 字，服务端留存前 4000 字');
    expect(v.preview.length).toBeLessThanOrEqual(161);
    expect(v.preview.endsWith('…')).toBe(true);
  });
  test('没截断时不造 note，也不说"过程完整"', () => {
    const v = toolArgsView({ args: '{"q":"abc"}', argsChars: 11, argsTruncated: false });
    expect(v).toEqual({ recorded: true, preview: '{"q":"abc"}', note: '' });
  });
  test('argsChars 缺失但正文在 ⇒ 仍算记录了，字数部分就不提', () => {
    const v = toolArgsView({ args: '{"q":"abc"}' });
    expect(v.recorded).toBe(true);
    expect(v.note).toBe('');
    expect(v.preview).toBe('{"q":"abc"}');
  });
  test('丢了段就说，没丢就一个字都不说', () => {
    expect(droppedSegmentsText(null)).toBe('');
    expect(droppedSegmentsText({})).toBe('');
    expect(droppedSegmentsText({ dropped: { count: 0, chars: 0 } })).toBe('');
    expect(droppedSegmentsText({ dropped: { count: 2, chars: 350 } })).toBe(
      '另有 2 段过程内容未留存（约 350 字）',
    );
  });
  test('字数不明时只说段数： chars=0 不能变成"约 0 字"', () => {
    expect(droppedSegmentsText({ dropped: { count: 1, chars: 0 } })).toBe(
      '另有 1 段过程内容未留存',
    );
    expect(droppedSegmentsText({ dropped: { count: 3 } })).toBe('另有 3 段过程内容未留存');
  });
  test('非数字的 count 一律当"没丢"，不拿 NaN 去说事', () => {
    expect(droppedSegmentsText({ dropped: { count: 'x' } })).toBe('');
    expect(droppedSegmentsText({ dropped: { count: null } })).toBe('');
  });
});
describe('H2b：工具结果是全文还是片段', () => {
  const tr = (o: any) => [o];
  test('没截断也没量级条目 ⇒ 什么都不说', () => {
    expect(toolResultScopeNote({ id: 'a', result: '短文' }, [])).toEqual({
      known: false,
      text: '',
      archived: null,
    });
    expect(toolResultScopeNote({ id: 'a', result: '短文' }, undefined)).toEqual({
      known: false,
      text: '',
      archived: null,
    });
  });
  test('量级说 chars 等于到手长度 ⇒ 不说（全文就在手上）', () => {
    expect(
      toolResultScopeNote({ id: 'a', result: 'abc' }, tr({ ref: 'a', chars: 3, stored: true }))
        .text,
    ).toBe('');
  });
  test('片段就说片段，且两个数各自注明是哪一个', () => {
    const r = toolResultScopeNote(
      { id: 'a', result: 'x'.repeat(4000) },
      tr({ ref: 'a', chars: 12992, stored: true }),
    );
    expect(r.text).toBe('这条结果共 12992 字，此处显示 4000 字');
    expect(r.archived).toBe(true);
  });
  test('超出留档上限时必须说尾部不可恢复', () => {
    const r = toolResultScopeNote(
      { id: 'a', result: 'x'.repeat(10) },
      tr({ ref: 'a', chars: 500000, stored: false }),
    );
    expect(r.text.endsWith('；全文超出留档上限，尾部未留存')).toBe(true);
    expect(r.archived).toBe(false);
  });
  test('stored 缺键 ⇒ archived=null 且说"未记录"，不默认成留住了', () => {
    const r = toolResultScopeNote(
      { id: 'a', result: 'y'.repeat(10) },
      tr({ ref: 'a', chars: 999 }),
    );
    expect(r.archived).toBe(null);
    expect(r.text).toContain('全文留存情况未记录');
  });
  test('截断标记在、却没有量级条目 ⇒ 承认对不上，不安静当全文', () => {
    const r = toolResultScopeNote({ id: 'a', result: 'z'.repeat(4000) + '...[truncated]' }, []);
    expect(r.text).toContain('服务端未记录全文量级');
  });
  test('chars 不是数字 ⇒ 只说片段，不编字数', () => {
    const r = toolResultScopeNote(
      { id: 'a', result: 'q'.repeat(5) },
      tr({ ref: 'a', chars: null, stored: true }),
    );
    expect(r.text).toBe('此处为片段，全文字数未记录');
  });
  test('文案里不出现"展开/取回"这类尚未实现的承诺', () => {
    for (const s of [
      toolResultScopeNote(
        { id: 'a', result: 'x'.repeat(4000) },
        tr({ ref: 'a', chars: 12992, stored: true }),
      ).text,
      toolResultScopeNote({ id: 'a', result: 'y'.repeat(10) }, tr({ ref: 'a', chars: 999 })).text,
    ]) {
      expect(s.includes('展开')).toBe(false);
      expect(s.includes('取回')).toBe(false);
    }
  });
});

describe('H2b 补：签名必须接得住 undefined（这是 tsc 报出来的真错，不是风格问题）', () => {
  test('第二参数显式 undefined 与整体缺省都不需要 as any', () => {
    const want = { known: false, text: '', archived: null };
    expect(toolResultScopeNote({ id: 'a', result: '短文' }, undefined)).toEqual(want);
    expect(toolResultScopeNote({ id: 'a', result: '短文' })).toEqual(want);
    /** 面板实际传的就是这个可能为 undefined 的表达式；类型上接得住，才不用在四端各兜一次 */
    const process: {
      toolResults?: { ref?: string | null; chars?: number | null; stored?: boolean | null }[];
    } = {};
    expect(toolResultScopeNote({ id: 'b', result: 'abc' }, process.toolResults)).toEqual(want);
  });
});
describe('H2c：历史形状不许把字段削平（resolveToolCalls）', () => {
  const hist = {
    toolCalls: [
      {id: 'c1', name: 'search_web', result: 'x'.repeat(4000), args: '{"q":"a"}', argsChars: 11, argsTruncated: false},
      {id: 'c2', name: 'legacy', result: '有结果'},
    ],
  };
  test('只有 process.toolCalls（历史行）时 result/args/argsChars 全部保留', () => {
    const out = resolveToolCalls(undefined, hist);
    expect(out.length).toBe(2);
    expect(out[0].result.length).toBe(4000);
    expect(out[0].argsChars).toBe(11);
    expect(out[1].result).toBe('有结果');
    /** 存量行没有 args 这个维度：必须保持缺失，不能补空串冒充"无入参"（toBe 只收一个参数） */
    expect('args' in out[1]).toBe(false);
  });
  test('缺 status 补 done，已有 status 不覆盖', () => {
    const out = resolveToolCalls(undefined, {toolCalls: [{id: 'a', status: 'pending'}, {id: 'b'}]});
    expect(out[0].status).toBe('pending');
    expect(out[1].status).toBe('done');
  });
  test('实时数组优先且原样保留字段', () => {
    const live = [{id: 'c1', name: 'run_code', result: 'ok', args: '{}', argsChars: 2, status: 'done'}];
    expect(resolveToolCalls(live, hist)).toEqual(live.map((t) => ({...t})));
  });
  test('两边都空或畸形都返回空数组，不抛', () => {
    for (const [l, p] of [[undefined, undefined], [null, null], [[], {}], [{} as any, {toolCalls: null}], [undefined, {toolCalls: 'x'}]]) {
      expect(resolveToolCalls(l, p)).toEqual([]);
    }
  });
  test('不修改入参', () => {
    const src = {toolCalls: [{id: 'a', name: 'n'}]};
    resolveToolCalls(undefined, src);
    expect('status' in src.toolCalls[0]).toBe(false);
  });
});

describe('modelCallNote：相等就是重复，所以默认不说', () => {
  test('modelCalls 与 iterationCount 相等 ⇒ 不说任何东西', () => {
    expect(modelCallNote({iterationCount: 5, usage: {modelCalls: 5, hasUsage: true}})).toBe('');
    expect(modelCallNote({iterationCount: 1, usage: {modelCalls: 1, hasUsage: true}})).toBe('');
  });

  test('不等 ⇒ 只报数，不替服务端选原因', () => {
    const s = modelCallNote({iterationCount: 5, usage: {modelCalls: 6, hasUsage: true}});
    expect(s).toBe('上游模型实际调用 6 次');
    expect(/重试|补落|换档/.test(s)).toBe(false);
  });

  test('少于轮次也照实报（我们不知道是不是同一因，但不能装看不见）', () => {
    expect(modelCallNote({iterationCount: 4, usage: {modelCalls: 3, hasUsage: true}})).toBe('上游模型实际调用 3 次');
  });

  test('没有用量记录 ⇒ 不说，不许编', () => {
    expect(modelCallNote({iterationCount: 3, usage: {modelCalls: 0, hasUsage: false}})).toBe('');
    expect(modelCallNote({iterationCount: 3, usage: {}})).toBe('');
    expect(modelCallNote({iterationCount: 3})).toBe('');
    expect(modelCallNote({})).toBe('');
    expect(modelCallNote(undefined)).toBe('');
  });

  test('hasUsage=false 时即便有数字也不说（用量没上报，那个数不可信）', () => {
    expect(modelCallNote({iterationCount: 2, usage: {modelCalls: 7, hasUsage: false}})).toBe('');
  });

  test('没有可比的分母（iterationCount 缺失/非正）⇒ 不单独报调用数', () => {
    expect(modelCallNote({usage: {modelCalls: 6, hasUsage: true}})).toBe('');
    expect(modelCallNote({iterationCount: 0, usage: {modelCalls: 6, hasUsage: true}})).toBe('');
    expect(modelCallNote({iterationCount: 'abc', usage: {modelCalls: 6, hasUsage: true}})).toBe('');
  });

  test('畸形数字不抛（NaN、null、对象、字符串数字之外）', () => {
    for (const bad of [NaN, null, undefined, {}, [], 'x']) {
      expect(() => modelCallNote({iterationCount: 3, usage: {modelCalls: bad, hasUsage: true}})).not.toThrow();
      expect(modelCallNote({iterationCount: 3, usage: {modelCalls: bad, hasUsage: true}})).toBe('');
    }
  });

  test('字符串数字接受（后端偶尔下发文本数字），但仍要满足"不等才说"', () => {
    expect(modelCallNote({iterationCount: 5, usage: {modelCalls: '6', hasUsage: true}})).toBe('上游模型实际调用 6 次');
    expect(modelCallNote({iterationCount: 6, usage: {modelCalls: '6', hasUsage: true}})).toBe('');
  });
});
