/**
 * toolResult.ts 的穷举用例：三个出口与"什么时候根本不该取"
 */
import {
  clearToolResultCache,
  MAX_PAGES,
  PAGE_SIZE,
  runToolResultFetch,
  toolResultIntent,
  toolResultNextAction,
  toolResultRunNote,
  PREVIEW_CHARS,
  prettyToolResultText,
  toolResultDisplay,
  toolResultsDefaultOpen,
  type ToolResultPage,
  type ToolResultRun,
} from './toolResult';

/**
 * 模块级缓存是真实行为，但在测试里它是隐藏状态：
 * 既有用例会用同一个 messageCode|ref 配不同的假 load 反复验证各个出口，
 * 不清缓存就会拿到上一次的结果（加缓存那轮一次红了 8 条，其中一条明确报
 * Expected "aaaabb" / Received "abc"）。
 * 所以列 0 清一次；缓存自身的语义交给下面 H2d 那组用例专门验。
 */
beforeEach(() => clearToolResultCache());


/**
 * @description 造一页
 * @param {Object} o 覆盖字段
 * @returns {ToolResultPage} 一页
 */
const page = (o: Partial<ToolResultPage> = {}): ToolResultPage => ({
  content: 'abc',
  offset: 0,
  end: 3,
  remaining: 0,
  truncatedMore: false,
  stored: true,
  availableChars: 3,
  ...o,
});

/**
 * @description 按顺序吐出预置页，超出部分报错（好让"多翻了"变成失败而不是静默循环）
 * @param {ToolResultPage[]} pages 页序
 * @returns {Function} load
 */
const scripted = (pages: (ToolResultPage | Error)[]) => {
  const seen: number[] = [];
  const load = async (body: any) => {
    seen.push(body.offset);
    const next = pages.shift();
    if (!next) {
      throw new Error('load 被多调了一次');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { load, seen };
};

describe('toolResultIntent：该不该取，四种情形说的话不同', () => {
  test('全文已在手上（chars <= 到手长度）⇒ 不取，也不多话', () => {
    const i = toolResultIntent({ id: 'a', result: 'abc' }, [{ ref: 'a', chars: 3, stored: true }]);
    expect(i).toEqual({ ok: false, reason: 'already-full', note: '' });
  });
  test('没截断也没量级条目 ⇒ 不取（不是"取不到"，是"没必要"）', () => {
    expect(toolResultIntent({ id: 'a', result: 'abc' }, []).reason).toBe('already-full');
    expect(toolResultIntent({ id: 'a', result: 'abc' }, undefined).ok).toBe(false);
  });
  test('有截断标记却没有量级条目 ⇒ 明确不给动作，并说明量级未记录', () => {
    const i = toolResultIntent({ id: 'a', result: 'x'.repeat(10) + '...[truncated]' }, []);
    expect(i.ok).toBe(false);
    expect(i.reason).toBe('no-magnitude');
    expect(i.note).toContain('未记录');
  });
  test('stored:true 且 chars 更大 ⇒ 可取，且不需要任何前置声明', () => {
    expect(
      toolResultIntent({ id: 'a', result: 'x'.repeat(10) }, [
        { ref: 'a', chars: 999, stored: true },
      ]),
    ).toEqual({
      ok: true,
      reason: 'ok',
      note: '',
    });
  });
  test('stored:false 仍可取（留档里有的那段还是比预览长），但必须先说尾部不存在', () => {
    const i = toolResultIntent({ id: 'a', result: 'x'.repeat(10) }, [
      { ref: 'a', chars: 500000, stored: false },
    ]);
    expect(i.ok).toBe(true);
    expect(i.reason).toBe('tail-lost');
    expect(i.note).toContain('尾部未留存');
  });
  test('stored 缺键 ⇒ 可取但说"留档情况未记录，可能失败"，不默认成留住了', () => {
    const i = toolResultIntent({ id: 'a', result: 'y'.repeat(10) }, [{ ref: 'a', chars: 999 }]);
    expect(i.ok).toBe(true);
    expect(i.reason).toBe('retention-unknown');
  });
  test('老行只有 tool_call_id 时也能按它匹配上量级条目', () => {
    expect(
      toolResultIntent({ toolCallId: 'a', result: 'z'.repeat(10) }, [
        { ref: 'a', chars: 999, stored: true },
      ]).reason,
    ).toBe('ok');
  });
  test('chars 不是数字 ⇒ 不能拿它做"已完整"的判断，按未记录处理', () => {
    const i = toolResultIntent({ id: 'a', result: 'q' }, [{ ref: 'a', chars: null, stored: true }]);
    expect(i.ok).toBe(true);
  });
});

describe('runToolResultFetch：四个终止条件都得走到', () => {
  test('一页取完', async () => {
    const { load } = scripted([page({ truncatedMore: false })]);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a' });
    expect(r.outcome).toBe('complete');
    expect(r.text).toBe('abc');
    expect(r.pages).toBe(1);
    expect(r.error).toBe('');
    expect(r.remaining).toBe(0);
  });

  test('多页拼接，游标用服务端的 end', async () => {
    const { load, seen } = scripted([
      page({ content: 'aaaa', end: 4, truncatedMore: true, remaining: 2 }),
      page({ content: 'bb', offset: 4, end: 6, truncatedMore: false, remaining: 0 }),
    ]);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a' });
    expect(r.text).toBe('aaaabb');
    expect(r.outcome).toBe('complete');
    expect(seen).toEqual([0, 4]);
    expect(r.pages).toBe(2);
  });

  test('到 maxPages 仍有剩余 ⇒ partial，并把 remaining 带出来（不能报成取完）', async () => {
    const pages = Array.from({ length: 3 }).map(() =>
      page({ content: 'x'.repeat(10), truncatedMore: true, remaining: 77 }),
    );
    const { load } = scripted(pages);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a', maxPages: 3 });
    expect(r.outcome).toBe('partial');
    expect(r.error).toBe('max-pages');
    expect(r.remaining).toBe(77);
    expect(r.text.length).toBe(30);
  });

  test('空正文却标记有更多 ⇒ failed:no-progress，且只请求一次（这条挡住无限翻页）', async () => {
    const { load, seen } = scripted([
      page({ content: '', truncatedMore: true, remaining: 5 }),
      page({ content: 'zz' }),
    ]);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a' });
    expect(r.outcome).toBe('failed');
    expect(r.error).toBe('no-progress');
    expect(seen.length).toBe(1);
  });

  test('末页正文为空且没有更多 ⇒ failed:empty，不冒充 complete', async () => {
    const { load } = scripted([page({ content: '', truncatedMore: false })]);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a' });
    expect(r.outcome).toBe('failed');
    expect(r.error).toBe('empty');
  });

  test('load 抛错 ⇒ failed 并带上服务端那句话（404 的文案要用得上）', async () => {
    const { load } = scripted([new Error('找不到该标识的留档内容')]);
    const r = await runToolResultFetch({ load, messageCode: 'm', ref: 'a' });
    expect(r.outcome).toBe('failed');
    expect(r.error).toContain('留档');
  });

  test('响应形状不对（没有 content 字符串）⇒ failed:bad-response', async () => {
    const r = await runToolResultFetch({
      load: async () => ({} as any),
      messageCode: 'm',
      ref: 'a',
    });
    expect(r.outcome).toBe('failed');
    expect(r.error).toBe('bad-response');
  });

  test('shouldStop 在取回途中命中 ⇒ stopped，但已取回的字不丢', async () => {
    const { load } = scripted([
      page({ content: 'first', end: 5, truncatedMore: true, remaining: 9 }),
      page({ content: 'second', end: 11, truncatedMore: false }),
    ]);
    /**
     * 用调用次数决定停止时机：上一版我在 await **之后**才置 stop=true，
     * 于是循环里 shouldStop 一直是 false，测出来的其实是 complete —— 那种绿是假的。
     */
    let calls = 0;
    const r = await runToolResultFetch({
      load,
      messageCode: 'm',
      ref: 'a',
      shouldStop: () => {
        calls++;
        return calls > 1;
      },
    });
    expect(r.outcome).toBe('stopped');
    expect(r.text).toBe('first');
    expect(r.pages).toBe(1);
  });

  test('默认参数照协议：limit=PAGE_SIZE、页数上限 MAX_PAGES', async () => {
    const asks: number[] = [];
    const r = await runToolResultFetch({
      load: async (b: any) => {
        asks.push(b.limit);
        return page({
          content: 'x'.repeat(10),
          end: asks.length * 10,
          truncatedMore: true,
          remaining: 1,
        });
      },
      messageCode: 'm',
      ref: 'a',
    });
    expect(asks.every((n) => n === PAGE_SIZE)).toBe(true);
    expect(asks.length).toBe(MAX_PAGES);
    expect(r.outcome).toBe('partial');
  });
});

describe('toolResultRunNote：出口不同，话必须不同', () => {
  /**
   * 公共形状按 `Omit<ToolResultRun, 'outcome' | 'text'>` 给全（含续取游标 nextOffset），
   * 于是下面每条调用**不再需要 `as any`**。原先那些 cast 把"字段不全"这件事从类型检查里
   * 藏掉了：jest 用 esbuild 转换、根本不看类型，所以 8 条用例全绿而 tsc 里它们是错的。
   */
  const base: Omit<ToolResultRun, 'outcome' | 'text'> = {
    pages: 1, remaining: 0, error: '', stored: true, availableChars: 100, nextOffset: 100,
  };
  test('取全了且留档完整 ⇒ 也要报已取回字数', () => {
    /**
     * 这条断言原先期望空串，等于把"沉默"当成设计定下来。
     * 现网真实点验（www-console，会话「Use」，res-discovery_searchResMetas：6554 字 / 预览 4014）之后发现：
     * 面板还会把正文二次截断显示，点击取回后用户**没有任何可分辨的反馈**，
     * "取到了"和"点了没反应"在界面上同形。所以 complete 必须说一句可核对的事实——已取回多少字；
     * 仍然不允许说"内容完整/正确"这类我们无法证明的话。
     */
    expect(toolResultRunNote({...base, outcome: 'complete', text: 'x'.repeat(100)})).toBe('已取回 100 字');
  });
  test('取全了但 stored=false ⇒ 仍然要说尾部不存在', () => {
    const s = toolResultRunNote({
      ...base,
      outcome: 'complete',
      text: 'y'.repeat(20),
      stored: false,
    });
    expect(s).toContain('已取回 20 字');
    expect(s).toContain('尾部不存在');
  });
  test('partial ⇒ 两个数都给，并说明可以再点', () => {
    const s = toolResultRunNote({
      ...base,
      outcome: 'partial',
      text: 'z'.repeat(40000),
      remaining: 1234,
      error: 'max-pages',
      nextOffset: 40000,
    });
    expect(s).toContain('还有 1234 字未取回');
    expect(s).toContain('40000');
  });
  test('no-progress 与一般失败的说法不同', () => {
    expect(
      toolResultRunNote({...base, outcome: 'failed', text: '', error: 'no-progress'}),
    ).toContain('空正文');
    expect(
      toolResultRunNote({...base, outcome: 'failed', text: '', error: 'boom'}),
    ).toContain('boom');
  });
  test('stopped ⇒ 有字就说有多少字，没字就不吭声', () => {
    expect(toolResultRunNote({...base, outcome: 'stopped', text: 'abc'})).toBe(
      '已停止，取回 3 字',
    );
    expect(toolResultRunNote({...base, outcome: 'stopped', text: ''})).toBe('');
  });
  test('缺对象不抛', () => {
    expect(toolResultRunNote(undefined as any)).toBe('');
  });
});
describe('H2d：取回成功也要有话可说（现网点验发现的沉默缺陷）', () => {
  test('complete + stored=true 报已取回字数，且不评价内容', () => {
    const n = toolResultRunNote({outcome: 'complete', text: 'x'.repeat(6554), pages: 2, remaining: 0, error: '', stored: true, availableChars: 6554, nextOffset: 6554});
    expect(n).toBe('已取回 6554 字');
    /** 面板会二次截断显示，沉默时用户无法区分"取到了"和"点了没反应" */
    expect(n.indexOf('完整')).toBe(-1);
    expect(n.indexOf('正确')).toBe(-1);
  });
  test('complete + stored=false 仍要说明尾部不存在', () => {
    const n = toolResultRunNote({outcome: 'complete', text: 'y'.repeat(1200), pages: 1, remaining: 0, error: '', stored: false, availableChars: 1200, nextOffset: 1200});
    expect(n.startsWith('已取回 1200 字')).toBe(true);
    expect(n.indexOf('尾部不存在') > 0).toBe(true);
  });
  test('partial 必须带剩余字数，complete 之外不许合并说法', () => {
    const n = toolResultRunNote({outcome: 'partial', text: 'z'.repeat(40000), pages: 10, remaining: 1234, error: 'max-pages', stored: true, availableChars: 41234, nextOffset: 40000});
    expect(n.indexOf('还有 1234 字未取回') > 0).toBe(true);
  });
});
describe('H2d 缓存：取回过的东西不该每次切会话重打一遍', () => {
  const page = (over = {}) => ({content: 'abc', offset: 0, end: 3, remaining: 0, truncatedMore: false, stored: true, availableChars: 3, ...over});
  beforeEach(() => clearToolResultCache());

  test('同一 messageCode|ref 第二次零请求，且标明来自缓存', async () => {
    let calls = 0;
    const load = async () => { calls++; return page({}); };
    const a = await runToolResultFetch({load, messageCode: 'm1', ref: 'r1'});
    const b = await runToolResultFetch({load, messageCode: 'm1', ref: 'r1'});
    expect(a.outcome).toBe('complete');
    expect(b.outcome).toBe('complete');
    expect(calls).toBe(1);
    expect(b.pages).toBe(0);
    expect(b.text).toBe(a.text);
  });

  test('键不同就不共用：ref 不同、messageCode 不同都要重新取', async () => {
    let calls = 0;
    const load = async () => { calls++; return page({}); };
    await runToolResultFetch({load, messageCode: 'm1', ref: 'rA'});
    await runToolResultFetch({load, messageCode: 'm1', ref: 'rB'});
    await runToolResultFetch({load, messageCode: 'm2', ref: 'rA'});
    expect(calls).toBe(3);
  });

  test('失败不缓存：一次网络抖动不能被永久记住', async () => {
    let n = 0;
    const load = async () => { n++; if (n === 1) throw new Error('抖动'); return page({}); };
    const first = await runToolResultFetch({load, messageCode: 'mx', ref: 'rz'});
    const second = await runToolResultFetch({load, messageCode: 'mx', ref: 'rz'});
    expect(first.outcome).toBe('failed');
    expect(second.outcome).toBe('complete');
    expect(n).toBe(2);
  });

  test('stopped 不缓存（用户主动停的，下次要真的重取）', async () => {
    let n = 0;
    const load = async () => { n++; return page({truncatedMore: true, remaining: 9, end: 3}); };
    const a = await runToolResultFetch({load, messageCode: 'ms', ref: 'rs', shouldStop: () => n > 0});
    expect(a.outcome).toBe('stopped');
    const b = await runToolResultFetch({load, messageCode: 'ms', ref: 'rs'});
    expect(b.outcome).not.toBe('stopped');
    expect(n).toBeGreaterThan(1);
  });

  test('partial 不再"命中即返回"：第二次必须从断点续取（措辞叫用户再点，就得真能再点）', async () => {
    const seen: number[] = [];
    let calls = 0;
    const load = async (body: any) => {
      calls += 1;
      seen.push(body.offset);
      return page({content: 'z'.repeat(3), offset: body.offset, end: body.offset + 3, truncatedMore: true, remaining: 1234});
    };
    const a = await runToolResultFetch({load, messageCode: 'mp', ref: 'rp', maxPages: 1});
    const b = await runToolResultFetch({load, messageCode: 'mp', ref: 'rp', maxPages: 1});
    expect(a.outcome).toBe('partial');
    /** 断点由服务端的 end 给，不是自己按 content.length 累加 */
    expect(a.nextOffset).toBe(3);
    expect(b.outcome).toBe('partial');
    /** 改判前这条是 1（第二次命中缓存原样返回），而界面上还写着"可再次点击继续" */
    expect(calls).toBe(2);
    expect(seen).toEqual([0, 3]);
    /** 续取是累计，不是把同一页拼两遍 */
    expect(b.text).toBe('z'.repeat(6));
    expect(b.remaining).toBe(1234);
    expect(toolResultRunNote(b).indexOf('还有 1234 字未取回') > 0).toBe(true);
  });

  test('续取到完 ⇒ complete，正文不重复（partial 的缓存只当断点，不当答案）', async () => {
    const seen: number[] = [];
    const load = async (body: any) => {
      seen.push(body.offset);
      return body.offset === 0
        ? page({content: 'aaaa', offset: 0, end: 4, truncatedMore: true, remaining: 2})
        : page({content: 'bb', offset: 4, end: 6, truncatedMore: false, remaining: 0});
    };
    const a = await runToolResultFetch({load, messageCode: 'mr', ref: 'rr', maxPages: 1});
    const b = await runToolResultFetch({load, messageCode: 'mr', ref: 'rr', maxPages: 1});
    expect(a.outcome).toBe('partial');
    expect(b.outcome).toBe('complete');
    expect(b.text).toBe('aaaabb');
    expect(seen).toEqual([0, 4]);
  });
});

describe('toolResultNextAction：说的话与给的入口必须同批存在', () => {
  /**
   * @description 造一个取回结果
   * @param {Object} o 覆盖字段
   * @returns {ToolResultRun} 结果
   */
  const mk = (o: Partial<ToolResultRun>): ToolResultRun => ({
    outcome: 'complete', text: 'x', pages: 1, remaining: 0, error: '', stored: true, availableChars: 1, nextOffset: 1, ...o,
  });

  test('没点过 ⇒ 给"取回全文"', () => {
    expect(toolResultNextAction(null)).toEqual({show: true, label: '取回全文'});
  });

  test('complete ⇒ 不再留按钮：留着的按钮只会返回缓存，等于一个死入口', () => {
    expect(toolResultNextAction(mk({outcome: 'complete'})).show).toBe(false);
  });

  test('partial ⇒ 必须留按钮，并把剩余量写进标签', () => {
    const a = toolResultNextAction(mk({outcome: 'partial', remaining: 33214, text: 'x'.repeat(40000), error: 'max-pages'}));
    expect(a.show).toBe(true);
    expect(a.label).toBe('继续取回（还剩 33214 字）');
  });

  test('partial 但 remaining 未知 ⇒ 仍给按钮，只是不在标签里编数字', () => {
    expect(toolResultNextAction(mk({outcome: 'partial', remaining: 0, error: 'max-pages'})).label).toBe('继续取回');
  });

  test('failed 与 stopped ⇒ 给重试入口（这两种都不进缓存，点了是真取）', () => {
    expect(toolResultNextAction(mk({outcome: 'failed', error: 'no-progress'})).label).toBe('重新取回');
    expect(toolResultNextAction(mk({outcome: 'stopped', error: 'stopped'})).label).toBe('继续取回');
  });

  test('不变量：note 里叫用户"再点"的每一句，action 都必须给按钮', () => {
    const runs: ToolResultRun[] = [
      mk({outcome: 'partial', remaining: 1234, error: 'max-pages', text: 'z'.repeat(40000)}),
      mk({outcome: 'partial', remaining: 0, error: 'max-pages', text: 'z'.repeat(40000)}),
      mk({outcome: 'complete', text: 'x'.repeat(6554), pages: 2, remaining: 0, error: ''}),
      mk({outcome: 'complete', text: 'y'.repeat(1200), pages: 1, remaining: 0, error: '', stored: false, availableChars: 1200}),
      mk({outcome: 'failed', error: 'no-progress', remaining: 5}),
      mk({outcome: 'stopped', error: 'stopped', remaining: 5}),
    ];
    let 命中再点句子的条数 = 0;
    for (const run of runs) {
      const note = toolResultRunNote(run);
      if (/可再次点击继续/.test(note)) {
        命中再点句子的条数 += 1;
        expect(toolResultNextAction(run).show).toBe(true);
      }
    }
    /** 条件断言必须证明它真的跑到过，否则这条用例会空过 */
    expect(命中再点句子的条数).toBeGreaterThan(0);
  });
});

describe('toolResultDisplay：全文要真能看见，字数要真的是原文长度', () => {
  test('预算内原样给：不说量级、不给展开', () => {
    const d = toolResultDisplay({ held: '短正文' });
    expect(d.truncated).toBe(false);
    expect(d.note).toBe('');
    expect(d.expand.show).toBe(false);
    expect(d.sourceChars).toBe(3);
  });

  test('超预算 ⇒ 截断并说明"前 X 字共 N 字"，同时给出展开入口', () => {
    const held = 'x'.repeat(1000);
    const d = toolResultDisplay({ held });
    expect(d.truncated).toBe(true);
    expect(d.shownChars).toBe(PREVIEW_CHARS);
    expect(d.text.length).toBe(PREVIEW_CHARS);
    expect(d.note).toBe(`已显示前 ${PREVIEW_CHARS} 字，共 1000 字`);
    expect(d.expand.label).toBe('展开全部（1000 字）');
  });

  test('展开后显示全文，按钮变"收起"，不再说还剩多少', () => {
    const held = 'y'.repeat(1000);
    const d = toolResultDisplay({ held, expanded: true });
    expect(d.truncated).toBe(false);
    expect(d.note).toBe('');
    expect(d.shownChars).toBe(1000);
    expect(d.expand.label).toBe('收起');
  });

  test('取回过的正文优先于服务端预览（这才是"取回全文"该看到的东西）', () => {
    const d = toolResultDisplay({ held: 'ab', fetched: 'z'.repeat(700) });
    expect(d.sourceChars).toBe(700);
    expect(d.truncated).toBe(true);
  });

  test('取回结果反而更短时回落到预览，不用空串冒充', () => {
    const d = toolResultDisplay({ held: 'h'.repeat(50), fetched: 'x' });
    expect(d.sourceChars).toBe(50);
  });

  test('两个都空不抛，text 是空串', () => {
    const d = toolResultDisplay({});
    expect(d.text).toBe('');
    expect(d.expand.show).toBe(false);
  });

  test('非 JSON 原样显示（美化失败不许吞正文）', () => {
    expect(toolResultDisplay({ held: 'plain 正文 with spaces' }).text).toBe('plain 正文 with spaces');
    expect(prettyToolResultText('')).toBe('');
  });

  test('JSON 会被美化，但**报给用户的字数必须是原文长度**（"共 73340 字"那个假数字的根因）', () => {
    const raw2 = '{"a":"x","b":[1,2]}';
    const d = toolResultDisplay({ held: raw2 });
    expect(d.text.length).toBeGreaterThan(raw2.length);
    expect(d.sourceChars).toBe(raw2.length);
    expect(d.note).toBe('');
  });

  test('previewChars 可覆盖；0 与负数回落到默认', () => {
    const long = 'z'.repeat(1000);
    expect(toolResultDisplay({ held: long, previewChars: 10 }).shownChars).toBe(10);
    expect(toolResultDisplay({ held: long, previewChars: 0 }).shownChars).toBe(PREVIEW_CHARS);
    expect(toolResultDisplay({ held: long, previewChars: -5 }).shownChars).toBe(PREVIEW_CHARS);
    /** 短文本本来就不该被"显示 600 字"：shownChars 是 min(原文, 预算) */
    expect(toolResultDisplay({ held: 'z'.repeat(100) }).shownChars).toBe(100);
  });
});

describe('toolResultsDefaultOpen：少一次点击，但不换成一屏长文', () => {
  const mk = (n: number, truncatedAt: number[] = []) =>
    Array.from({length: n}, (_, i) => ({
      id: `c${i}`,
      name: `t${i}`,
      result: truncatedAt.includes(i) ? 'x'.repeat(4000) + '...[truncated]' : '短结果',
    }));

  test('1 次调用 ⇒ 展开这一条（这就是 P2 抱怨的那一次点击）', () => {
    expect(toolResultsDefaultOpen(mk(1))).toEqual(['c0']);
  });

  test('3 次调用 ⇒ 全展开（未超过 maxAutoExpand）', () => {
    expect(toolResultsDefaultOpen(mk(3))).toEqual(['c0', 'c1', 'c2']);
  });

  test('4 次调用且没有截断 ⇒ 只展开最后一条（长链路结论常在末尾）', () => {
    expect(toolResultsDefaultOpen(mk(4))).toEqual(['c3']);
  });

  test('6 次调用、其中两条被截断 ⇒ 展开的正是带取回入口的那两条，顺序保持', () => {
    const r = toolResultsDefaultOpen(mk(6, [1, 4]));
    expect(r).toEqual(['c1', 'c4']);
  });

  test('老形状用 tool_call_id 归因（与 resolveToolRef 同一口径）', () => {
    expect(toolResultsDefaultOpen([{tool_call_id: 'legacy1'}, {tool_call_id: 'legacy2'}, {tool_call_id: 'legacy3'}, {tool_call_id: 'legacy4'}]))
      .toEqual(['legacy4']);
  });

  test('没有 id 的条目回落到下标字符串，与 Collapse 的 key 形状一致', () => {
    expect(toolResultsDefaultOpen([{result: 'a'}, {result: 'b'}, {result: 'c'}, {result: 'd'}]))
      .toEqual(['3']);
  });

  test('空与非数组不抛', () => {
    expect(toolResultsDefaultOpen([])).toEqual([]);
    expect(toolResultsDefaultOpen(undefined as any)).toEqual([]);
    expect(toolResultsDefaultOpen([null, undefined] as any)).toEqual([]);
  });

  test('maxAutoExpand 可调；0 与负数回落到默认 3', () => {
    expect(toolResultsDefaultOpen(mk(2), {maxAutoExpand: 1})).toEqual(['c1']);
    expect(toolResultsDefaultOpen(mk(5), {maxAutoExpand: 5})).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(toolResultsDefaultOpen(mk(4), {maxAutoExpand: 0})).toEqual(['c3']);
  });

  test('长轮次里保证至少给一条展开（否则这特性等于没做）', () => {
    for (const n of [4, 6, 11]) {
      expect(toolResultsDefaultOpen(mk(n)).length).toBeGreaterThanOrEqual(1);
    }
  });
});
