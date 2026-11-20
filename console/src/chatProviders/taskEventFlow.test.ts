/**
 * taskEventFlow 状态机穷举（M1-c 刀 2 前端半区，纯件）。
 * 分工钉死（判据在此，组件只接线）：**detail 是状态唯一源，事件只是提醒**——
 * 订阅面回帧 ⇒ onHint ⇒ 调用方立刻拉 detail。渲染事件 payload = 第二套状态口径，
 * 双源必分叉（本仓"实时流 vs 档案回放"的账同一条病）。
 *
 * 三条降级纪律（服务端默认关时前端不许空转）：
 * 1. no-client/unreadable/bad-cursor = 服务端确定性说"事件面没有" ⇒ 永久停（latch）——
 *    不是网络抖动，重试不会变出账本来；
 * 2. fetch 回 null/抛（形态不明）⇒ 退避重试，连续 3 次 ⇒ 停，回纯轮询；
 * 3. timeout/空窗 = 正常挂起未命中 ⇒ 带原游标继续（长轮询的本意）。
 * 全程可编程 sleep 注入（wakeUp 手动放行），零真定时器。
 */
import {
  createTaskEventWatcher,
  PERMANENT_OFF_REASONS,
  WATCH_TICK_MS,
  WATCH_BACKOFF_MS,
  WATCH_MAX_NET_FAILS,
  type TaskEventsResp,
} from './taskEventFlow';

type Step = TaskEventsResp | null | 'throw';

const resp = (p: Partial<TaskEventsResp>): TaskEventsResp => ({
  events: [], lastId: '', end: null, available: true, reason: 'ok', ...p,
});
const ev = (n: number, type = 'milestone') => ({id: `1000-${n}`, type, payload: {}});
const frame = (n: number, extra: Partial<TaskEventsResp> = {}): TaskEventsResp => ({
  events: Array.from({length: n}, (_, i) => ev(i)), lastId: `1000-${n - 1}`,
  end: null, available: true, reason: 'ok', ...extra,
});

/** 可编程挂起：sleep 由测试手动放行（wakeUp），循环推进完全确定 */
function makeHarness(steps: Step[], opts: {stopped?: () => boolean} = {}) {
  const hints: Array<'milestone' | 'segment-end'> = [];
  const calls: string[] = [];
  const slept: number[] = [];
  let wake: (() => void) | null = null;
  let step = 0;
  const watcher = createTaskEventWatcher({
    fetchEvents: async (_rc, lastId) => {
      calls.push(lastId);
      const s = steps[Math.min(step++, steps.length - 1)];
      if (s === 'throw') throw new Error('network exploded');
      return s;
    },
    onHint: (kind) => hints.push(kind),
    sleep: (ms: number) => new Promise<void>((r) => { slept.push(ms); wake = r; }),
    stopped: () => (opts.stopped ? opts.stopped() : false),
  });
  const wakeUp = async () => { const w = wake; wake = null; if (w) { w(); await Promise.resolve(); await Promise.resolve(); } };
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  return {watcher, hints, calls, slept, wakeUp, settle};
}

describe('createTaskEventWatcher 敲钟与游标', () => {
  test('里程碑帧 ⇒ milestone、游标推进；timeout 空窗 ⇒ 不敲钟、游标不动（长轮询本意）', async () => {
    const h = makeHarness([frame(2), resp({reason: 'timeout'})]);
    h.watcher.start('r1');
    await h.settle();
    expect(h.hints).toEqual(['milestone']);
    expect(h.calls).toEqual(['']);
    // 提醒后 sleep(WATCH_TICK_MS) 续轮：第二轮带上一轮游标
    await h.wakeUp();
    expect(h.calls[1]).toBe('1000-1');
    expect(h.slept[0]).toBe(WATCH_TICK_MS);
    expect(h.hints).toEqual(['milestone']); // 空窗不敲钟
    await h.wakeUp();
    expect(h.calls[2]).toBe('1000-1'); // 空窗轮不得吞掉游标
    h.watcher.stop();
    await h.wakeUp();
  });

  test('段界 end：帧与段界同轮 ⇒ 只敲一次钟（detail 一拍覆盖两者）并终止；纯 end ⇒ segment-end 后终止', async () => {
    const h = makeHarness([frame(1, {end: {id: '1000-9', outcome: 'done'}})]);
    h.watcher.start('r1');
    await h.settle();
    expect(h.hints).toEqual(['milestone']);
    expect(h.watcher.snapshot().hints).toBe(1);
    h.watcher.stop();

    const h2 = makeHarness([resp({lastId: '1001-0', end: {id: '1001-0', outcome: 'synthesize'}})]);
    h2.watcher.start('r1');
    await h2.settle();
    expect(h2.hints).toEqual(['segment-end']);
    await h2.wakeUp(); // 段界后循环已终止——放行无害
    expect(h2.calls.length).toBe(1); // 不混下一段：零第二轮请求
  });

  test('游标只前进：服务端回空 lastId 不许清掉游标', async () => {
    const h = makeHarness([frame(1), resp({lastId: ''}), resp({lastId: ''})]);
    h.watcher.start('r1');
    await h.settle();
    await h.wakeUp();
    await h.wakeUp();
    expect(h.calls).toEqual(['', '1000-0', '1000-0']);
    h.watcher.stop();
  });

  test('start 幂等 + 缺 rootCode 不启动（没树可看就没有订阅者）', async () => {
    const h = makeHarness([resp({reason: 'timeout'})]);
    h.watcher.start('');
    expect(h.calls.length).toBe(0);
    h.watcher.start('r1');
    h.watcher.start('r1');
    await h.settle();
    expect(h.calls.length).toBe(1); // 只有一条循环
    h.watcher.stop();
    await h.wakeUp();
  });
});

describe('降级自治（服务端默认关不许前端空转）', () => {
  test.each([...PERMANENT_OFF_REASONS])('%s ⇒ 一轮即停 degraded latch（确定性词不重试轰炸）', async (reason) => {
    const h = makeHarness([resp({reason, available: false})]);
    h.watcher.start('r1');
    await h.settle();
    expect(h.watcher.snapshot().degraded).toBe(reason);
    await h.wakeUp();
    expect(h.calls.length).toBe(1);
  });

  test('网络形态不明（null/throw 同路）⇒ 退避节拍，连续 WATCH_MAX_NET_FAILS 次 ⇒ 停', async () => {
    const h = makeHarness([null, 'throw', null]);
    h.watcher.start('r1');
    await h.settle();
    expect(h.slept[0]).toBe(WATCH_BACKOFF_MS); // 失败轮是退避不是快轮
    await h.wakeUp(); await h.wakeUp(); await h.wakeUp();
    expect(h.watcher.snapshot().degraded).toBe('net-fails');
    expect(h.calls.length).toBe(WATCH_MAX_NET_FAILS); // 停后零请求：第 3 次失败即出清
  });

  test('网络失败中间成功一次 ⇒ 计数清零（不误停）', async () => {
    const h = makeHarness([null, frame(1), null, null]);
    h.watcher.start('r1');
    await h.settle();
    await h.wakeUp(); // 第 1 次 null 后继续 ⇒ 成功轮敲钟
    expect(h.hints).toEqual(['milestone']);
    await h.wakeUp(); // null #2（计数已被成功轮清零）
    await h.wakeUp(); // null #3
    await h.wakeUp(); // null #4 ⇒ 连续第 3 次失败才停
    expect(h.watcher.snapshot().degraded).toBe('net-fails');
  });

  test('fetchEvents 抛错不许掀循环（按网络失败计数走）', async () => {
    const h = makeHarness(['throw']);
    h.watcher.start('r1');
    await h.settle();
    expect(h.watcher.snapshot().netFails).toBe(1);
    expect(h.hints).toEqual([]);
    h.watcher.stop();
    await h.wakeUp();
  });

  test('stopped() 置位 ⇒ 下一轮入口出清，零新请求（停表/终局同路）', async () => {
    let stop = false;
    const h = makeHarness([resp({reason: 'timeout'})], {stopped: () => stop});
    h.watcher.start('r1');
    await h.settle();
    const c0 = h.calls.length;
    stop = true;
    await h.wakeUp();
    expect(h.calls.length).toBe(c0);
  });
});
