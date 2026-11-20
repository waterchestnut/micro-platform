/**
 * @fileOverview 任务事件订阅的推进状态机（M1-c 刀 2 前端半区，纯件）
 * @module chatProviders/taskEventFlow
 * @description
 * 分工钉死（与 llm.api 双面契约同源）：**detail 是状态唯一源，事件只是提醒**。
 * 订阅面回帧 ⇒ onMilestoneHint / onSegmentEnd ⇒ 调用方立刻拉一次 detail——不拿事件
 * payload 演状态：事件帧是里程碑词表（subtask_done 带 usable 这类账目附件），detail 是
 * 账本全形（槽位/澄清/树账）；渲染事件形=第二套状态口径，双源必分叉（本仓对"实时流 vs
 * 档案回放"的账同一条病）。
 *
 * 三条降级纪律（服务端默认关时前端不许空转）：
 * 1. `no-client`/`unreadable`/`bad-cursor` = **服务端确定性说"事件面没有"** ⇒ 本视图
 *    永久停订阅（degraded latch）——不是网络抖动，重试不会变出账本来；
 * 2. 网络层失败（fetchEvents 回 null，形态不明）⇒ 退避重试，**连续 3 次 ⇒ 停**
 *    （观测面不可信就回纯 detail 轮询，拿 4s 节拍继续活着的是 TaskCard 本来的形态）；
 * 3. `timeout`/空窗 = 正常挂起未命中 ⇒ 带原游标继续（这正是长轮询的本意）。
 *
 * 游标只前进不回头（lastId 只在服务端给出更大值时更新）；end（段界）也提示——
 * "这一段直播到头了"本身就是最该立刻刷 detail 的里程碑。
 */

/** /eventsSubscribe 响应 data 形（llm.api d17158b 契约：与 /events 同五件） */
export type TaskEventsResp = {
  events: Array<{id: string; type: string; payload?: any}>;
  lastId: string;
  end: {id: string; outcome: string} | null;
  available: boolean;
  reason: string;
};

/** 确定性"事件面没有"的词（重试不会变出来，见文件头纪律 1） */
export const PERMANENT_OFF_REASONS = ['no-client', 'unreadable', 'bad-cursor'] as const;

export type WatcherDeps = {
  /** 一轮订阅（失败/非 0 信封 ⇒ null；抛错由 watcher 兜成 null 同路） */
  fetchEvents: (rootCode: string, lastId: string) => Promise<TaskEventsResp | null>;
  /** 里程碑提醒：调用方据此拉 detail（有帧或见到段界才来，空窗不敲钟） */
  onHint: (kind: 'milestone' | 'segment-end') => void;
  /** 每轮之间/退避的等待（注入计时原语：浏览器= setTimeout 包装，测试=可编程） */
  sleep: (ms: number) => Promise<void>;
  /** 停表判定（TaskCard 注入 ()=>stoppedRef.current||terminal：观测墙与终局同样终止订阅） */
  stopped: () => boolean;
  log?: (msg: string) => void;
};

export const WATCH_TICK_MS = 500;
export const WATCH_BACKOFF_MS = 4000;
export const WATCH_MAX_NET_FAILS = 3;

/**
 * @description 建订阅循环并立刻启动；返回 stop 句柄（卸载/终局/停表时调用）
 * @param {Object} deps WatcherDeps
 * @returns {{start: Function, stop: Function, snapshot: Function}}
 */
export function createTaskEventWatcher(deps: WatcherDeps) {
  const {fetchEvents, onHint, sleep, stopped, log} = deps;
  let cursor = '';
  let running = false;
  let netFails = 0;
  const state = {degraded: '', hints: 0, rounds: 0};

  async function loop(rootCode: string) {
    running = true;
    while (running && !stopped()) {
      state.rounds++;
      let resp: TaskEventsResp | null = null;
      try {
        resp = await fetchEvents(rootCode, cursor);
      } catch {
        resp = null; // 观测面抛=形态不明，走网络失败同路（不许掀调用方）
      }
      if (!running || stopped()) return;
      if (!resp) {
        netFails++;
        if (netFails >= WATCH_MAX_NET_FAILS) {
          state.degraded = 'net-fails';
          log?.('事件订阅连续失败，退回纯轮询');
          return;
        }
        await sleep(WATCH_BACKOFF_MS);
        continue;
      }
      if (PERMANENT_OFF_REASONS.includes(resp.reason as any)) {
        state.degraded = resp.reason; // 服务端确定性回答 ⇒ 本视图不再试
        log?.(`事件面不可用(${resp.reason})，退回纯轮询`);
        return;
      }
      netFails = 0;
      // 游标只前进：服务端每轮给了 lastId（无新帧时回带原值），取"非空且不同"即认
      if (resp.lastId && resp.lastId !== cursor) cursor = resp.lastId;
      if (resp.events?.length) {
        state.hints++;
        onHint('milestone');
      } else if (resp.end) {
        state.hints++;
        onHint('segment-end');
      }
      if (resp.end) return; // 段界=本段直播到头；下一段（clarify 答复后）由 detail 终局判定兜
      await sleep(WATCH_TICK_MS); // 命中后的下一轮挂起（帧与帧之间给 detail 留一拍）
    }
  }

  return {
    start(rootCode: string) {
      if (!rootCode || running) return;
      void loop(rootCode);
    },
    stop() { running = false; },
    snapshot: () => ({...state, cursor, netFails}),
  };
}

export default {createTaskEventWatcher, PERMANENT_OFF_REASONS, WATCH_TICK_MS, WATCH_BACKOFF_MS, WATCH_MAX_NET_FAILS};
