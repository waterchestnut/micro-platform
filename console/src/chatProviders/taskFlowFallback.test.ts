/**
 * requestFallback 的**判序行为**用例（M8 刀一防"判据防空转三条件"里的那条：
 * 分支在真链上可达、且顺序错了会红）。
 *
 * 为什么不 import pages/Chat/index.tsx 跑真组件：那会把 umi/antd-style/XMarkdown 整链拖进
 * 单测（本仓 chatRender 只测轻组件是既有边界）。折中=把 fallback 的判序**逐行搬进本地实现**，
 * 输入用真判据件（readTaskFlowError/structuredRejectText/dropLoadingPlaceholder 都是真模块）——
 * 判据本身真跑；"页面里确实按这个序接了线"由源码位守卫钉（两条都要，缺一层就是假绿的一半）。
 */
import {readTaskFlowError, makeTaskFlowError, taskFlowNoteText} from './taskFlow';
import {structuredRejectText, dropLoadingPlaceholder} from './rejectText';

/** 与 Chat/index.tsx requestFallback 相同的判序（AbortError→task 信号→shouldResume→拒绝体） */
function fallbackLike(error: any, messageInfo: any, shouldResumeGateDo: boolean) {
  if (error?.name === 'AbortError') return {branch: 'abort'} as const;
  const origin = (messageInfo?.message || {}) as any;
  const sig = readTaskFlowError(error);
  if (sig) {
    return {
      branch: 'task',
      content: dropLoadingPlaceholder(origin.content),
      taskNote: taskFlowNoteText(sig.kind, sig.payload),
      taskKind: sig.kind,
      taskRootCode: (sig.payload as any).rootCode,
      streamState: 'done',
    } as const;
  }
  if (!shouldResumeGateDo) {
    return {
      branch: 'reject',
      content: dropLoadingPlaceholder(origin.content),
      errorText: structuredRejectText((messageInfo as any)?.__errorInfo) || '请求失败，请稍后重试!',
      streamState: 'error',
    } as const;
  }
  return {branch: 'resume'} as const;
}

describe('requestFallback 判序（任务信号优先于续接与通用拒绝）', () => {
  const placeholderMsg = {message: {content: '正在处理，请稍后。。。', role: 'ai', messageCode: 'm1'}};

  test('排队信号 ⇒ task 分支：占位剥净 + taskNote 真话 + 不进续接不念通用失败', () => {
    const e = makeTaskFlowError('queued', {rootCode: 'r1', queuePosition: 2});
    const r = fallbackLike(e, placeholderMsg, true); // 就算"可续"也不许走续接：任务轮从没开过流
    expect(r.branch).toBe('task');
    expect((r as any).content).toBe('');
    expect((r as any).taskNote).toContain('第 2 位');
    expect((r as any).taskKind).toBe('queued'); // 刀二：卡片坐标随分支产物走
    expect((r as any).taskRootCode).toBe('r1');
    expect((r as any).streamState).toBe('done');
  });

  test('撞名但 payload 坏（读判不过）⇒ 退回既有通道，不演"已受理"', () => {
    const fake = Object.assign(new Error('boom'), {name: 'TaskQueued'});
    const r = fallbackLike(fake, {...placeholderMsg, __errorInfo: {success: false, message: '上一条还在处理中'}}, false);
    expect(r.branch).toBe('reject');
    expect((r as any).errorText).toBe('上一条还在处理中');
  });

  test('AbortError 优先于一切（用户主动停止不许被任务分支吞成"已受理"）', () => {
    const e = Object.assign(makeTaskFlowError('queued', {rootCode: 'r', queuePosition: 1}), {name: 'AbortError'});
    expect(fallbackLike(e, placeholderMsg, false).branch).toBe('abort');
  });

  test('普通 4292 拒绝体不受本刀影响（success:false 通道原样）', () => {
    const e = new Error('当前会话排队已满，请稍后再发起');
    const r = fallbackLike(e, {...placeholderMsg, __errorInfo: {success: false, code: 4292, message: '当前会话排队已满，请稍后再发起'}}, false);
    expect(r.branch).toBe('reject');
    expect((r as any).errorText).toContain('排队已满');
  });
});

/**
 * 页面接线的位置证据：判序在本地跑对了，还要证明 Chat/index.tsx **真按这个序接**——
 * 这正是本项目"纯函数全绿、界面一个字没变"（B2 教训）的对症药。源码位守卫只锚语句顺序，
 * 不锚注释（注释里的符号不算命中）。
 */
describe('Chat/index.tsx 接线位置守卫', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  const src = fs
    .readFileSync(path.resolve(__dirname, '../pages/Chat/index.tsx'), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l: string) => !/^\s*(\*|\/\/)/.test(l.trim()));
  const idx = (re: RegExp) => src.findIndex((l: string) => re.test(l));

  test('fetch 走 makeFetchWithTaskFlow 包装（不是裸 fetch=信封没人分流）', () => {
    expect(idx(/makeFetchWithTaskFlow\(\)\(baseURL/)).toBeGreaterThan(-1);
  });
  test('fallback 判序：task 信号在通用拒绝之前、AbortError 之后（底座无 resume 线，判序三段版）', () => {
    const abort = idx(/error\.name === 'AbortError'/);
    const task = idx(/readTaskFlowError\(error\)/);
    expect(abort).toBeGreaterThan(-1);
    expect(task).toBeGreaterThan(abort);
    // 底座 fork：没有 shouldResume 分支——若日后把 resume 线搬来，判序守卫要跟着升级
    expect(idx(/shouldResume\(\{/)).toBe(-1);
  });
  test('taskNote 有渲染出口（判据产物进不了组件=说了等于没说）', () => {
    expect(idx(/taskNote=\{data\.extraInfo\?\.taskNote\}/)).toBeGreaterThan(-1);
  });
  test('M8 刀二：accepted 气泡挂 TaskCard 且带树坐标（queued 不挂——结果随排水落回本会话档案）', () => {
    expect(idx(/taskKind === 'accepted' && data\.extraInfo\?\.taskRootCode/)).toBeGreaterThan(-1);
    expect(idx(/<TaskCard/)).toBeGreaterThan(-1);
    /** 入口开关在位且提交带 taskMode/taskCode（幂等键与 callin 同款"每次提交新生成"） */
    expect(idx(/taskMode: true, taskCode:/)).toBeGreaterThan(-1);
  });
  test('排查刀 C：受理记账、进会话恢复、终局销账三处都在位且用同一批判据函数', () => {
    expect(idx(/writePendingTasks\(convNow, upsertPendingTask\(/)).toBeGreaterThan(-1); // fallback 记账
    expect(idx(/void restorePending\(activeConv\)/)).toBeGreaterThan(-1); // 会话恢复
    expect(idx(/onSettled=\{\(rc/)).toBeGreaterThan(-1); // 终局销账（清理钩子接线）
    expect(idx(/shouldDropPendingTask\(e, \{archivedMessageCodes: archivedCodes, treeTerminal\}\)/)).toBeGreaterThan(-1);
    /** 顺序判据：恢复只在 activeConv 变化上跑（挂 messages 每次流更新都会触发，吵且易抖掉账） */
    const eff = idx(/if \(activeConv\) void restorePending\(activeConv\)/);
    const depsLine = src.slice(eff, eff + 3).join('\n');
    expect(depsLine).toMatch(/\[activeConv, restorePending\]/);
  });
});
