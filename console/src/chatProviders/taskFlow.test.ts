/**
 * 任务受理信封判据（taskFlow）+ 分流包装（taskFlowFetch）的用例。
 *
 * 两件事分开测：判据是穷举（golden 向量与 callin.console `llmTaskFlow.test.ts` 对拍——
 * 两仓各自独立实现同一契约，向量改动必须两边同步，这是 researchQuery 跨仓镜像的同款纪律）；
 * 包装件是**行为真跑**（真 Response 字节进、信号/透传出），不是读源码文本。
 * 信封 fixture 用 dev 探针 `queue-full-4292-e2e-probe` 的真实读数形状，不凭空造。
 */
import {
  matchTaskAccepted,
  matchQueuedAccepted,
  makeTaskFlowError,
  readTaskFlowError,
  taskFlowNoteText,
  phaseText,
  mapCardProgress,
  groupSlots,
  elapsedText,
  pickLatestAnswer,
  isTaskTreeTerminal,
  TASK_FLOW_TERMINAL_PHASES,
} from './taskFlow';
import {makeFetchWithTaskFlow} from './taskFlowFetch';

const accepted = (data: any = {}) => ({
  success: true,
  code: 0,
  msg: '',
  data: {taskAccepted: true, rootCode: 'r-1', subtasks: [{title: 'T1', query: 'q1'}], ...data},
});

describe('matchTaskAccepted（golden 与 callin 母本对拍）', () => {
  test('严格受理形状 ⇒ rootCode+subtasks', () => {
    const t = matchTaskAccepted(accepted());
    expect(t).toEqual({rootCode: 'r-1', subtasks: [{title: 'T1', query: 'q1'}]});
  });
  test('success:false / taskAccepted 非严格 true / rootCode 空白 ⇒ 全 null（不猜受理）', () => {
    expect(matchTaskAccepted({...accepted(), success: false})).toBeNull();
    expect(matchTaskAccepted({success: true, data: {taskAccepted: 'true', rootCode: 'r'}})).toBeNull();
    expect(matchTaskAccepted({success: true, data: {taskAccepted: true, rootCode: '  '}})).toBeNull();
    expect(matchTaskAccepted({success: true, data: {taskAccepted: true}})).toBeNull();
    expect(matchTaskAccepted(null)).toBeNull();
  });
  test('subtasks 脏项清洗：无 query 的行丢弃；缺 title 从 query 截 24；duplicate 只在 true 时出现', () => {
    const t = matchTaskAccepted(accepted({
      subtasks: [{query: '很长很长的问题描述abcdefg'}, {title: 'T'}, null, 3],
      duplicate: true,
    }));
    expect(t!.subtasks).toEqual([{title: '很长很长的问题描述abcdefg', query: '很长很长的问题描述abcdefg'}]);
    expect(t!.duplicate).toBe(true);
    expect(matchTaskAccepted(accepted())!.duplicate).toBeUndefined();
  });
});

describe('matchQueuedAccepted（排队=已受理，既非拆树也非错误）', () => {
  const queued = (data: any) => ({success: true, code: 0, msg: '', data: {queued: true, ...data}});
  test('queued+rootCode+位次 ⇒ 如实；idempotent 透传', () => {
    expect(matchQueuedAccepted(queued({rootCode: 'r1', queuePosition: 3}))).toEqual({rootCode: 'r1', queuePosition: 3});
    expect(matchQueuedAccepted(queued({rootCode: 'r1', queuePosition: 1, idempotent: true}))!.idempotent).toBe(true);
  });
  test('位次缺席/0/负/非数 ⇒ null——不知道排第几就只说已排队，不猜第 1 位', () => {
    expect(matchQueuedAccepted(queued({rootCode: 'r1'}))!.queuePosition).toBeNull();
    expect(matchQueuedAccepted(queued({rootCode: 'r1', queuePosition: 0}))!.queuePosition).toBeNull();
    expect(matchQueuedAccepted(queued({rootCode: 'r1', queuePosition: -2}))!.queuePosition).toBeNull();
    expect(matchQueuedAccepted(queued({rootCode: 'r1', queuePosition: 'x'}))!.queuePosition).toBeNull();
  });
  test('4292 拒绝体（success:false）与其他形状 ⇒ null 走既有拒绝通道', () => {
    expect(matchQueuedAccepted({success: false, code: 4292, message: '当前会话排队已满，请稍后再发起'})).toBeNull();
    expect(matchQueuedAccepted(queued({queued: 'true', rootCode: 'r1'}))).toBeNull();
    expect(matchQueuedAccepted(queued({rootCode: '  '}))).toBeNull();
    expect(matchQueuedAccepted(null)).toBeNull();
  });
});

describe('makeTaskFlowError / readTaskFlowError（信号要双向可辨且防伪）', () => {
  test('往返一致', () => {
    const e = makeTaskFlowError('queued', {rootCode: 'r1', queuePosition: 2});
    expect(readTaskFlowError(e)).toEqual({kind: 'queued', payload: {rootCode: 'r1', queuePosition: 2}});
  });
  test('防撞名：name 对但 payload 缺/坏 ⇒ null（宁可退回通用文案，不演"已受理"）', () => {
    expect(readTaskFlowError({name: 'TaskQueued'})).toBeNull();
    expect(readTaskFlowError({name: 'TaskQueued', taskFlow: {kind: 'queued', payload: {rootCode: ''}}})).toBeNull();
    expect(readTaskFlowError({name: 'TaskQueued', taskFlow: {kind: 'accepted', payload: {rootCode: 'r'}}})).toBeNull();
    expect(readTaskFlowError(new Error('boom'))).toBeNull();
    expect(readTaskFlowError(null)).toBeNull();
  });
});

describe('taskFlowNoteText（每句话只承诺信封里有的事实）', () => {
  test('queued：有位次报位次；idempotent 加"并入同一排队轮"；无位次不提数字', () => {
    expect(taskFlowNoteText('queued', {rootCode: 'r', queuePosition: 3})).toContain('第 3 位');
    expect(taskFlowNoteText('queued', {rootCode: 'r', queuePosition: 2, idempotent: true})).toContain('并入同一排队轮');
    const t = taskFlowNoteText('queued', {rootCode: 'r', queuePosition: null});
    expect(t).toContain('已排队');
    expect(t).not.toMatch(/第 \d+ 位/);
  });
  test('accepted：说有几个子任务；不承诺"结果会出现在这里"（综合不回填聊天线是既拍板，展示层属刀二）', () => {
    const t = taskFlowNoteText('accepted', {rootCode: 'r', subtasks: [{title: 'a', query: 'q'}]});
    expect(t).toContain('1 个子任务');
    expect(t).not.toMatch(/将出现在|会显示在这条/);
  });
});

describe('makeFetchWithTaskFlow（行为真跑：按 fetch 契约的响应替身进，信号/透传出）', () => {
  /**
   * jsdom 无 fetch/Response（resumeStream.test 同款处置：环境替身而非降级断言）。
   * 替身按本包装**真正消费的契约面**做：ok/headers.get/clone().json——
   * 并带 bodyUsed 计数器：`clone()` 后原 body 必须仍可整体读一次，
   * 这是"peek 不许吃流"这条纪律的可执行形态。
   */
  const makeResp = (bodyText: string, contentType: string, status = 200) => {
    const resp: any = {
      ok: status >= 200 && status < 300,
      status,
      headers: {get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null)},
      __reads: 0,
      json() { this.__reads++; return Promise.resolve(JSON.parse(bodyText)); },
      text() { this.__reads++; return Promise.resolve(bodyText); },
    };
    resp.clone = () => { const c = makeResp(bodyText, contentType, status); c.__reads = resp.__reads; return c; };
    return resp;
  };
  const jsonResp = (obj: any) => makeResp(JSON.stringify(obj), 'application/json; charset=utf-8');
  const sseResp = () => makeResp('id: 1\nevent: meta\ndata: {"messageCode":"m"}\n\n', 'text/event-stream');

  test('扇出受理信封 ⇒ 抛 TaskAccepted 信号（带 payload）', async () => {
    const f = makeFetchWithTaskFlow(async () => jsonResp(accepted()));
    await expect(f('u', {})).rejects.toMatchObject({name: 'TaskAccepted'});
  });
  test('排队信封 ⇒ 抛 TaskQueued；idempotent 命中同样走信号不误走错误面', async () => {
    const f = makeFetchWithTaskFlow(async () => jsonResp({success: true, data: {queued: true, rootCode: 'r', queuePosition: 1, idempotent: true}}));
    await expect(f('u', {})).rejects.toMatchObject({name: 'TaskQueued'});
  });
  test('SSE 原样透传；拒绝体（success:false）透传且 peek 不吃 body（json 仍可整体读）', async () => {
    const sse = sseResp();
    const r1: any = await makeFetchWithTaskFlow(async () => sse)('u', {});
    expect(r1).toBe(sse);
    expect(await r1.text()).toContain('event: meta');
    expect(r1.__reads).toBe(1); // peek 的消耗没记在原响应头上（clone 是替身，原 body 未被碰）
    const rej = jsonResp({success: false, code: 4292, message: '当前会话排队已满，请稍后再发起'});
    const r2: any = await makeFetchWithTaskFlow(async () => rej)('u', {});
    const j2 = await r2.json();
    expect(j2.code).toBe(4292); // 下游（jsonResponseHandler）仍读得到完整拒绝体
    expect(r2.__reads).toBe(1);
  });
  test('坏 JSON（content-type 说是 json 但体不是）⇒ 不炸主流，原样放行', async () => {
    const bad = makeResp('<not json>', 'application/json');
    const r: any = await makeFetchWithTaskFlow(async () => bad)('u', {});
    expect(r).toBe(bad);
  });
});

/* ------------------------------------------------------------------ */
/* 跨仓镜像 golden 向量（与 callin.console `tests/researchTaskFlow.test.ts` 同契约）。      */
/* 两仓各自独立实现，**行为必须逐条一致**——增删相位语义先改 llm.api 单源，再同步两边向量。  */
/* ------------------------------------------------------------------ */

describe('phaseText（golden 对拍）', () => {
  test('root+child 相位并表有人话；未收录值绝不猜', () => {
    expect(phaseText('synthesizing')).toBe('收尾中');
    expect(phaseText('done')).toBe('已完成');
    expect(phaseText('done-with-error')).toBe('完成（有异常）');
    expect(phaseText('whatever-new')).toBe('状态未知');
    expect(phaseText(undefined)).toBe('状态未知');
  });
});

describe('mapCardProgress（golden 对拍）', () => {
  test('null/坏值不炸；进度只数 active；done/failed 都算跑完一格', () => {
    expect(mapCardProgress(null)).toBeNull();
    expect(mapCardProgress('junk' as any)).toBeNull();
    const m = mapCardProgress({
      phase: 'running',
      subtasks: [
        {title: 'A', phase: 'done', active: true},
        {title: 'A旧', phase: 'failed', active: false},
        {title: 'B', phase: 'failed', active: true},
      ],
    })!;
    expect(m.total).toBe(2);
    expect(m.doneCount).toBe(2); // done 与 failed 都是"这一格跑完了"
    expect(m.failedCount).toBe(1);
  });
  test('树账三值：creditsPriced false=未计价（渲染层标注），缺 orchestration ⇒ undefined 不装钱也不装免费', () => {
    const m = mapCardProgress({
      phase: 'running', subtasks: [], usage: {tokens: 1177, credits: 1177}, orchestration: {credits: {priced: false}},
    })!;
    expect(m.tokens).toBe(1177);
    expect(m.creditsPriced).toBe(false);
    expect(mapCardProgress({phase: 'running', subtasks: []})!.creditsPriced).toBeUndefined();
  });
  test('cancelled 双源（phase 或 orchestration.cancelled 任一真即真，与 taskPhase 优先级同源）', () => {
    expect(mapCardProgress({phase: 'cancelled', subtasks: []})!.cancelled).toBe(true);
    expect(mapCardProgress({phase: 'running', subtasks: [], orchestration: {cancelled: true}})!.cancelled).toBe(true);
  });
});

describe('groupSlots / elapsedText / pickLatestAnswer / isTaskTreeTerminal（golden 对拍）', () => {
  const T = (h: number) => `2026-11-18T0${h}:00:00Z`;
  test('同槽重试：current=active，history 装被取代的；无 active ⇒ current=null 不拿末行冒充', () => {
    const g = groupSlots([
      {agentCode: 'a1', slot: 's1', active: false, insertTime: T(1)},
      {agentCode: 'a2', slot: 's1', active: true, insertTime: T(2)},
    ]);
    expect(g[0].current!.agentCode).toBe('a2');
    expect(g[0].attempts).toBe(2);
    const noActive = groupSlots([{agentCode: 'b', slot: 's2', active: false, insertTime: T(1)}]);
    expect(noActive[0].current).toBeNull();
    expect(noActive[0].history).toHaveLength(1);
  });
  test('用时只对终局行说真话；非终局/倒挂/缺失 ⇒ null', () => {
    expect(elapsedText({phase: 'done', insertTime: T(0), updateTime: '2026-11-18T00:00:45Z'})).toBe('45 秒');
    expect(elapsedText({phase: 'running', insertTime: T(0), updateTime: T(1)})).toBeNull();
    expect(elapsedText({phase: 'done', insertTime: T(1), updateTime: T(0)})).toBeNull();
    expect(elapsedText(null)).toBeNull();
  });
  test('末条非空 answer 倒序取；全空 ⇒ null 不演正文', () => {
    expect(pickLatestAnswer([{answer: '旧'}, {answer: '  '}, {answer: '新', messageCode: 'm'}])).toEqual({text: '新', msgCode: 'm'});
    expect(pickLatestAnswer([])).toBeNull();
  });
  test('终局集穷举 + synthesizing 不在列（"收尾中"是最要盯的窗口）', () => {
    expect(TASK_FLOW_TERMINAL_PHASES).toEqual(['synthesized', 'partial', 'failed', 'cancelled']);
    expect(isTaskTreeTerminal({phase: 'synthesizing'})).toBe(false);
    expect(isTaskTreeTerminal({phase: 'partial'})).toBe(true);
    expect(isTaskTreeTerminal(null)).toBe(false);
    expect(mapCardProgress({phase: 'failed', subtasks: []})!.terminal).toBe(true);
  });
});

/* ---- 排查刀 C：在途任务续跟进账目（pending 条目判据） ---- */
import {upsertPendingTask, removePendingTask, shouldDropPendingTask, pendingTreeTerminalFromView, type PendingTaskEntry} from './taskFlow';

const pend = (over: Partial<PendingTaskEntry> = {}): PendingTaskEntry => ({
  kind: 'queued', rootCode: 'r1', messageCode: 'm1', note: '已排队', startedAt: 1, ...over,
});

describe('pending task 账目判据', () => {
  test('upsert 幂等：同 rootCode 只留最早一条（重发不堆重复跟进气泡）', () => {
    const l = upsertPendingTask([pend()], pend({startedAt: 999}));
    expect(l).toHaveLength(1);
    expect(l[0].startedAt).toBe(1);
    const l2 = upsertPendingTask(l, pend({rootCode: 'r2'}));
    expect(l2).toHaveLength(2);
  });
  test('upsert 洗脏行（无 rootCode 的条目不进账）；remove 只销指定根', () => {
    const dirty = upsertPendingTask([pend(), {note: 'x'} as any, null as any], pend({rootCode: 'r9'}));
    expect(dirty.every((e) => e.rootCode)).toBe(true);
    expect(removePendingTask(dirty, 'r1').map((e) => e.rootCode)).toEqual(['r9']);
  });
  test('shouldDrop 只认事实：queued 兑现（档案同码行出现）才销；未兑现保留', () => {
    expect(shouldDropPendingTask(pend(), {archivedMessageCodes: ['m1', 'm0']})).toBe(true);
    expect(shouldDropPendingTask(pend(), {archivedMessageCodes: []})).toBe(false);
    // 无 messageCode 的条目永远不算兑现（"没码可查"不许猜成已归档）
    expect(shouldDropPendingTask(pend({messageCode: ''}), {archivedMessageCodes: ['x']})).toBe(false);
  });
  test('accepted：detail 终局才销；"读不到"不构成删除理由（观测失败不动账目）', () => {
    const a = pend({kind: 'accepted'});
    expect(shouldDropPendingTask(a, {treeTerminal: true})).toBe(true);
    expect(shouldDropPendingTask(a, {treeTerminal: false})).toBe(false);
    expect(shouldDropPendingTask(a, {})).toBe(false);
    expect(pendingTreeTerminalFromView(null)).toBe(false);
    expect(pendingTreeTerminalFromView({phase: 'cancelled'})).toBe(true);
  });
});
