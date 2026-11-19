/**
 * MessageParts 渲染用例（刀 A 的"组件把判据结论说出来了吗"）。
 * 判据本身在 messageParts.test.ts 已穷举——这里只钉映射：块型→组件、顺序、计数展示、
 * 未知块型不崩。text 渲染注入 div（x-markdown 的 ESM 链进不了 jest，TaskCard 同款处置）。
 */
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import MessageParts from './MessageParts';
import {projectMessageParts} from '@/chatProviders/messageParts';

const rt = (t: string) => <div data-testid="md">{t}</div>;

describe('MessageParts 映射', () => {
  test('空 parts ⇒ 什么都不渲染（回退旧路径的责任在调用方）', () => {
    const {container} = render(<MessageParts parts={[]} renderText={rt}/>);
    expect(container.childNodes.length).toBe(0);
  })

  test('完整一轮：说明行、正文、计划卡(带计数)、工具块、来源 chips 全在位且顺序如判据', () => {
    const parts = projectMessageParts({
      taskNote: '任务已受理：3 个子任务并行执行中',
      content: '这是正文回答',
      toolCalls: [
        {id: '1', name: 'update_plan', args: {items: [
          {title: '读文件', status: 'done'},
          {title: '分析评分', status: 'in_progress'},
          {title: '出报告'},
        ]}},
        {id: '2', name: 'search_web', status: 'done'},
      ],
      sources: [{title: '某来源', url: 'https://example.com/a'}],
    });
    const {container} = render(<MessageParts parts={parts} renderText={rt}/>);
    expect(screen.getByText('任务已受理：3 个子任务并行执行中')).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toBe('这是正文回答');
    expect(screen.getByText('执行计划')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy(); // done/total 由判据派生，渲染只展示
    expect(screen.getByText('分析评分')).toBeTruthy();
    expect(screen.getByText('工具调用')).toBeTruthy(); // update_plan 已升格，不重复出现
    expect(screen.getByText('已完成网络搜索')).toBeTruthy(); // 刀 D：默认行说业务语义
    expect(screen.getByText(/某来源/)).toBeTruthy();
    // 块顺序=DOM 顺序：正文在计划之前（结果优先）
    const html = container.textContent || '';
    expect(html.indexOf('这是正文回答')).toBeLessThan(html.indexOf('执行计划'));
  })

  test('error 块渲染为危险色文本（拒绝原因不许长得像正文）', () => {
    render(<MessageParts parts={[{type: 'error', text: '上一条还在处理中'}]} renderText={rt}/>);
    const el = screen.getByText('上一条还在处理中');
    expect(el.className).toContain('ant-typography-danger')
  })

  test('未知块型 ⇒ 静默跳过不崩（判据先扩展、渲染后跟上是允许的中间态）', () => {
    const {container} = render(<MessageParts parts={[{type: 'brand-new'}] as any} renderText={rt}/>);
    expect(container.textContent).toBe('')
  })

  test('toolLabel 注入生效（刀 D 的业务语义挂载点；不注入显示原名——不硬编猜测表）', () => {
    render(
      <MessageParts
        parts={[{type: 'tools', calls: [{id: '1', name: 'search_web', status: 'done'}]}]}
        renderText={rt}
        toolLabel={(n) => (n === 'search_web' ? '正在检索网络' : String(n))}
      />,
    );
    expect(screen.getByText('正在检索网络')).toBeTruthy();
  })

  test('artifact 卡：显示名/元信息行/打开回调（无回调不出按钮——不吊空指针）', () => {
    const opened: string[] = []
    const {rerender} = render(
      <MessageParts
        parts={[{type: 'artifact', artifactCode: 'art-1', name: '报告.md', kind: 'file', sizeBytes: 2048}]}
        renderText={rt}
        onOpenArtifact={(c) => opened.push(c)}
      />,
    );
    expect(screen.getByText('已生成《报告.md》')).toBeTruthy();
    expect(screen.getByText(/file · 2 KB · art-1/)).toBeTruthy(); // 元信息单源 artifactView
    fireEvent.click(screen.getByText('打开'));
    expect(opened).toEqual(['art-1']);
    rerender(<MessageParts parts={[{type: 'artifact', artifactCode: 'art-1'}]} renderText={rt}/>);
    expect(screen.queryByText('打开')).toBeNull();
    expect(screen.getByText('已生成《art-1》')).toBeTruthy(); // 无 name ⇒ code 短形
  })

  test('failed 工具行：✗ 红标+失败话术（判据副本与表两件套在这里合流）', () => {
    const {container} = render(
      <MessageParts parts={[{type: 'tools', calls: [{id: '9', name: 'save_artifact', status: 'failed'}]}]} renderText={rt}/>,
    );
    expect(screen.getByText('产物保存失败')).toBeTruthy();
    expect(container.textContent).toContain('✗'); // 失败行红标字符在位（antd Collapse 内部 span 结构不钉选择器）
  })
})
