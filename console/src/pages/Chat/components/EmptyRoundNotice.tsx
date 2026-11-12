/**
 * 这行 `import React` 在本仓组件里是少见的：umi 构建走 automatic JSX runtime，通常不需要它。
 * 加在这里是因为 **jest 那份 esbuild 转换走 classic runtime**——不加就 `ReferenceError: React is not defined`，
 * 组件测试一跑就红。它对构建没有副作用。
 */
import React from 'react';
import { Typography } from 'antd';
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
}: EmptyRoundNoticeProps) => {
  const notice = deriveEmptyRoundNotice({ content, segments, error, process, streamState });
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
  } else if (streamState === 'aborted') {
    body.push(
      <Text key="aborted" type="warning">
        本轮回答已被中断
      </Text>,
    );
  }
  if (resumeNote) {
    body.push(
      <Text key="resume" type="secondary">
        {resumeNote}
      </Text>,
    );
  }
  if (!body.length) {
    return null;
  }
  return <>{body}</>;
};

export default EmptyRoundNotice;
