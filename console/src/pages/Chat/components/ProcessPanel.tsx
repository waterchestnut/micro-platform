import {Collapse, Flex, Tag, Typography} from 'antd';
import {Sources, ThoughtChain} from '@ant-design/x';
import type {ThoughtChainItemType} from '@ant-design/x';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  LinkOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type {ChatProcessInfo, ChatSource, ChatToolCall} from '@/chatProviders/CommonChatProvider';

const {Text} = Typography;

/** 工具结果原文可能很长，面板内先截断，展开再由用户决定 */
const RESULT_PREVIEW = 600;

function truncate(text?: string) {
  if (!text) return '';
  return text.length > RESULT_PREVIEW ? `${text.slice(0, RESULT_PREVIEW)}…（共 ${text.length} 字）` : text;
}

function tryPretty(text?: string) {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export type ProcessPanelProps = {
  process?: ChatProcessInfo;
  toolCalls?: ChatToolCall[];
  sources?: ChatSource[];
  fromCache?: boolean;
};

/**
 * 展示本轮真实执行过程：工具调用、迭代轮次、技能、上下文用量与引用来源。
 * 数据全部来自协议 2 的事件与 /core/message/list 的 process 字段，不使用占位样例。
 */
const ProcessPanel = ({process, toolCalls, sources, fromCache}: ProcessPanelProps) => {
  const calls: ChatToolCall[] = toolCalls?.length
    ? toolCalls
    : (process?.toolCalls || []).map((t) => ({id: t.id, name: t.name, status: 'done' as const}));
  const finalSources = sources?.length ? sources : (process?.sources || []);
  const usage = process?.contextUsage;
  const skills = process?.skills;
  const candidates = skills?.candidates || [];

  if (!calls.length && !finalSources.length && !candidates.length && !usage && !fromCache) {
    return null;
  }

  const items: ThoughtChainItemType[] = [];

  if (calls.length) {
    items.push({
      key: 'tools',
      title: `调用工具 ${calls.length} 次`,
      description: process?.iterationCount && process.iterationCount > 1 ? `模型往返 ${process.iterationCount} 轮` : undefined,
      icon: <ThunderboltOutlined/>,
      status: 'loading',
      collapsible: true,
      content: (
        <Collapse
          size="small"
          ghost
          items={calls.map((c, i) => ({
            key: c.id || String(i),
            label: (
              <Flex align="center" gap="small">
                {c.status === 'pending' ? <LoadingOutlined/> : <CheckCircleOutlined style={{color: '#52c41a'}}/>}
                <Text code>{c.name || '未知工具'}</Text>
              </Flex>
            ),
            children: (
              <pre style={{whiteSpace: 'pre-wrap', margin: 0, fontSize: 12, maxHeight: 260, overflow: 'auto'}}>
                {truncate(tryPretty(c.result)) || '（无返回内容）'}
              </pre>
            ),
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
