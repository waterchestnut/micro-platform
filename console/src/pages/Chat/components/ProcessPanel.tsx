import {Button, Collapse, Flex, Space, Spin, Tag, Typography} from 'antd';
import {Sources, ThoughtChain} from '@ant-design/x';
import type {ThoughtChainItemType} from '@ant-design/x';
import {useState} from 'react';
import type {ReactNode} from 'react';
import type {ToolResultPage, ToolResultRun} from '@/chatProviders/toolResult';
import {runToolResultFetch, toolResultIntent, toolResultNextAction, toolResultRunNote, toolResultDisplay, toolResultsDefaultOpen, shouldAutoExpandAfterFetch, PREVIEW_CHARS} from '@/chatProviders/toolResult';
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  LinkOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type {ChatProcessInfo, ChatSource, ChatToolCall} from '@/chatProviders/CommonChatProvider';
import type {ChatSegment} from '@/chatProviders/segments';
import {
  resolveToolCalls,
  toolResultScopeNote,
  toolArgsView,
  droppedSegmentsText,
  modelCallNote,
  modelCallPlacement,
  segmentCategory,
  segmentTimelineView,
} from '@/chatProviders/segments';

const {Text} = Typography;

/**
 * 段正文等长文本的面内截断。**预算用模块里的那一个常量**，
 * 不在这里再写一遍 600——两处各写一份、只改一边，是这个项目反复出现的失败形状
 * （审计 P0 的直接原因之一就是"取回预算"与"显示预算"从来没人对齐）。
 */
function truncate(text?: string) {
  if (!text) return '';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…（共 ${text.length} 字）` : text;
}

export type ProcessPanelProps = {
  process?: ChatProcessInfo;
  toolCalls?: ChatToolCall[];
  sources?: ChatSource[];
  fromCache?: boolean;
  /**
   * 协议 3 的过程分段。
   * 流式时传 provider 累积的 `message.segments`；历史行传 `process.segments`——
   * **两个来源都汇到这一个 prop，但同一时刻只有一个非空**，所以不会出现两套顺序。
   */
  segments?: ChatSegment[];
  /**
   * 取回全文的入口，由页面注入（面板不知道 messageCode 与凭据从哪来）。
   * **不给函数就不渲染按钮**：界面不承诺还没有的动作。
   */
  toolResultLoader?: (call: ChatToolCall) => ((body: {ref: string; offset: number; limit: number}) => Promise<ToolResultPage>) | undefined;
};

/** 段的渲染大类 → 图标。类别由服务端给（`category`），前端不反推 */
const CATEGORY_ICON: Record<string, ReactNode> = {
  tools: <ThunderboltOutlined/>,
  skill: <ApartmentOutlined/>,
};

/**
 * 展示本轮真实执行过程：过程分段、工具调用、迭代轮次、技能、上下文用量与引用来源。
 * 数据全部来自协议 2/3 的事件与 /core/message/list 的 process 字段，不使用占位样例。
 *
 * **本组件没有渲染测试**，原因不是"没想到要写"：这仓的 jest 环境跑不了组件测试
 * （`@testing-library/react@13` 要 `react-dom/test-utils`，而 `@babel/plugin-transform-modules-commonjs`
 * 根本没装——此前仓里没有任何组件测试，所以这个缺口一直没暴露）。
 * 因此**凡是需要被证明的判断都不写在这里**：段的顺序、类别、度量文案、"要不要再放一份正文"、
 * 空正文该说什么，全部在 `@/chatProviders/segments.ts` 里并有穷举用例。
 * 补齐渲染测试需要先加一个 devDependency（会动 lockfile），那是一个单独的决定，不夹在这一版里做。
 */
/**
 * 一条工具结果的正文，加上"取回全文"这件事。
 *
 * 单独成组件的原因：翻页是有状态的东西，写在 `calls.map(...)` 里就是**在循环里调 hook**
 * （React 直接报错，而且顺序一变状态就串到别的调用上）。
 *
 * 三句话必须在场：
 * - 动作旁：`toolResultIntent` 说"能不能取、取回可能仍不完整"；
 * - 进行中：转圈而不是让按钮看着像没反应；
 * - 结束后：`toolResultRunNote` 按出口分四种说法，**partial 不会报成取完**。
 */
const ToolCallResult = ({call, process, load}: {
  call: ChatToolCall;
  process?: ChatProcessInfo;
  load?: (body: {ref: string; offset: number; limit: number}) => Promise<ToolResultPage>;
}) => {
  const intent = toolResultIntent(call, process?.toolResults);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const [fetched, setFetched] = useState('');
  const [note, setNote] = useState('');
  /** 用户是否选择看全文（默认仍是截断，但**截断必须配一个能展开的入口**） */
  const [expanded, setExpanded] = useState(false);
  /** 上一次取回结果：按钮给不给、叫什么，由 `toolResultNextAction` 决定 */
  const [run, setRun] = useState<ToolResultRun | null>(null);
  const action = toolResultNextAction(run);
  const display = toolResultDisplay({held: call?.result || '', fetched, expanded});
  const canFetch = intent.ok && !!load;

  const doFetch = async () => {
    if (!load) {
      return;
    }
    setPhase('loading');
    /** 本仓的 ChatToolCall 只有 id；tool_call_id 的别名只在量级条目那边匹配，不要在这里假设它存在 */
    const ref = call.id || '';
    const r = await runToolResultFetch({load: (b) => load(b), messageCode: '', ref, pageSize: 0});
    /**
     * `messageCode` 由注入方闭包，这里留空串是**故意的**：面板不知道也不该知道它。
     * `pageSize: 0` 走纯模块里的默认值——默认值只有一份，不在界面里再抄一个 4000。
     */
    setRun(r);
    setFetched(r.text);
    setNote(toolResultRunNote(r));
    /**
     * P4：取回**完整**了就直接展开，别让用户点第二次才看到自己刚要的东西（现网点验量到的两步）。
     * `partial`/`stopped`/`failed` 一律不自动展开——把半截自动铺满屏幕，
     * 比"少点一次"更接近这轮工作一直在消灭的那类谎。判据在 `toolResult.ts`，这里只做映射。
     */
    if (shouldAutoExpandAfterFetch(r)) {
      setExpanded(true);
    }
    setPhase('done');
  };

  return (
    <Flex vertical gap={4}>
      <pre style={{whiteSpace: 'pre-wrap', margin: 0, fontSize: 12, maxHeight: 260, overflow: 'auto'}}>
        {display.text || '（无返回内容）'}
      </pre>
      {/* 量级说明与展开入口是一对：说了"只显示前 X 字"就必须给看见其余的入口（审计 P0） */}
      {display.note ? (
        <Text type="secondary" style={{fontSize: 12}}>{display.note}</Text>
      ) : null}
      {display.expand.show ? (
        <div>
          <Button size="small" type="link" style={{padding: 0}} onClick={() => setExpanded(!expanded)}>
            {display.expand.label}
          </Button>
        </div>
      ) : null}
      {intent.note ? (
        <Text type="secondary" style={{fontSize: 12}}>{intent.note}</Text>
      ) : null}
      {canFetch && action.show ? (
        <div>
          {phase === 'loading' ? (
            <Space size={6}>
              <Spin size="small"/>
              <Text type="secondary" style={{fontSize: 12}}>正在取回…</Text>
            </Space>
          ) : (
            <Button size="small" type="link" style={{padding: 0}} onClick={doFetch}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
      {note ? (
        <Text type={phase === 'done' && note.startsWith('取回失败') ? 'danger' : 'secondary'} style={{fontSize: 12}}>
          {note}
        </Text>
      ) : null}
    </Flex>
  );
};

const ProcessPanel = ({process, toolCalls, sources, fromCache, segments, toolResultLoader}: ProcessPanelProps) => {
  const calls: ChatToolCall[] = resolveToolCalls(toolCalls, process);
  const finalSources = sources?.length ? sources : (process?.sources || []);
  const usage = process?.contextUsage;
  const skills = process?.skills;
  const candidates = skills?.candidates || [];
  /** 段：流式累积优先（它是本轮实时状态），否则用库里回放的权威副本 */
  const segs: ChatSegment[] = segments?.length ? segments : (process?.segments || []);

  if (!calls.length && !finalSources.length && !candidates.length && !usage && !fromCache && !segs.length) {
    return null;
  }

  const items: ThoughtChainItemType[] = [];

  /**
   * 段按 seq 升序排在最前：它是"这一轮干了什么"的时间线，工具/来源是它的汇总视图。
   * 判断（标题兜底、状态、要不要放正文、度量文案）全在 `segments.ts:segmentTimelineView`，
   * 这里只做"数据 → ThoughtChain 属性"的映射。
   * 为什么不靠渲染测试覆盖这段：本仓跑不了引入 `@ant-design/x` 的组件测试
   * （其依赖链上 `refractor@5`、`mermaid@11` 是 ESM-only，而 jest 用的 babel 链是 `@babel/core@7.4.5`：
   * 转换报 `Requires Babel "^7.22.0"`，不转换报 `Cannot use import statement outside a module`，两个方向都实测过）。
   * 逐个给三方包打桩等于手工再造一个模块图，那不是验证——所以判断挪进纯模块，在那里穷举测。
   */
  for (const seg of segs) {
    const v = segmentTimelineView(seg);
    items.push({
      key: v.key,
      title: v.title,
      description: v.description ?? undefined,
      icon: CATEGORY_ICON[segmentCategory(seg)],
      status: v.status as ThoughtChainItemType['status'],
      collapsible: v.collapsible,
      content:
        v.bodyKind === 'text' ? (
          <pre style={{whiteSpace: 'pre-wrap', margin: 0, fontSize: 12, maxHeight: 220, overflow: 'auto'}}>
            {truncate(v.body ?? '')}
          </pre>
        ) : v.bodyKind === 'hint' ? (
          <Text type="secondary">{v.body}</Text>
        ) : undefined,
    });
  }

  /**
   * 整段丢弃的声明（`segmentSummary.dropped`）：服务端一直在给，四端此前一个字都不说。
   * 放在工具条目之前——它说的是"这段过程本身不完整"，比任何单条工具结果都靠前。
   * 判据文案在 `segments.ts:droppedSegmentsText`（那里穷举测），这里只负责挂一条。
   */
  const droppedText = droppedSegmentsText(process?.segmentSummary);
  if (droppedText) {
    items.push({
      key: 'segments-dropped',
      title: '过程内容未完整留存',
      description: droppedText,
      status: 'error' as ThoughtChainItemType['status'],
      collapsible: false,
    });
  }

  /**
   * B2 那句话挂在哪里由 `modelCallPlacement` 决定（判据在纯模块里，穷举测）。
   * 这里曾经把它写在 `if (calls.length)` 里面 ⇒ 零工具的重试轮**永远不会说**，
   * 而"上游被多调了几次"正是那种没有工具可解释、最需要说出来的情形。
   */
  const mc = modelCallNote(process);
  const mcAt = modelCallPlacement(process, calls.length);
  if (mcAt === 'standalone') {
    items.push({
      key: 'model-calls',
      title: mc,
      icon: <ThunderboltOutlined/>,
      status: 'success' as ThoughtChainItemType['status'],
      collapsible: false,
    });
  }

  if (calls.length) {
    items.push({
      key: 'tools',
      title: `调用工具 ${calls.length} 次`,
      description: (() => {
        /** 面板轮次照旧；模型调用数只在**与轮次不等时**加一句（相等就是重复，见 `modelCallNote`） */
        const parts: string[] = [];
        if (process?.iterationCount && process.iterationCount > 1) parts.push(`模型往返 ${process.iterationCount} 轮`);
        if (mcAt === 'tools') parts.push(mc);
        return parts.length ? parts.join(' · ') : undefined;
      })(),
      icon: <ThunderboltOutlined/>,
      // 工具结果是执行完成后才下发的，没有"进行中"态；按 calls 派生状态，兜住未来的 pending。
      status: calls.every((c) => c.status === 'done') ? ('success' as const) : ('loading' as const),
      collapsible: true,
      content: (
        <Collapse
          size="small"
          ghost
          /**
           * 默认展开哪几条由纯判据决定（`toolResultsDefaultOpen`）：
           * 实测 50% 的轮次只有 1 次调用、而 37% 有 6 次，所以"全部展开"只会把
           * 两次点击换成一片长文；短轮次全展开、长轮次只展开**带取回入口的那几条**。
           */
          defaultActiveKey={toolResultsDefaultOpen(calls)}
          items={calls.map((c, i) => ({
            key: c.id || String(i),
            label: (
              <Flex align="center" gap="small">
                {c.status === 'pending' ? <LoadingOutlined/> : <CheckCircleOutlined style={{color: '#52c41a'}}/>}
                <Text code>{c.name || '未知工具'}</Text>
                {/* 片段声明：只说读得到的两个数（原文字数=服务端量、显示字数=本地量）。
                    "展开全文"这种动作还没有入口，所以这里**不写**任何可展开的承诺。 */}
                <Text type="secondary" style={{fontSize: 12}}>
                  {toolResultScopeNote(c, process?.toolResults).text}
                </Text>
                {/*
                  入参这一行只转达 `toolArgsView` 的结论：未记录 / 无入参 / 被服务端截断（真实字数）。
                  判断不在这里，所以组件不需要渲染测试来证明它没说错话。
                */}
                <Text type="secondary" style={{fontSize: 12}}>
                  {(() => {
                    const av = toolArgsView(c);
                    if (!av.recorded) return av.note;
                    return [av.preview ? `入参 ${av.preview}` : '', av.note].filter(Boolean).join(' · ') || '无入参';
                  })()}
                </Text>
              </Flex>
            ),
            children: <ToolCallResult call={c} process={process} load={toolResultLoader?.(c)}/>,
          }))}
        />
      ),
    });
  }

  if (finalSources.length) {
    items.push({
      key: 'sources',
      title: `引用来源 ${finalSources.length} 条`,
      icon: <LinkOutlined/>,
      status: 'success',
      collapsible: true,
      content: (
        <Sources
          inline={false}
          items={finalSources.map((s, i) => ({
            key: s.resCode || i + 1,
            title: s.title,
            url: s.url || undefined,
            description: s.resCode ? `资源标识 ${s.resCode}` : undefined,
          }))}
        />
      ),
    });
  }

  if (candidates.length) {
    items.push({
      key: 'skills',
      title: `候选技能 ${candidates.length} 个`,
      description: process?.toolChoice ? `tool_choice: ${process.toolChoice}` : undefined,
      status: 'success',
      collapsible: true,
      content: (
        <Flex gap={4} wrap>
          {candidates.map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
          {(skills?.loadedDetails || []).length > 0 && (
            <Tag color="blue">已展开：{(skills?.loadedDetails || []).join('、')}</Tag>
          )}
        </Flex>
      ),
    });
  }

  if (usage?.total !== undefined && usage?.budget) {
    const pct = Math.min(100, Math.round(((usage.total || 0) / usage.budget) * 100));
    items.push({
      key: 'context',
      title: `上下文 ${usage.total}/${usage.budget} tokens（${pct}%）`,
      status: (usage.droppedCount || 0) > 0 ? 'error' : 'success',
      description: (usage.droppedCount || 0) > 0 ? `因超窗丢弃 ${usage.droppedCount} 条历史` : undefined,
      collapsible: true,
      content: (
        <Flex gap={4} wrap>
          {(['system', 'fixed', 'history', 'current'] as const).map((k) => (
            <Tag key={k}>
              {k} {usage[k] ?? 0}
            </Tag>
          ))}
        </Flex>
      ),
    });
  }

  return (
    <Flex vertical gap={4}>
      {fromCache && <Tag color="gold">来自缓存</Tag>}
      <ThoughtChain items={items} line="dashed"/>
    </Flex>
  );
};

export default ProcessPanel;
