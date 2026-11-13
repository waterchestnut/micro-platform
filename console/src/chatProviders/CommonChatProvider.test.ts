import CommonChatProvider, { CHAT_PROTOCOL, type CommonChatMessage } from './CommonChatProvider';

/**
 * Provider 的事件分派契约（协议 3）。
 *
 * 为什么值得单独测：`transformMessage` 是**唯一**把 SSE 帧翻成前端状态的地方，
 * 而它原先 `default:` 与 `delta` 共用分支——意思是"服务端每加一种事件，前端就多一种
 * 把结构体当答案拼进正文的风险"。加 `segment_*` 时不改这条就是已知缺陷撞上新事件。
 */

/**
 * @description 造一个只用来驱动 transformMessage 的 provider（不需要真请求）
 * @returns {CommonChatProvider} 实例
 */
function mkProvider() {
  /**
   * `AbstractChatProvider` 的构造函数会校验 `config.request.manual`
   * （见 SDK `AbstractChatProvider.js:14-21`），所以桩必须带上它——
   * 少了这个字段整套用例根本跑不起来，报的还是"request must be manual"这种离题的话。
   */
  const request = {
    manual: true,
    options: { callbacks: undefined },
    abort: () => {},
    addListener: () => ({}),
  };
  return new CommonChatProvider({ request: request as any });
}

/**
 * @description 喂一帧给 provider
 * @param {any} provider 实例
 * @param {Object} chunk SSE 帧
 * @param {CommonChatMessage} [origin] 上一状态
 * @returns {CommonChatMessage} 新状态
 */
function feed(provider: any, chunk: any, origin?: CommonChatMessage): CommonChatMessage {
  return provider.transformMessage({
    originMessage: origin,
    chunk,
    chunks: [chunk],
    status: 'loading',
    responseHeaders: new Headers(),
  });
}

describe('协议 3 的段事件', () => {
  const provider = mkProvider();

  test('segment_start / segment_end 只动 segments，绝不污染正文', () => {
    let m = feed(provider, { event: 'delta', data: JSON.stringify({ content: '答案' }) }) as any;
    expect(m.content).toBe('答案');
    m = feed(
      provider,
      {
        event: 'segment_start',
        data: JSON.stringify({
          seq: 1,
          kind: 'tool-round',
          category: 'tools',
          title: '调用 1 个工具',
        }),
      },
      m,
    ) as any;
    expect(m.segments).toHaveLength(1);
    /** 段事件只该动 segments，不该碰已经流出来的正文 */
    expect(m.content).toBe('答案');
    m = feed(
      provider,
      {
        event: 'segment_end',
        data: JSON.stringify({
          seq: 1,
          kind: 'tool-round',
          category: 'tools',
          metrics: { chars: 35, toolCount: 1, ms: 1635 },
          truncated: false,
          ref: null,
        }),
      },
      m,
    ) as any;
    expect(m.segments).toHaveLength(1);
    expect(m.segments[0].open).toBe(false);
    expect(m.content).toBe('答案');
  });

  test('data 不是 JSON 时原样返回（服务端出错帧就是纯文本）', () => {
    const m = feed(provider, { event: 'segment_end', data: 'boom' }) as any;
    expect(m.segments).toBeUndefined();
  });
});

describe('未知事件名不得并入正文（这是 default 曾与 delta 共用分支的那个缺陷）', () => {
  const provider = mkProvider();

  test('未来新增的事件名 ⇒ 状态不变、正文不追加', () => {
    let m = feed(provider, {
      event: 'delta',
      data: JSON.stringify({ content: '原话' }),
      id: '1',
    }) as any;
    for (const ev of ['artifact', 'digest', 'await_input', 'steer', 'totally_new_event']) {
      const next = feed(
        provider,
        { event: ev, data: JSON.stringify({ content: '不该出现', kind: 'x' }) },
        m,
      ) as any;
      expect(next.content).toBe('原话');
      expect(next.segments).toBeUndefined();
    }
  });
});

/**
 * 模板版与母本的差异只有一处：删掉了 `describe('id: 游标（续接的唯一凭据）')` 整块（母本 116–169 行）。
 * 为什么删而不是"顺手也接上"：本模板没有断线续接（没有 `resume.ts`，provider 也不记 `lastSeq`），
 * 那些断言在这里必红；而为了让它们变绿去存一个没有消费者的游标，等于用测试倒逼一个不存在的功能。
 * 保留的每一段都逐字来自母本同文件（脚本按行切片，不是手抄），完整契约以母本那份为准。
 */

describe('协商值与分支必须同批存在', () => {
  test('协议常量是 3（翻这个数的前提是本文件已有 segment_* 分支与"未知事件忽略"的兜底）', () => {
    expect(CHAT_PROTOCOL).toBe(3);
  });
});

describe('meta 里的 runOverlap 必须进 process（P5 在实时那一轮说话的前提）', () => {
  /**
   * 为什么单独测这个：provider 的 meta 分支是**白名单**——服务端新加的键不写在这里就收不到，
   * 症状与"服务端根本没发"一模一样（2026-11-13 实测：档案有 runOverlap、实时界面不说、
   * 重新进入会话才说）。两侧必须同一轮改，所以这一侧也得有用例钉住，不然改完还是哑的。
   */
  const provider = mkProvider();

  test('meta 带 runOverlap ⇒ 原样放进 process.runOverlap（给事实，不给措辞）', () => {
    const m = feed(provider, {
      event: 'meta',
      data: JSON.stringify({
        type: 'meta',
        messageCode: 'MC-1',
        protocol: 2,
        runOverlap: {prevMessageCode: 'MC-0', prevAgeMs: 2582, contextMissing: true, reason: 'stale-open-run'},
      }),
    }) as any;
    expect(m.process.runOverlap).toEqual({prevMessageCode: 'MC-0', prevAgeMs: 2582, contextMissing: true, reason: 'stale-open-run'});
  });

  test('meta 没带（旧服务端）⇒ 键存在且是 null：缺键与"确认没有重叠"必须分得开', () => {
    const m = feed(provider, {event: 'meta', data: JSON.stringify({type: 'meta', messageCode: 'MC-2', protocol: 2})}) as any;
    expect('runOverlap' in m.process).toBe(true);
    expect(m.process.runOverlap).toBeNull();
  });

  test('显式 null 之后再来 delta 帧也不许被冲成 undefined', () => {
    let m = feed(provider, {event: 'meta', data: JSON.stringify({type: 'meta', messageCode: 'MC-3', protocol: 2, runOverlap: null})}) as any;
    expect(m.process.runOverlap).toBeNull();
    m = feed(provider, {event: 'delta', data: JSON.stringify({content: '答'})}, m) as any;
    expect(m.process.runOverlap).toBeNull();
  });
});
