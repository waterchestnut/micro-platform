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
