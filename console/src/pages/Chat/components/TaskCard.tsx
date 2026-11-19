/**
 * @fileOverview 编排任务 live 卡（PR-任务编排 M8 第三仓刀二）
 * @module pages/Chat/components/TaskCard
 * @description
 * 挂在"扇出受理气泡"里的观测+控制面：4s 轮询 `/core/agentTask/detail`，把相位/槽位进度/树账
 * 说成人话；`synthesized` 后读 `root:<rootCode>` 会话末条非空正文渲染在卡内——这就是设计 §8
 * "答案区占位→替换"的**展示层**落地（数据层综合落隔离会话、不回填聊天线，是既拍板，本卡不改）。
 *
 * 三条刻意的纪律：
 * 1. **判据零自造**：相位文案/进度口径/终局判定全在 `chatProviders/taskFlow.ts`（llm.api 单源的
 *    下游镜像）；本组件只渲染。`renderBody` 由调用方注入（生产=XMarkdown，测试=div）——
 *    不为渲染把重依赖链拖进单测（jest 替身纪律同款理由）。
 * 2. **取消不装"立刻全停"**：点了 cancel 只说"已请求取消"，状态以服务端 detail 的下一拍为准
 *    （引擎对 in-flight child 无 run 把手是硬事实，llm.api §5-2 已核）。
 * 3. **观测失败不演失败**：detail 拉不到 ⇒ 沿用上一帧；从未拉到过 ⇒ 只说"进度查询中"。
 *    终局后停轮询（TASK_FLOW_TERMINAL_PHASES）；synthesized 但正文读不到 ⇒ 如实说"未读到"，
 *    不拿标题凑一段。
 */
import React, {useEffect, useRef, useState} from 'react';
import {Alert, Button, Space, Typography} from 'antd';
import {
  mapCardProgress,
  phaseText,
  elapsedText,
  type TaskDetailLite,
} from '@/chatProviders/taskFlow';

const {Text} = Typography;

export type TaskCardProps = {
  rootCode: string;
  /** 受理时信封里带来的那句（detail 首帧到达前的说明，不重复编造进度） */
  note?: string;
  intervalMs?: number;
  /**
   * 依赖全注入（不给 services 留 default——jest 的 esbuild transform 不提升 jest.mock，
   * 组件 import 真服务链=测试必炸，本仓实测）：生产在 Chat/index 接 services/llm/agentTask，
   * 测试给桩。与 ProcessPanel 的 toolResultLoader 同一注入纪律。
   */
  loadDetail: (rootCode: string) => Promise<TaskDetailLite | null>;
  cancelTask: (rootCode: string) => Promise<{ok: boolean; msg: string}>;
  loadSynthesis: (rootCode: string) => Promise<string | null>;
  renderBody?: (text: string) => React.ReactNode;
  /**
   * M8 排查刀：观测墙——超过 wallMs 还没见到终局就**停表**（默认 30 分钟）。
   * 这是观测者的声明不是任务的判决：root 停在机械终态、recover 救不到内存对象是已登记的窗
   * （handoff §3.4），没有墙的卡片会永远轮询一个不会说话的树。停表后下次进会话可重建（restore 路径）。
   */
  wallMs?: number;
  /** 终局（synthesized/partial/failed/cancelled）时回报一次——页面据此续跟进账清理 */
  onSettled?: (rootCode: string) => void;
};

const TaskCard: React.FC<TaskCardProps> = ({
  rootCode,
  note,
  intervalMs = 4000,
  wallMs = 30 * 60 * 1000,
  loadDetail,
  cancelTask,
  loadSynthesis,
  renderBody,
  onSettled,
}) => {
  const [progress, setProgress] = useState<ReturnType<typeof mapCardProgress>>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [bodyState, setBodyState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  /** 只有"服务端收下了取消"才收按钮；失败必须留着重试的门（错误提示 ≠ 已处置） */
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const stoppedRef = useRef(false);
  // 生命周期守卫=effect 闭包里的 `dead`（React 18 卸载后 setState 是无害 no-op，
  // 曾另挂 mountedRef 反而让 TS 把初值 true 收窄成字面量类型——判据少一层间接更好读）

  useEffect(() => {
    if (!rootCode) return;
    let dead = false;
    stoppedRef.current = false;
    const startAt = Date.now();
    const tick = async () => {
      // 观测墙先判：停表是**观测者声明**，不演"任务失败"，也不再多打一次端点
      if (!stoppedRef.current && Date.now() - startAt > wallMs) {
        stoppedRef.current = true;
        setTimedOut(true);
        return;
      }
      const view = await loadDetail(rootCode);
      if (dead) return;
      const m = mapCardProgress(view);
      if (m) setProgress(m);
      if (m && m.terminal) {
        stoppedRef.current = true;
        onSettled?.(rootCode); // 结局已说出口 ⇒ 页面的续跟进账可以清了（终局是唯一清理凭据）
        if (m.phase === 'synthesized') {
          setBodyState('loading');
          const text = await loadSynthesis(rootCode);
          if (dead) return;
          setBodyState(text ? 'idle' : 'missing');
          setBody(text);
        }
      }
    };
    tick();
    const timer = setInterval(() => {
      if (!stoppedRef.current) void tick();
    }, intervalMs);
    return () => { dead = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootCode]);

  const onCancel = async () => {
    setCancelling(true);
    const r = await cancelTask(rootCode);
    setCancelling(false);
    if (r.ok) setCancelRequested(true);
    // 不装"已全停"：这句话说的是"我方不再聚合"，在途行会不会跑完由服务端事实决定
    setCancelMsg(r.ok
      ? '已请求取消：不再聚合结果（在途子任务可能仍会跑完，但不会再写入结果）'
      : `取消未生效：${r.msg || '未知原因'}`);
  };

  // slots=有明细行时的分组面；items=兜底平铺（视图行缺 slot 字段的旧形状也不会空转）
  const slots = progress ? progress.slots : [];
  const showCancel = !!progress && !progress.terminal && !cancelRequested;

  return (
    <Alert
      style={{margin: '4px 0'}}
      type={progress?.terminal ? (progress.failedCount > 0 || progress.phase === 'failed' || progress.phase === 'cancelled' ? 'warning' : 'success') : 'info'}
      showIcon
      message={
        <span style={{fontSize: 13}}>
          {progress
            ? `任务${progress.phaseLabel}（${progress.doneCount}/${progress.total}${progress.failedCount ? `，失败 ${progress.failedCount}` : ''}）`
            : '任务已受理，进度查询中…'}
          {progress && (progress.tokens > 0 || progress.credits > 0) && (
            <Text type="secondary" style={{marginLeft: 8, fontSize: 12}}>
              已消耗 {progress.tokens} tokens · {progress.credits} credits{progress.creditsPriced === false ? '（未计价，=token 计数）' : ''}
            </Text>
          )}
        </span>
      }
      description={
        <div style={{fontSize: 12}}>
          {!progress && note ? <div style={{color: '#999'}}>{note}</div> : null}
          {slots.length ? slots.map((g: any, i: number) => {
            const head: any = g.current || g.history[g.history.length - 1] || {};
            const label = g.current ? phaseText(g.current.phase) : '状态未知';
            const el = elapsedText(g.current);
            return (
              <div key={i} style={{overflowWrap: 'anywhere'}}>
                · {String(head.title || '子任务')}（{label}{el ? `，用时 ${el}` : ''}{g.attempts > 1 ? `，尝试 ${g.attempts} 次` : ''}）
              </div>
            );
          }) : null}
          {progress && !slots.length ? progress.items.map((it, i) => (
            <div key={i} style={{overflowWrap: 'anywhere'}}>· {it.title}（{it.label}）</div>
          )) : null}
          {timedOut ? <div style={{color: '#999', marginTop: 2}}>超过观测时限仍未见到终局（任务可能仍在执行或已停在无人续跑的状态，这不代表它失败）</div> : null}
          {cancelMsg ? <div style={{marginTop: 2}}>{cancelMsg}</div> : null}
          {bodyState === 'missing' ? <div style={{color: '#999', marginTop: 2}}>综合已完成但未读到正文（可稍后在任务会话中查看）</div> : null}
          {body ? (
            <div style={{marginTop: 4, borderTop: '1px dashed #eee', paddingTop: 4}}>
              {renderBody ? renderBody(body) : <div style={{whiteSpace: 'pre-wrap'}}>{body}</div>}
            </div>
          ) : null}
          <Space style={{marginTop: 6}}>
            {showCancel ? (
              <Button size="small" danger loading={cancelling} onClick={onCancel}>取消任务</Button>
            ) : null}
          </Space>
        </div>
      }
    />
  );
};

export default TaskCard;
