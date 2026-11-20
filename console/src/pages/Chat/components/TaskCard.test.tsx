/**
 * TaskCard 行为用例（M8 刀二）：轮询→渲染→终局停拍→正文替换→取消，全部**真跑**。
 * 判据本身（mapCardProgress 等）在 taskFlow.test.ts 已穷举——这里只钉"卡片把判据的结论
 * 说出来了、做错了动作"。
 * 组件零 services import、依赖全 props 注入——jest 的 esbuild transform **不提升 jest.mock**，
 * 组件里留真服务 default 时 mock 挂不上、umi 链先把套件炸掉（本仓实测 2026-11-18）。
 */
import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import TaskCard from './TaskCard';

const runningView = {
  phase: 'running',
  subtasks: [
    {agentCode: 'c1', title: '算术', phase: 'done', active: true, insertTime: '2026-11-18T00:00:00Z', updateTime: '2026-11-18T00:00:30Z'},
    {agentCode: 'c2', title: '资料', phase: 'running', active: true},
  ],
  usage: {tokens: 2400, credits: 2400},
  orchestration: {credits: {priced: false}},
};
const synthesizedView = {
  ...runningView,
  phase: 'synthesized',
  subtasks: runningView.subtasks.map((s) => ({...s, phase: 'done'})),
};

/** fake timers 下把"定时器推进 + 多级 promise 链（loadDetail→loadSynthesis）"都放干 */
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

describe('TaskCard 轮询与终局', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('首帧前说"进度查询中"；detail 拉不到不炸也不演进度', async () => {
    const loadDetail = jest.fn().mockResolvedValue(null);
    render(
      <TaskCard rootCode="r1" note="扇出已受理" loadDetail={loadDetail}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    expect(screen.getByText(/进度查询中/)).toBeTruthy();
  });

  test('running 帧：相位/进度/每槽状态/未计价标注都上屏；到 synthesized ⇒ 停轮询并读综合正文替换', async () => {
    const loadDetail = jest.fn()
      .mockResolvedValueOnce(runningView)
      .mockResolvedValue(synthesizedView);
    const loadSynthesis = jest.fn().mockResolvedValue('这是最终综合正文。');
    const bodySpy = jest.fn((t: string) => <div data-testid="body">{t}</div>);
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} loadSynthesis={loadSynthesis}
        cancelTask={jest.fn()} renderBody={bodySpy} intervalMs={100}/>,
    );
    await flush();
    expect(screen.getByText(/任务执行中（1\/2）/)).toBeTruthy();
    expect(screen.getByText(/算术（已完成，用时 30 秒）/)).toBeTruthy();
    expect(screen.getByText(/资料（执行中）/)).toBeTruthy();
    expect(screen.getByText(/未计价，=token 计数/)).toBeTruthy();
    // 终局帧：停轮询 + 卡内正文替换（"占位→替换"的展示层落地）
    await act(async () => { jest.advanceTimersByTime(100); });
    await flush();
    expect(screen.getByTestId('body').textContent).toContain('最终综合正文');
    expect(bodySpy).toHaveBeenCalledWith('这是最终综合正文。');
    const callsAtEnd = loadDetail.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(1000); });
    await flush();
    expect(loadDetail.mock.calls.length).toBe(callsAtEnd); // terminal ⇒ 不再打点
  });

  test('synthesized 但正文读不到 ⇒ 如实"未读到"，不拿标题凑正文', async () => {
    const loadDetail = jest.fn().mockResolvedValue(synthesizedView);
    const loadSynthesis = jest.fn().mockResolvedValue(null);
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} loadSynthesis={loadSynthesis}
        cancelTask={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    expect(screen.getByText(/综合已完成但未读到正文/)).toBeTruthy();
  });

  test('观测墙（排查刀 H）：非终局且过了 wallMs ⇒ 墙拍只停表不打点，说"超过观测时限"而不演失败', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        intervalMs={100} wallMs={50}/>,
    );
    await flush(); // 首拍（0ms<墙）正常打点
    expect(loadDetail.mock.calls.length).toBe(1);
    expect(screen.getByText(/任务执行中（1\/2）/)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(100); }); // 下一拍落在墙上（100>50）
    await flush();
    expect(screen.getByText(/超过观测时限/)).toBeTruthy();
    /** 状态头仍以最后一次 detail 事实渲染——停表是观测者声明，不是任务判决 */
    expect(screen.getByText(/任务执行中（1\/2）/)).toBeTruthy();
    expect(screen.queryByText(/任务失败|任务已完成/)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(2000); });
    await flush();
    expect(loadDetail.mock.calls.length).toBe(1); // 停表=真静默，之后零打点
  });

  test('终局回报 onSettled（排查刀 C 的清理钩子）：只在树到终局时报一次，非终局不报', async () => {
    const onSettled = jest.fn();
    const loadDetail = jest.fn().mockResolvedValue(synthesizedView);
    render(
      <TaskCard rootCode="r7" loadDetail={loadDetail} loadSynthesis={jest.fn().mockResolvedValue('正文')}
        cancelTask={jest.fn()} onSettled={onSettled} intervalMs={100}/>,
    );
    await flush();
    expect(onSettled).toHaveBeenCalledWith('r7');
    const loadDetailRunning = jest.fn().mockResolvedValue(runningView);
    const spy = jest.fn();
    render(
      <TaskCard rootCode="r8" loadDetail={loadDetailRunning} loadSynthesis={jest.fn()}
        cancelTask={jest.fn()} onSettled={spy} intervalMs={100} wallMs={200}/>,
    );
    await flush();
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();
    expect(spy).not.toHaveBeenCalled(); // 墙停表不是终局，不清账
  });

  test('取消：动作面如实（"已请求取消"而非"已停止"），按钮收掉，等待服务端下一拍', async () => {
    const cancelTask = jest.fn().mockResolvedValue({ok: true, msg: ''});
    render(
      <TaskCard rootCode="r9" loadDetail={jest.fn().mockResolvedValue(runningView)}
        cancelTask={cancelTask} loadSynthesis={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    const btn = screen.getByRole('button', {name: '取消任务'});
    await act(async () => { fireEvent.click(btn); });
    await flush();
    expect(cancelTask).toHaveBeenCalledWith('r9');
    expect(screen.getByText(/已请求取消：不再聚合结果/)).toBeTruthy();
    expect(screen.queryByRole('button', {name: '取消任务'})).toBeNull();
  });

  test('取消失败不演成功：回什么念什么，按钮不吞（可重试）', async () => {
    const cancelTask = jest.fn().mockResolvedValue({ok: false, msg: '任务不存在'});
    render(
      <TaskCard rootCode="r9" loadDetail={jest.fn().mockResolvedValue(runningView)}
        cancelTask={cancelTask} loadSynthesis={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: '取消任务'})); });
    await flush();
    expect(screen.getByText(/取消未生效：任务不存在/)).toBeTruthy();
    expect(screen.getByRole('button', {name: '取消任务'})).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* §7-1 澄清答复面：题目来自 detail.clarify（判据 pickClarify 已 golden 对拍），             */
/* 这里钉"卡片把题说了、答复动作如实、失败留门"。                                            */
/* ------------------------------------------------------------------ */
const awaitingView = {
  phase: 'awaiting_input',
  subtasks: [
    {agentCode: 'c1', title: '部署', phase: 'done', active: true},
    {agentCode: 'c2', title: '资料', phase: 'done', active: true},
  ],
  clarify: {
    requests: [{agentCode: 'c1', question: '部署到哪个环境？', options: ['生产', '预发'], title: '部署'}],
    capped: [{agentCode: 'c9', question: '更早的一个问题'}],
  },
};

describe('TaskCard 澄清答复（§7-1）', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('awaiting_input 帧：题目/选项/输入框/答复按钮上屏，capped 如实标注不再等待', async () => {
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        answerClarify={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    expect(screen.getByText(/任务待你补充（2\/2）/)).toBeTruthy();
    expect(screen.getByText(/部署：部署到哪个环境？/)).toBeTruthy();
    // antd 双中文字按钮会插空格（"生 产"/"答 复"）——name 一律用 \s* 容忍形
    expect(screen.getByRole('button', {name: /^生\s*产$/})).toBeTruthy();
    expect(screen.getByRole('button', {name: /^答\s*复$/})).toBeTruthy();
    expect(screen.getByText(/更早的一个问题（澄清次数到上限，已不再等待答复）/)).toBeTruthy();
  });

  test('没注入 answerClarify ⇒ 出题但明说"暂不支持答复"（不演按不动的按钮）', async () => {
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} intervalMs={100}/>,
    );
    await flush();
    expect(screen.getByText(/该入口暂不支持答复/)).toBeTruthy();
    expect(screen.queryByRole('button', {name: '答复'})).toBeNull();
  });

  test('答复成功：调用形状对、回执说"转起来了"、草稿清空（题的消失等服务端下一拍，不自演）', async () => {
    const answerClarify = jest.fn().mockResolvedValue({ok: true, msg: '', data: {requeued: ['c1']}});
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} answerClarify={answerClarify} intervalMs={100}/>,
    );
    await flush();
    const input = screen.getByPlaceholderText('你的答复');
    await act(async () => { fireEvent.change(input, {target: {value: '用生产，窗口周五'}}); });
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /^答\s*复$/})); });
    await flush();
    expect(answerClarify).toHaveBeenCalledWith('r1', [{agentCode: 'c1', response: '用生产，窗口周五'}]);
    expect(screen.getByText(/已答复：子任务将带着补充重跑/)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  test('选项点击=填草稿（答复按钮从 disabled 变可用）', async () => {
    const answerClarify = jest.fn().mockResolvedValue({ok: true, msg: '', data: {requeued: ['c1']}});
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} answerClarify={answerClarify} intervalMs={100}/>,
    );
    await flush();
    const btn = screen.getByRole('button', {name: /^答\s*复$/});
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /^预\s*发$/})); });
    expect((screen.getByRole('button', {name: /^答\s*复$/}) as HTMLButtonElement).disabled).toBe(false);
  });

  test('答复失败不演成功：念回执、草稿留着（同 cancel 的门）', async () => {
    const answerClarify = jest.fn().mockResolvedValue({ok: false, msg: '该任务当前没有待答的澄清'});
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} answerClarify={answerClarify} intervalMs={100}/>,
    );
    await flush();
    const input = screen.getByPlaceholderText('你的答复');
    await act(async () => { fireEvent.change(input, {target: {value: '答案'}}); });
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /^答\s*复$/})); });
    await flush();
    expect(screen.getByText(/答复未被接受：该任务当前没有待答的澄清/)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('答案');
  });

  test('ok 但 requeued 不含本题 ⇒ 说"收下但未转成重派"（回执语义逐字对齐端点 data）', async () => {
    const answerClarify = jest.fn().mockResolvedValue({ok: true, msg: '', data: {requeued: [], missing: ['c1']}});
    render(
      <TaskCard rootCode="r1" loadDetail={jest.fn().mockResolvedValue(awaitingView)}
        cancelTask={jest.fn()} loadSynthesis={jest.fn()} answerClarify={answerClarify} intervalMs={100}/>,
    );
    await flush();
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('你的答复'), {target: {value: 'x'}}); });
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: /^答\s*复$/})); });
    await flush();
    expect(screen.getByText(/答复已收下，但未能转成重派/)).toBeTruthy();
  });
});

/**
 * M1-c 刀 2 行为面（本轮补账）：事件提醒接线——上轮接线批的测试没落账，
 * 这组用例把"事件只敲钟、detail 才是状态源"钉死。
 */
describe('TaskCard 事件提醒（刀 2）', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('里程碑帧 ⇒ 事件循环启动且 detail 打过点；空窗与 no-client 后 latch 停（不重试轰炸）', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    const subscribeEvents = jest.fn()
      .mockResolvedValueOnce({events: [{id: '1-0', type: 'subtask_done'}], lastId: '1-0', end: null, available: true, reason: 'ok'})
      .mockResolvedValueOnce({events: [], lastId: '1-0', end: null, available: true, reason: 'timeout'})
      .mockResolvedValue({events: [], lastId: '', end: null, available: false, reason: 'no-client'});
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        subscribeEvents={subscribeEvents} intervalMs={10000}/>,
    );
    await flush();
    // flush 放掉了全部定时器（含 10s 轮询拍）——绝对数不可比；可证的是事件循环真启动，
    // 且里程碑敲钟让 detail 至少多打了一次点（首拍之外）
    expect(subscribeEvents.mock.calls.length >= 1).toBe(true);
    expect(loadDetail.mock.calls.length >= 2).toBe(true);
    await act(async () => { jest.advanceTimersByTime(30000); });
    await flush();
    // no-client 是确定性词 ⇒ 3 次调用封顶（ok 轮 + timeout 轮 + no-client 轮），之后永久静默
    expect(subscribeEvents.mock.calls.length <= 3).toBe(true);
  });

  test('事件面没开（no-client）⇒ 一轮 latch 停，轮询照常且零重试轰炸', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    const subscribeEvents = jest.fn().mockResolvedValue({events: [], lastId: '', end: null, available: false, reason: 'no-client'});
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        subscribeEvents={subscribeEvents} intervalMs={200}/>,
    );
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(1); // 恰好一轮
    await act(async () => { jest.advanceTimersByTime(5000); }); // watcher 退避节拍（4s）到点也不该再试
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(1); // latch 生效：服务端说不二意
    expect(loadDetail.mock.calls.length >= 2).toBe(true); // 轮询不受影响
  });

  test('网络失败（null）⇒ 退避重试，连续 3 次停回纯轮询（不掀组件）', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    const subscribeEvents = jest.fn().mockResolvedValue(null);
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        subscribeEvents={subscribeEvents} intervalMs={10000}/>,
    );
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(1);
    await act(async () => { jest.advanceTimersByTime(4100); }); // 退避 4s 后第 2 次
    await flush();
    await act(async () => { jest.advanceTimersByTime(4100); }); // 第 3 次 ⇒ 停
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(3); // 恰好三次，不多打
    await act(async () => { jest.advanceTimersByTime(9000); });
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(3); // 停后再无请求
    expect(screen.getByText(/任务执行中/)).toBeTruthy(); // 组件无恙
  });

  test('卸载 ⇒ watcher 出清，事件不再被叫（订阅泄漏钉死）', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    const subscribeEvents = jest.fn().mockResolvedValue({events: [], lastId: '', end: null, available: true, reason: 'timeout'});
    const {unmount} = render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()}
        subscribeEvents={subscribeEvents} intervalMs={200}/>,
    );
    await flush();
    const at = subscribeEvents.mock.calls.length;
    unmount();
    await act(async () => { jest.advanceTimersByTime(20000); });
    await flush();
    expect(subscribeEvents.mock.calls.length).toBe(at); // 卸载后零请求
  });

  test('不给 subscribeEvents ⇒ watcher 不存在，行为与刀 2 之前逐字节相同（默认关纪律）', async () => {
    const loadDetail = jest.fn().mockResolvedValue(runningView);
    render(
      <TaskCard rootCode="r1" loadDetail={loadDetail} cancelTask={jest.fn()} loadSynthesis={jest.fn()} intervalMs={200}/>,
    );
    await flush();
    await act(async () => { jest.advanceTimersByTime(600); });
    await flush();
    expect(loadDetail.mock.calls.length >= 2).toBe(true); // 纯轮询照常
  });
});
