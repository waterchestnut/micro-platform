/**
 * 产物工作区渲染用例（刀 B 前端面）。IO 全注入假手——判据（分组/尺寸/标题）在
 * artifactView.test 已穷举，这里钉的是"组件把清单/预览/失败三种真话分开说"。
 */
import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import ArtifactWorkspace from './ArtifactWorkspace';
import type {ArtifactListResult, ArtifactPage, ArtifactRow} from '@/services/llm/artifact';

const rt = (t: string) => <div data-testid="md">{t}</div>;

const ROWS: ArtifactRow[] = [
  {artifactCode: 'b2', lineageRootArtifactCode: 'b1', name: '报告.md', version: 2, state: 'ready', sizeBytes: 2048, kind: 'file', readyAt: '2026-11-19T10:00:00Z'},
  {artifactCode: 'b1', lineageRootArtifactCode: 'b1', name: '报告.md', version: 1, state: 'registered', sizeBytes: 1024, kind: 'file', readyAt: '2026-11-18T10:00:00Z'},
];

const listOk = (items: ArtifactRow[]): ArtifactListResult => ({ok: true, items});
const pageOk = (text: string, hasMore = false): ArtifactPage => ({ok: true, text, hasMore, totalChars: hasMore ? text.length + 100 : text.length});

const base = (over: any = {}) => ({
  open: true,
  onClose: () => {},
  conversationCode: 'conv-1',
  renderText: rt,
  loadList: async () => listOk(ROWS),
  loadPage: async () => pageOk('正文第一段'),
  ...over,
});

describe('ArtifactWorkspace', () => {
  test('打开 ⇒ 清单按血缘归组（一链一组两版本），默认选中首行并读回正文', async () => {
    const loadPage = jest.fn(base().loadPage);
    render(<ArtifactWorkspace {...base({loadPage})}/>);
    await waitFor(() => expect(screen.getAllByText('报告.md').length).toBe(2)); // 恰两次=组题+预览头（两版归一组而非两组）
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText(/v1 registered/)).toBeTruthy(); // 非 ready 状态随版本 chip 如实出
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('正文第一段'));
    expect(loadPage).toHaveBeenCalledWith('b2', 0);
  })

  test('focusCode ⇒ 定位到指定版本（从消息内产物卡进来）', async () => {
    const loadPage = jest.fn(base().loadPage);
    render(<ArtifactWorkspace {...base({focusCode: 'b1', loadPage})}/>);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('b1', 0));
  })

  test('hasMore ⇒ 继续加载按已读字符数续拉并拼接（不整吞、不覆盖）', async () => {
    const loadPage = jest.fn(async (code: string, offset = 0): Promise<ArtifactPage> =>
      offset === 0 ? {...pageOk('前半', true)} : {...pageOk('后半'), totalChars: 8});
    render(<ArtifactWorkspace {...base({loadPage})}/>);
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('前半'));
    fireEvent.click(screen.getByText('继续加载'));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('前半后半'));
    expect(loadPage).toHaveBeenLastCalledWith('b2', 2);
    expect(screen.getByText(/已载 4 \/ 8 字符/)).toBeTruthy();
  })

  test('读回被状态闸拒 ⇒ 拒法原文上屏（不洗成"暂无内容"）', async () => {
    render(<ArtifactWorkspace {...base({loadPage: async () => ({ok: false, error: '账行没有 fileCode（registered 未入库）'})})}/>);
    await waitFor(() => expect(screen.getByText('账行没有 fileCode（registered 未入库）')).toBeTruthy());
  })

  test('清单读不到 ≠ 暂无产物：失败说失败，真空说真空', async () => {
    const {unmount} = render(<ArtifactWorkspace {...base({loadList: async () => ({ok: false, items: [], error: '网络异常，产物清单未送达'})})}/>);
    await waitFor(() => expect(screen.getByText('网络异常，产物清单未送达')).toBeTruthy());
    unmount();
    render(<ArtifactWorkspace {...base({loadList: async () => listOk([])})}/>);
    await waitFor(() => expect(screen.getByText('本会话暂无产物')).toBeTruthy());
  })

  test('换选即换文：点旧版本 chip 后新正文替换旧正文（串档比空白更糟）', async () => {
    const loadPage = jest.fn(async (code: string): Promise<ArtifactPage> =>
      ({ok: true, text: code === 'b2' ? '第二版正文' : '第一版正文', hasMore: false}));
    render(<ArtifactWorkspace {...base({loadPage})}/>);
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('第二版正文'));
    fireEvent.click(screen.getByText(/v1 registered/));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('第一版正文'));
  })
})
