/**
 * RunStatusBar 渲染（刀 C）。判据在 runStatus.test 穷举；这里钉映射：忙碌出计时、
 * canStop 才出停止钮、会话徽标读得到用标题、读不到退 code 前缀。
 */
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import RunStatusBar from './RunStatusBar';
import type {RunStatus} from '@/chatProviders/runStatus';

const gen: RunStatus = {phase: 'generating', label: '正在生成回答', busy: true, canStop: true};
const idle: RunStatus = {phase: 'idle', label: '就绪', busy: false, canStop: false};
const resuming: RunStatus = {phase: 'generating', label: '正在续接回答', busy: true, canStop: false};

describe('RunStatusBar', () => {
  test('canStop ⇒ 停止钮在位并回调；无 canStop ⇒ 不摆按不动的钮', () => {
    const stop = jest.fn();
    const {rerender} = render(<RunStatusBar status={gen} busySince={Date.now() - 5000} onStop={stop} conversationCode="abc12345xx"/>);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('停');
    fireEvent.click(btn);
    expect(stop).toHaveBeenCalled();
    rerender(<RunStatusBar status={resuming} conversationCode="abc12345xx"/>);
    expect(screen.queryByRole('button')).toBeNull();
  })
  test('忙碌出计时、idle 不出（终局不自称忙碌）', () => {
    const {unmount} = render(<RunStatusBar status={gen} busySince={Date.now() - 45000} conversationCode="abc12345xx"/>);
    expect(screen.getByText(/4[45] 秒/)).toBeTruthy();
    unmount();
    render(<RunStatusBar status={idle} conversationCode="abc12345xx"/>);
    expect(screen.queryByText(/秒/)).toBeNull();
  })
  test('会话徽标：有标题用标题，无标题退 code 前 8 位（不猜标题）', () => {
    const {rerender} = render(<RunStatusBar status={idle} conversationLabel="季度复盘" conversationCode="abc12345xx"/>);
    expect(screen.getByText('当前会话：季度复盘')).toBeTruthy();
    rerender(<RunStatusBar status={idle} conversationCode="abc12345xx67"/>);
    expect(screen.getByText('当前会话：abc12345…')).toBeTruthy();
  })
})
