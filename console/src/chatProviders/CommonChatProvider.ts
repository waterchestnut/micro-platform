import {AbstractChatProvider, TransformMessage, XRequestOptions} from '@ant-design/x-sdk';

export const CHANNEL_COMMON = 'micro_common';

/** 与后端协商的 SSE 事件协议版本，见 llm.api/docs/api/chat-sse.md */
export const CHAT_PROTOCOL = 2;

/** 单个工具调用 */
export type ChatToolCall = {
  id: string;
  name?: string | null;
  /** 结果原文，可能很长，渲染时自行截断 */
  result?: string;
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
          calls[idx] = {...calls[idx], result: payload.content, name: payload.tool || calls[idx].name, status: 'done'};
        } else {
          calls.push({id, name: payload.tool || null, result: payload.content, status: 'done'});
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

      case 'delta':
      default: {
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
    }
  }
}

export {asText};
export default CommonChatProvider;
