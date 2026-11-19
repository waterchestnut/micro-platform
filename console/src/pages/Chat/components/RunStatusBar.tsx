/**
 * @fileOverview 会话级 Run 状态条（Agent UI 演进刀 C 的渲染面）
 * @module pages/Chat/components/RunStatusBar
 * @description
 * 常驻在消息区顶部的"现在处于什么状态"读数：相位点 + 文案 +（进行中）计时 +
 * 停止入口（仅 canStop）+ 当前会话徽标（多会话并发时"我在跟谁说话"必须一眼可辨）。
 * 判据在 runStatus.ts（穷举测过），这里只画结论；计时器是本组件唯一的"活"状态。
 */
import React, {useEffect, useState} from 'react';
import {Button, Flex, Typography} from 'antd';
import type {RunStatus} from '@/chatProviders/runStatus';
import {formatElapsed} from '@/chatProviders/runStatus';

const {Text} = Typography;

const DOT: Record<string, {ch: string; color: string}> = {
  idle: {ch: '●', color: '#bbb'},
  connecting: {ch: '◐', color: '#1677ff'},
  generating: {ch: '◐', color: '#1677ff'},
  error: {ch: '✗', color: '#ff4d4f'},
  aborted: {ch: '⊘', color: '#faad14'},
  background: {ch: '◌', color: '#1677ff'},
}

export type RunStatusBarProps = {
  status: RunStatus;
  /** 计时起点（busy 段的 Date.now()）；非 busy 或读不到 ⇒ 不显示时长 */
  busySince?: number | null;
  conversationLabel?: string;
  conversationCode?: string;
  onStop?: () => void;
};

const RunStatusBar: React.FC<RunStatusBarProps> = ({status, busySince, conversationLabel, conversationCode, onStop}) => {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!status.busy) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [status.busy])
  const dot = DOT[status.phase] || DOT.idle
  const elapsed = status.busy && busySince ? formatElapsed(Date.now() - busySince) : ''
  const conv = conversationLabel || (conversationCode ? `${conversationCode.slice(0, 8)}…` : '')
  return (
    <Flex
      align="center"
      gap={8}
      data-testid="run-status-bar"
      style={{padding: '2px 12px', borderBottom: '1px solid #f5f5f5', background: '#fff', position: 'sticky', top: 0, zIndex: 2}}
    >
      <span style={{color: dot.color, fontSize: 12}}>{dot.ch}</span>
      <Text style={{fontSize: 12}}>{status.label}</Text>
      {elapsed ? <Text type="secondary" style={{fontSize: 12}}>{elapsed}</Text> : null}
      {status.canStop && onStop ? (
        <Button size="small" danger style={{fontSize: 12, height: 22, padding: '0 8px'}} onClick={onStop}>停止</Button>
      ) : null}
      <span style={{flex: 1}}/>
      {conv ? (
        <Text type="secondary" style={{fontSize: 12}} title={conversationCode}>当前会话：{conv}</Text>
      ) : null}
    </Flex>
  )
}

export default RunStatusBar
