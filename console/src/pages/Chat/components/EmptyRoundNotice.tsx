/**
 * 这行 `import React` 在本仓组件里是少见的：umi 构建走 automatic JSX runtime，通常不需要它。
 * 加在这里是因为 **jest 那份 esbuild 转换走 classic runtime**——不加就 `ReferenceError: React is not defined`，
 * 组件测试一跑就红。它对构建没有副作用。
 */
import React from 'react';
import { Button, Typography } from 'antd';
import { deriveEmptyRoundNotice, type ChatSegment } from '@/chatProviders/segments';

const { Text } = Typography;

export type EmptyRoundNoticeProps = {
  /** 已渲染的正文（流式累积或历史 answer） */
  content?: string;
  segments?: ChatSegment[];
  /** 视图的 `error` 字段（`abandoned:` 前缀是回填行的凭据） */
  error?: string;
  process?: any;
  streamState?: string;
  /**
   * 续接的结论（由 `resumeOutcomeNote` 生成），单独一行。
   * 不塞进 `errorText`：那个字段同时是"这一轮为什么空"的判据来源，
   * 混进去会把 `abandoned:` 这类前缀判断污染成永远不成立。
   */
  resumeNote?: string;
  /**
   * M8 刀一：编排受理（taskAccepted/queued）的结论行。与 resumeNote 分开的理由同"不塞 errorText"：
   * 两个通道各自表达一种事实（续接的处置 / 后台受理的处置），合并会让"为什么空"的判据互相污染。
   */
  taskNote?: string;
  /**
   * Parts 投影激活时置真（刀 A 去重）：resumeNote/taskNote 文本行已由消息块渲染，
   * 这里不再重复出声——但**空正文归因判据照旧收到这些字段**（derive 的输入不许断供）。
   */
  suppressNotes?: boolean;
  /**
   * PR-G 批二a：ongoing 行的"续接"入口。**由调用方把可用性关在这里**
   * （无游标不传——服务端对缺游标是 400），组件不自判，才可能给出按钮。
   */
  onResume?: () => void;
};

/**
 * 一轮"没有正文"时的说明。
 *
 * 判据不在这里，在 `segments.ts:deriveEmptyRoundNotice`（那张表来自 dev 现网实测）；
 * 这个组件只负责把它显示出来。**分成两半是有意的**：判据要能被穷举测试，
 * 而组件测试只该回答"它有没有把判据的结论渲染出来"。
 *
 * 有正文时：abort 只说"已被中断"，不说"内容不完整"——后者是在替服务端断言它没资格断言的事。
 */
const EmptyRoundNotice = ({
  content,
  segments,
  error,
  process,
  streamState,
  resumeNote,
  taskNote,
  suppressNotes,
  onResume,
}: EmptyRoundNoticeProps) => {
  /** 可用性=按钮在不在，与判据文案同源：调用方没给 onResume（无游标/无 runner）就不许承诺"可续接" */
  const notice = deriveEmptyRoundNotice({
    content,
    segments,
    error,
    process,
    streamState,
    resumeAvailable: !!onResume,
    taskNote,
  });
  /**
   * 空正文说明与续接结论可能同时成立，也可能只有一个成立，所以两者都要独立判断：
   * 早返回会让"有正文但续接失败了"这一种情况一句话都不说——那恰好是用户最需要知道
   * "下面这些是不是全部"的一种。
   */
  const body: React.ReactNode[] = [];
  if (notice) {
    body.push(
      <Text key="empty" type={notice.tone === 'warning' ? 'warning' : 'secondary'}>
        {notice.text}
      </Text>,
    );
    /** PR-G 批二a：ongoing 行的续接入口（run 还在服务端活着，游标由调用方核验过才传进来） */
    if (notice.reason === 'ongoing' && onResume) {
      body.push(
        <Button key="ongoing-resume" type="link" size="small" style={{padding: 0}} onClick={onResume}>
          续接
        </Button>,
      );
    }
  } else if (streamState === 'aborted') {
    body.push(
      <Text key="aborted" type="warning">
        本轮回答已被中断
      </Text>,
    );
  }
  if (resumeNote && !suppressNotes) {
    body.push(
      <Text key="resume" type="secondary">
        {resumeNote}
      </Text>,
    );
  }
  if (taskNote && !suppressNotes) {
    body.push(
      <Text key="task" type="secondary">
        {taskNote}
      </Text>,
    );
  }
  if (!body.length) {
    return null;
  }
  return <>{body}</>;
};

export default EmptyRoundNotice;
