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
import {Alert, Button, Input, Space, Typography} from 'antd';
import {
  mapCardProgress,
  phaseText,
  elapsedText,
  pickClarify,
  type TaskDetailLite,
} from '@/chatProviders/taskFlow';
import {createTaskEventWatcher, type TaskEventsResp} from '@/chatProviders/taskEventFlow';

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
  /**
   * M1-c 刀 2：事件订阅一轮（/core/agentTask/eventsSubscribe 的 IO 面，形态见 taskEventFlow）。
   * **事件只是提醒，detail 仍是状态唯一源**——命中里程碑就立刻补一拍 tick，把 4s 轮询
   * 的观测延迟压到亚秒；不给此 prop ⇒ 纯轮询，行为与刀 2 之前逐字节相同（默认关接线纪律）。
   * 降级由状态机自治：服务端事件面没开 ⇒ 一轮即停，不空转。
   */
  subscribeEvents?: (rootCode: string, lastId: string) => Promise<TaskEventsResp | null>;
  /**
   * §7-1 澄清答复（动作面注入，同 cancel 纪律）。不给 ⇒ 只出题不答（降级面：
   * 文案照样如实"该入口暂不支持答复"，不许演一个按不动的按钮）。
   */
  answerClarify?: (rootCode: string, answers: Array<{agentCode: string; response: string}>) => Promise<{ok: boolean; msg: string; data?: any}>;
  loadSynthesis: (rootCode: string) => Promise<string | null>;
  renderBody?: (text: string) => React.ReactNode;
  /**
   * M1-c 刀 2：事件订阅一轮的 IO 面（形态与降级纪律见 chatProviders/taskEventFlow）。
   * 事件=提醒，detail=状态——命中里程碑立刻补一拍 tick，把观测延迟从 4s 压到亚秒；
   * 不给此 prop ⇒ watcher 不存在，行为与刀 2 之前逐字节相同。
   */
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
  subscribeEvents,
  answerClarify,
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
  // §7-1 澄清面：pending 题单（服务端账上快照）+ 每题草稿 + 答复回执（说"转起来了"要凭 requeued）
  const [clarify, setClarify] = useState<ReturnType<typeof pickClarify>>({pending: [], capped: []});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clarifyMsg, setClarifyMsg] = useState<string | null>(null);
  const [answeringCode, setAnsweringCode] = useState<string | null>(null);
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
      // 澄清清单每帧跟账走（服务端 hold 收缩 ⇒ 题目自然消失；这里不缓存"答过的题"演进度）
      setClarify(pickClarify(view));
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
    // 刀 2：订阅提醒（不注入 subscribeEvents ⇒ 整个 watcher 不存在，原形逐字节）
    let watcher: ReturnType<typeof createTaskEventWatcher> | null = null;
    if (subscribeEvents) {
      watcher = createTaskEventWatcher({
        fetchEvents: (rc, lastId) => subscribeEvents(rc, lastId),
        // 提醒只敲门不装状态：tick 自带防重（停表后不再拉），真状态永远来自 detail
        onHint: () => { if (!dead && !stoppedRef.current) void tick(); },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        stopped: () => dead || stoppedRef.current,
      });
      watcher.start(rootCode);
    }
    return () => { dead = true; clearInterval(timer); watcher?.stop(); };
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

  /** §7-1 答复一题：成功要说"转起来了"（凭 requeued），失败留草稿与重试的门——同 cancel 纪律 */
  const onAnswer = async (agentCode: string) => {
    if (!answerClarify) return;
    const text = String(drafts[agentCode] || '').trim();
    if (!text) return;
    setAnsweringCode(agentCode);
    const r = await answerClarify(rootCode, [{agentCode, response: text}]);
    setAnsweringCode(null);
    if (r.ok) {
      const requeued = Array.isArray(r.data?.requeued) ? r.data.requeued : [];
      if (requeued.includes(agentCode)) {
        setClarifyMsg('已答复：子任务将带着补充重跑，到齐后统一综合。');
        setDrafts((d) => ({...d, [agentCode]: ''}));
      } else {
        setClarifyMsg('答复已收下，但未能转成重派（子任务状态可能已变化，稍后以进度为准）。');
      }
    } else {
      setClarifyMsg(`答复未被接受：${r.msg || '未知原因'}`);
    }
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
          {clarify.pending.length ? (
            <div style={{margin: '4px 0', padding: '6px 8px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6}}>
              <div style={{fontWeight: 600, marginBottom: 2}}>任务有 {clarify.pending.length} 个问题想请你补充（答复后带着补充继续跑，不答复会等到上限为止）</div>
              {clarify.pending.map((q) => (
                <div key={q.agentCode} style={{marginBottom: 6, overflowWrap: 'anywhere'}}>
                  <div>· {q.title ? `${q.title}：` : ''}{q.question}</div>
                  {answerClarify ? (
                    <Space style={{marginTop: 2}} wrap>
                      {q.options.map((o) => (
                        <Button key={o} size="small" onClick={() => setDrafts((d) => ({...d, [q.agentCode]: o}))}>{o}</Button>
                      ))}
                      <Input size="small" style={{width: 220}} placeholder="你的答复"
                        value={drafts[q.agentCode] || ''}
                        onChange={(e) => setDrafts((d) => ({...d, [q.agentCode]: e.target.value}))}
                        onPressEnter={() => void onAnswer(q.agentCode)} />
                      <Button size="small" type="primary" loading={answeringCode === q.agentCode}
                        disabled={!(drafts[q.agentCode] || '').trim()}
                        onClick={() => void onAnswer(q.agentCode)}>答复</Button>
                    </Space>
                  ) : (
                    <div style={{color: '#999'}}>该入口暂不支持答复（可取消任务后重新发起并写清楚）</div>
                  )}
                </div>
              ))}
              {clarify.capped.length ? clarify.capped.map((q, i) => (
                <div key={`cap-${i}`} style={{color: '#999'}}>· {q.question}（澄清次数到上限，已不再等待答复）</div>
              )) : null}
              {clarifyMsg ? <div style={{marginTop: 2}}>{clarifyMsg}</div> : null}
            </div>
          ) : null}
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
