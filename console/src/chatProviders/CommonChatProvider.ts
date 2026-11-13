import {AbstractChatProvider, TransformMessage, XRequestOptions} from '@ant-design/x-sdk';
import {applySegmentEnd, applySegmentStart, ChatSegment} from './segments';

export const CHANNEL_COMMON = 'micro_common';

/**
 * 与后端协商的 SSE 事件协议版本，见 llm.api/docs/api/chat-sse.md。
 *
 * 3 相对 2 的全部内容差异就是 `segment_start` / `segment_end` 两个事件
 * （服务端判据：`llmLoop.js:resolveProtocol` 里 `emitSegments: protocol >= 3`）。
 * 这一版从 2 升到 3 是有意的：**不升就没有分段视图可长**——服务端不会向协议 2 的客户端发段事件。
 * 代价是这里开始依赖服务端的段语义，所以段的判定一律走 `segments.ts` 的纯函数，组件不自己猜。
 */
export const CHAT_PROTOCOL = 3;

/** 单个工具调用 */
export type ChatToolCall = {
  id: string;
  name?: string | null;
  /** 结果原文，可能很长，渲染时自行截断 */
  result?: string;
  /**
   * 入参三字段自 llm.api PR-H H1 起才有。
   * **键缺失与 argsChars=0 是两件事**：前者是"当时没记录"（存量行），后者是"确实传了空入参"。
   * 怎么说不撒谎的判据在 `segments.ts:toolArgsView`，组件里不要自己拼这句话。
   */
  args?: string;
  argsChars?: number;
  argsTruncated?: boolean;
  status: 'pending' | 'done';
};

/** RAG 引用来源 */
export type ChatSource = {
  resCode?: string | null;
  title: string;
  url?: string | null;
  ragCode?: string | null;
};

export type ChatContextUsage = {
  system?: number;
  fixed?: number;
  history?: number;
  current?: number;
  total?: number;
  budget?: number;
  droppedCount?: number;
};

export type ChatProcessInfo = {
  iterationCount?: number;
  tools?: string[];
  toolChoice?: string;
  answerRounds?: number;
  skills?: {
    candidates?: string[];
    loadedDetails?: string[];
    toolCount?: number;
    matchedCount?: number;
  };
  contextUsage?: ChatContextUsage | null;
  sources?: ChatSource[];
  toolCalls?: {id: string; name?: string | null}[];
  /** 循环怎么退出的（break / exhausted / aborted:<站点> …）；解释空答案用 */
  loopExit?: string | null;
  forcedFinal?: boolean;
  /** 中断归因：client-disconnect / shutdown-draining / process-lost（不是"谁写的这行"，那是 writtenBy，视图不给） */
  interruptedBy?: string | null;
  /**
   * 遗弃回填行估计丢失的字符数。
   * **只有 `> 0` 才是事实**：历史数据里存在 `0`（当时的回填把"没估过"写成了 0），
   * 所以 0 与 null 都表示"不知道"，判据在 `segments.ts:lostCharsText`。
   */
  lostChars?: number | null;
  /** 过程分段（协议 3 的边界在库里的权威副本；数据本身与协议版本无关，一直在落库） */
  segments?: ChatSegment[];
  segmentSummary?: {count?: number; processChars?: number; dropped?: {count?: number; chars?: number}} | null;
  usage?: {promptTokens?: number; completionTokens?: number; totalTokens?: number; hasUsage?: boolean; modelCalls?: number; callAlert?: string} | null;
  /**
   * 被裁工具结果的**量级摘要**（llm.api PR-H H3 起有；正文不在这里，走 /core/message/tool-result）。
   * `chars`=原文真实字符数、`stored`=全文是否留住（缺键=不知道）。
   * 界面怎么据此说话由 `segments.ts:toolResultScopeNote` 决定，组件不自己拼字数。
   */
  toolResults?: {ref?: string | null; tool?: string | null; chars?: number | null; stored?: boolean | null; originalTokens?: number | null; keptTokens?: number | null}[];
};

export type CommonChatInput = {
  query: string;
  conversationCode: string;
  options?: {
    channel?: typeof CHANNEL_COMMON;
    channelGroup?: string;
    inputs?: any[];
    cache?: number;
    channelCacheKey?: string;
    messageCode?: string;
    attachments?: any[];
    enableThinking?: number;
    protocol?: number;
    /**
     * P3：本轮是对哪条回答的重新生成（服务端 schema 已声明这个键）。
     * 带它时服务端不读也不写答案缓存，并把来源写进档案与视图；
     * 类型缺了就只能 `as any` 传，那是契约分叉的开始。
     */
    regeneratedFrom?: string;
  };
  messages?: CommonChatMessage[];
};

export type CommonChatOutput = {
  event: string;
  data: string;
};

export type ChatStreamState = 'streaming' | 'done' | 'aborted' | 'error';

export type CommonChatMessage = {
  content: string | any[];
  role: 'my' | 'ai' | 'system' | 'user' | 'divider' | 'notice';
  messageCode?: string;
  attachments?: any[];
  answerFeedback?: number;
  answerReasoning?: string;
  /** 本轮实际发生的工具调用 */
  toolCalls?: ChatToolCall[];
  /** 本轮 RAG 的真实引用来源 */
  sources?: ChatSource[];
  /** 执行过程统计，历史消息由 /core/message/list 的 process 字段回填 */
  process?: ChatProcessInfo;
  /**
   * 协议 3 的过程分段（流式累积）。
   * 历史行不复制这个字段——直接读 `process.segments`，避免两处真相。
   */
  segments?: ChatSegment[];
  streamState?: ChatStreamState;
  errorText?: string;
  fromCache?: boolean;
};

const MAX_REASONING_HINT = 4000;

function safeParse(data?: string): any {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function asText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
      .join('');
  }
  return '';
}

class CommonChatProvider<
  ChatMessage extends CommonChatMessage = CommonChatMessage,
  Input extends CommonChatInput = CommonChatInput,
  Output extends CommonChatOutput = CommonChatOutput,
> extends AbstractChatProvider<ChatMessage, Input, Output> {
  transformParams(requestParams: Partial<Input>, options: XRequestOptions<Input, Output>): Input {
    if (typeof requestParams !== 'object') {
      throw new Error('请求对象必须是一个对象');
    }
    delete requestParams?.messages;
    return {
      ...(options?.params || {}),
      ...(requestParams || {}),
      options: {
        ...((options?.params as any)?.options || {}),
        ...((requestParams as any)?.options || {}),
        protocol: (requestParams as any)?.options?.protocol ?? CHAT_PROTOCOL,
      },
    } as Input;
  }

  transformLocalMessage(requestParams: Partial<Input>): ChatMessage[] {
    return (requestParams.messages || [
      {
        content: requestParams.query,
        role: 'my',
      },
    ]) as ChatMessage[];
  }

  /**
   * 按 SSE 事件名分派。协议 2 之后不得再用 data 里的字段猜测语义，
   * 尤其不能把 tool_result / reset 的 content 拼进答案正文。
   */
  transformMessage(info: TransformMessage<ChatMessage, Output>): ChatMessage {
    const {originMessage, chunk} = info || ({} as any);
    const base: CommonChatMessage = {
      ...(originMessage || {}),
      content: originMessage?.content ?? '',
      role: 'ai',
    };

    if (!chunk) {
      return {
        ...base,
        content: base.content || '',
        streamState: base.streamState === 'streaming' || !base.streamState ? 'done' : base.streamState,
      } as ChatMessage;
    }

    if (chunk.event === 'error') {
      return {
        ...base,
        errorText: chunk.data || '处理出错，请稍后重试！',
        streamState: 'error',
      } as ChatMessage;
    }

    if (chunk.event === 'done') {
      return {...base, streamState: 'done'} as ChatMessage;
    }

    if (chunk.event === 'abort') {
      return {...base, streamState: 'aborted'} as ChatMessage;
    }

    const payload = safeParse(chunk.data);
    if (!payload) {
      return base as ChatMessage;
    }

    switch (chunk.event) {
      case 'meta': {
        return {
          ...base,
          messageCode: payload.messageCode || base.messageCode,
          fromCache: !!payload.cached,
          process: {
            ...(base.process || {}),
            tools: payload.tools || [],
            toolChoice: payload.toolChoice,
            contextUsage:
              payload.contextBudget && !base.process?.contextUsage
                ? {...(base.process?.contextUsage || {}), budget: payload.contextBudget}
                : base.process?.contextUsage,
          },
        } as ChatMessage;
      }

      case 'sources': {
        const sources: ChatSource[] = Array.isArray(payload.sources) ? payload.sources : [];
        return {
          ...base,
          sources,
          process: {...(base.process || {}), sources},
        } as ChatMessage;
      }

      case 'tool_result': {
        const calls: ChatToolCall[] = [...(base.toolCalls || [])];
        const id = payload.tool_call_id || `tool-${calls.length}`;
        const idx = calls.findIndex((c) => c.id === id);
        if (idx >= 0) {
          calls[idx] = {...calls[idx], result: payload.content, args: payload.args, argsChars: payload.argsChars, argsTruncated: payload.argsTruncated, name: payload.tool || calls[idx].name, status: 'done'};
        } else {
          calls.push({id, name: payload.tool || null, result: payload.content, args: payload.args, argsChars: payload.argsChars, argsTruncated: payload.argsTruncated, status: 'done'});
        }
        return {...base, toolCalls: calls} as ChatMessage;
      }

      case 'reset': {
        /*丢弃已累积的答案正文：本轮发生过工具调用，之前的文本是中间产物。
          思考文本服务端不重置，是否保留由前端决定，这里保留。*/
        const rounds = (base.process?.answerRounds || 0) + 1;
        return {
          ...base,
          content: '',
          process: {...(base.process || {}), answerRounds: rounds},
        } as ChatMessage;
      }

      case 'segment_start': {
        return {...base, segments: applySegmentStart(base.segments || [], payload)} as ChatMessage;
      }

      case 'segment_end': {
        return {...base, segments: applySegmentEnd(base.segments || [], payload)} as ChatMessage;
      }

      case 'delta': {
        /*旧版服务端把 reset 当作 delta 下发，这里保留哨兵识别，使前端可先于服务端上线*/
        if (payload.tool_call_id === 'clear_answer_content') {
          const rounds = (base.process?.answerRounds || 0) + 1;
          return {
            ...base,
            content: '',
            process: {...(base.process || {}), answerRounds: rounds},
          } as ChatMessage;
        }
        const content = typeof payload.content === 'string' ? payload.content : '';
        const reasoning = typeof payload.reasoning_content === 'string' ? payload.reasoning_content : '';
        const nextReasoning = `${base.answerReasoning || ''}${reasoning}`;
        return {
          ...base,
          content: `${asText(base.content) || ''}${content}`,
          answerReasoning: nextReasoning.length > MAX_REASONING_HINT ? nextReasoning : reasoning ? nextReasoning : base.answerReasoning,
          messageCode: payload.messageCode || base.messageCode,
          streamState: base.streamState || 'streaming',
        } as ChatMessage;
      }

      default: {
        /**
         * 未知事件名**不再并入正文**。原先这里与 `delta` 共用一个分支，
         * 等于"服务端每新增一种事件，旧前端就多一种把结构体当答案拼出来的风险"——
         * 协议 3 加 `segment_*` 时恰好就是这样：现在有了显式分支，兜底才敢改成"忽略"。
         */
        return base as ChatMessage;
      }
    }
  }
}

export {asText};
export default CommonChatProvider;
