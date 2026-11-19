/**
 * @fileOverview Message Part 渲染器（Agent UI 演进刀 A 的渲染面）
 * @module pages/Chat/components/MessageParts
 * @description
 * 调研对照（文章第四/十二章）：消息按 Part 类型选**受控组件**渲染，不执行模型给的任意 UI；
 * 本组件只做"parts → 组件"的映射——顺序、剔除、计数、归一全在 `messageParts.ts`（穷举测过），
 * 这里出错最多是样式问题，不会是事实问题。
 *
 * 依赖注入纪律（TaskCard 同款）：text 渲染器由调用方注入（生产=XMarkdown，测试=div）——
 * x-markdown/mermaid 的 ESM 链进不了 jest，判据与渲染都必须可在无三方链下被真跑。
 */
import React from 'react';
import {Collapse, Flex, Tag, Typography} from 'antd';
import type {MessagePart, PlanStepStatus} from '@/chatProviders/messageParts';
import {toolBusinessLabel} from '@/chatProviders/toolSemantics';
import {artifactDisplayName, formatArtifactSize} from '@/chatProviders/artifactView';

const {Text} = Typography;

/**
 * 状态符号用彩色字符而非 @ant-design/icons——icons@6 是 ESM-only，进不了本仓 jest
 * （ProcessPanel 跑不了组件测试的同款依赖链；MessageParts 必须可测，所以不引它）。
 */
const STEP_MARK: Record<PlanStepStatus, {ch: string; color: string}> = {
  pending: {ch: '○', color: '#bbb'},
  in_progress: {ch: '◐', color: '#1677ff'},
  done: {ch: '✓', color: '#52c41a'},
  failed: {ch: '✗', color: '#ff4d4f'},
  abandoned: {ch: '⊘', color: '#999'},
}

export type MessagePartsProps = {
  parts: MessagePart[];
  /** 正文渲染注入（生产=XMarkdown 包装；测试=纯文本 div） */
  renderText: (text: string) => React.ReactNode;
  /** 工具块的业务语义映射（缺省=toolSemantics 表；未知回退原名） */
  toolLabel?: (name?: string | null, status?: string) => string;
  /** 产物卡"打开"回调（生产=唤起工作区 Drawer；缺省不渲染按钮——无工作区时不吊空指针） */
  onOpenArtifact?: (artifactCode: string) => void;
};

const PlanCard = ({steps, done, total, note}: {steps: any[]; done: number; total: number; note?: string}) => (
  <div style={{border: '1px solid #eee', borderRadius: 8, padding: '6px 10px', margin: '4px 0'}}>
    <Flex justify="space-between" align="center">
      <Text strong style={{fontSize: 13}}>执行计划</Text>
      <Text type="secondary" style={{fontSize: 12}}>{done} / {total}</Text>
    </Flex>
    {note ? <div><Text type="secondary" style={{fontSize: 12}}>{note}</Text></div> : null}
    {steps.map((s: any, i: number) => (
      <div key={s.id || i} style={{fontSize: 13, lineHeight: '22px', overflowWrap: 'anywhere'}}>
        <span style={{color: (STEP_MARK[s.status as PlanStepStatus] || STEP_MARK.pending).color, marginRight: 6}}>
          {(STEP_MARK[s.status as PlanStepStatus] || STEP_MARK.pending).ch}
        </span>
        <span style={{
          // 终局条目降饱和：视线该停在 in_progress 与 pending 上（架构图"执行计划"块的同款读法）
          color: s.status === 'done' ? '#666' : s.status === 'in_progress' ? '#111' : s.status === 'failed' ? '#d4380d' : '#888',
          textDecoration: s.status === 'abandoned' ? 'line-through' : 'none',
        }}>{s.title}</span>
      </div>
    ))}
  </div>
)

const ToolsBlock = ({calls, toolLabel}: {calls: any[]; toolLabel?: (n?: string | null, s?: string) => string}) => (
  <Collapse
    ghost
    size="small"
    defaultActiveKey={['t']}
    style={{margin: '2px -8px'}}
    items={[{
      key: 't',
      label: <Text type="secondary" style={{fontSize: 12}}>工具调用</Text>,
      children: (
        <Flex vertical gap={2}>
          {calls.map((c: any, i: number) => (
            <div key={c.id || i} style={{fontSize: 12, overflowWrap: 'anywhere'}}>
              <span style={{color: c.status === 'pending' ? '#1677ff' : c.status === 'failed' ? '#ff4d4f' : '#52c41a', marginRight: 6}}>
                {c.status === 'pending' ? '◐' : c.status === 'failed' ? '✗' : '✓'}
              </span>
              {/* 两层展示（调研第五章）：业务语义行为主，技术名降为次要小字 */}
              <span>{(toolLabel || toolBusinessLabel)(c.name, c.status)}</span>
              {c.name ? <Text type="secondary" style={{fontSize: 11, marginLeft: 6}}>{c.name}</Text> : null}
            </div>
          ))}
        </Flex>
      ),
    }]}
  />
)

/**
 * 产物卡（刀 B，调研第八章）：聊天区只说"生成了什么"，正文承载在工作区 Drawer——
 * 卡片数据全部来自投影（save_artifact 成功回执），这里不查服务端（消息回放零请求）。
 * 显示名/尺寸判据走 artifactView 单源（与工作区列表同口径，防两处漂移）。
 */
const ArtifactCard = ({a, onOpen}: {a: any; onOpen?: (code: string) => void}) => {
  const size = formatArtifactSize(a.sizeBytes)
  return (
    <div style={{border: '1px solid #e6f4ff', background: '#f6fbff', borderRadius: 8, padding: '6px 10px', margin: '4px 0', display: 'flex', alignItems: 'center', gap: 8}}>
      <span style={{fontSize: 15}}>📦</span>
      <div style={{flex: 1, minWidth: 0, overflowWrap: 'anywhere'}}>
        <div style={{fontSize: 13}}><Text strong>已生成《{artifactDisplayName(a)}》</Text></div>
        <Text type="secondary" style={{fontSize: 12}}>
          {[a.kind, size, a.name ? a.artifactCode : null].filter(Boolean).join(' · ')}
        </Text>
      </div>
      {onOpen ? <a onClick={() => onOpen(a.artifactCode)} style={{whiteSpace: 'nowrap'}}>打开</a> : null}
    </div>
  )
}

const SourcesBlock = ({items}: {items: any[]}) => (
  <Flex gap={4} wrap style={{margin: '2px 0'}}>
    {items.map((s: any, i: number) => (
      s.url ? (
        <a key={s.resCode || i} href={s.url} target="_blank" rel="noreferrer">
          <Tag color="blue" style={{maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle'}}>
            {i + 1}. {s.title || s.url}
          </Tag>
        </a>
      ) : (
        <Tag key={s.resCode || i} color="blue">{i + 1}. {s.title || '来源'}</Tag>
      )
    ))}
  </Flex>
)

const MessageParts: React.FC<MessagePartsProps> = ({parts, renderText, toolLabel, onOpenArtifact}) => {
  if (!parts?.length) return null
  return (
    <Flex vertical gap={2}>
      {parts.map((p, i) => {
        switch (p.type) {
          case 'notice':
            return <Text key={i} type="secondary" style={{fontSize: 12}}>{p.text}</Text>
          case 'error':
            return <Text key={i} type="danger" style={{fontSize: 13}}>{p.text}</Text>
          case 'text':
            return <div key={i}>{renderText(p.text)}</div>
          case 'artifact':
            return <ArtifactCard key={i} a={p} onOpen={onOpenArtifact}/>
          case 'plan':
            return <PlanCard key={i} steps={p.steps} done={p.done} total={p.total} note={(p as any).note}/>;
          case 'tools':
            return <ToolsBlock key={i} calls={p.calls} toolLabel={toolLabel}/>
          case 'sources':
            return <SourcesBlock key={i} items={p.items}/>
          default:
            // 未知块型（判据未来扩展而渲染未跟上）⇒ 静默跳过并留可见注释，不猜渲染
            return null
        }
      })}
    </Flex>
  )
}

export default MessageParts
