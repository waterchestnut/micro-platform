import React from 'react';
import { render, screen } from '@testing-library/react';
import EmptyRoundNotice from './EmptyRoundNotice';
import { applySegmentEnd, applySegmentStart } from '@/chatProviders/segments';

/**
 * 渲染测试：只覆盖 `EmptyRoundNotice`。
 *
 * **为什么没有 `ProcessPanel` 的渲染测试**（试过，结论是这仓现在跑不了）：
 * 它 `import {Sources, ThoughtChain} from '@ant-design/x'`，而 x 的依赖链上有
 * `react-syntax-highlighter@16 → refractor@5`、`mermaid@11` 这类 **ESM-only** 包。
 * 两个方向都实测过：
 * - 让 jest 转换 node_modules（该仓原配置 `transformIgnorePatterns: ['/node_modules/(?!)']`
 *   因为那个空负向前瞻永不匹配，效果就是"全部转换"）⇒ 撞上链上 `@babel/core@7.4.5`
 *   与新语法插件要求的 `^7.22.0` 不兼容，报 `Requires Babel "^7.22.0 || >8.0.0-alpha <8.0.0-beta"`；
 * - 不转换 ⇒ `Cannot use import statement outside a module`（先 refractor，替掉之后又轮到 mermaid）。
 *
 * 正确的修法是把测试用的 babel/core 升到 7.22+（或给这些包配精确的转换白名单），
 * 那是**依赖层面的决定**，不该夹在一次功能改动里偷偷做。
 * 所以这里的取舍是：**判断逻辑一律下沉到 `segments.ts` 并在那里穷举测**
 * （`segmentTimelineView` 的用例覆盖了原先想靠渲染测试验的条目、状态、hint、可展开性），
 * 组件只把数据交给三方组件渲染。真要给这仓补组件测试，先解决 babel，再回来把这一段加回去。
 */

/**
 * @description 造一个已封口的段列表
 * @param {any[]} pairs 段载荷
 * @returns {any[]} 段列表
 */
const sealed = (pairs: any[]) =>
  pairs.reduce(
    (acc: any[], p) =>
      applySegmentEnd(applySegmentStart(acc, p), {
        ...p,
        metrics: { chars: 35, toolCount: 1, ms: 1600 },
      }),
    [] as any[],
  );

describe('EmptyRoundNotice 把三类判定真的显示出来', () => {
  test('遗弃回填行 ⇒ 说"服务重启中断"，并且不冒出"0 字"', () => {
    render(
      <EmptyRoundNotice
        content=""
        error="abandoned:process-lost"
        process={{ lostChars: 0 }}
        streamState="aborted"
      />,
    );
    expect(screen.getByText(/服务重启中断/)).toBeTruthy();
    expect(screen.queryByText(/0\s*字/)).toBeNull();
  });

  test('有正量级时才引用字数', () => {
    render(
      <EmptyRoundNotice
        content=""
        error="abandoned:process-lost"
        process={{ lostChars: 10772 }}
        streamState="aborted"
      />,
    );
    expect(screen.getByText(/约 10772 字/)).toBeTruthy();
  });

  test('有段可回放 ⇒ 说"执行过程"', () => {
    render(
      <EmptyRoundNotice
        content=""
        segments={sealed([
          { seq: 1, kind: 'tool-round', category: 'tools', title: '调用 1 个工具' },
        ])}
      />,
    );
    expect(screen.getByText(/执行过程/)).toBeTruthy();
  });

  test('首 token 前就取消 ⇒ 说"开始输出前已被取消"', () => {
    render(
      <EmptyRoundNotice
        content=""
        streamState="aborted"
        process={{ usage: { hasUsage: false } }}
      />,
    );
    expect(screen.getByText(/开始输出前/)).toBeTruthy();
  });

  test('什么都没留下 ⇒ "未产出回答内容"，且不得出现"内容不完整"', () => {
    render(<EmptyRoundNotice content="" streamState="aborted" process={{}} />);
    expect(screen.getByText('本轮未产出回答内容')).toBeTruthy();
    expect(screen.queryByText(/不完整/)).toBeNull();
  });

  test('有正文 ⇒ 只说"已被中断"，不否定内容完整性', () => {
    render(<EmptyRoundNotice content="这是已经答出来的部分" streamState="aborted" />);
    expect(screen.getByText('本轮回答已被中断')).toBeTruthy();
    expect(screen.queryByText(/不完整/)).toBeNull();
  });

  test('正常完成且有正文 ⇒ 什么都不渲染', () => {
    const { container } = render(<EmptyRoundNotice content="答完" streamState="done" />);
    expect(container.textContent).toBe('');
  });

  test('续接结论单独一行，且有正文时也要出现（用户需要知道下面这些是不是全部）', () => {
    render(
      <EmptyRoundNotice
        content="已经答出来的部分"
        streamState="streaming"
        resumeNote="网络中断，多次尝试续接未成功，下面的是已收到的部分。"
      />,
    );
    expect(screen.getByText(/多次尝试续接未成功/)).toBeTruthy();
  });

  test('空正文 + 续接失败 ⇒ 两行都在，不互相顶掉', () => {
    render(
      <EmptyRoundNotice
        content=""
        streamState="aborted"
        process={{}}
        resumeNote="连接中断较久，这一轮没有可显示的内容，请重新提问。"
      />,
    );
    expect(screen.getByText('本轮未产出回答内容')).toBeTruthy();
    expect(screen.getByText(/请重新提问/)).toBeTruthy();
  });

  test('resumeNote 为空时不多渲染一个空节点', () => {
    const { container } = render(
      <EmptyRoundNotice content="答完" streamState="done" resumeNote={undefined} />,
    );
    expect(container.textContent).toBe('');
  });
});
