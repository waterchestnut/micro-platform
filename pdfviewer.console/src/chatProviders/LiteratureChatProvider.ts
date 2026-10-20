import {AbstractChatProvider, TransformMessage, XRequestOptions} from '@ant-design/x-sdk';

/** 与后端协商的 SSE 事件协议版本，见 llm.api/docs/api/chat-sse.md */
export const CHAT_PROTOCOL = 2;

export type ChatToolCall = {
  id: string;
  name?: string | null;
  result?: string;
  status: 'pending' | 'done';
};

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

export type LiteratureChatInput = {
  query: string;
  conversationCode: string;
  options?: {
    channel?: 'pdfviewer_literature';
    channelGroup?: string;
    ragParams?: {resCode: string};
    inputs?: any[];
    cache?: number;
    channelCacheKey?: string;
    protocol?: number;
  };
  messages?: LiteratureChatMessage[];
};

export type LiteratureChatOutput = {
  event: string;
  data: string;
};

export type ChatStreamState = 'streaming' | 'done' | 'aborted' | 'error';

export type LiteratureChatMessage = {
  content: string | any[];
  role: 'user' | 'assistant';
  messageCode?: string;
  answerFeedback?: number;
  /** 思考过程独立成字段，不再拼进 content 靠 markdown 标签解析 */
  answerReasoning?: string;
  toolCalls?: ChatToolCall[];
  sources?: ChatSource[];
  process?: ChatProcessInfo;
  streamState?: ChatStreamState;
  errorText?: string;
  fromCache?: boolean;
};

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

class LiteratureChatProvider<
  ChatMessage extends LiteratureChatMessage = LiteratureChatMessage,
  Input extends LiteratureChatInput = LiteratureChatInput,
  Output extends LiteratureChatOutput = LiteratureChatOutput,
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
    return (requestParams.messages || [{
      content: requestParams.query,
      role: 'user',
    }]) as ChatMessage[];
  }

  /**
   * 按 SSE 事件名分派。不再把 tool_result / reset 的 content 拼进答案正文，
   * 也不再靠内联标签把思考过程混进 content 交给 markdown 解析。
   */
  transformMessage(info: TransformMessage<ChatMessage, Output>): ChatMessage {
    const {originMessage, chunk} = info || ({} as any);
    const base: LiteratureChatMessage = {
      ...(originMessage || {}),
      content: originMessage?.content ?? '',
      role: 'assistant',
    };

    if (!chunk) {
      return {
        ...base,
        content: base.content || '',
        streamState: !base.streamState || base.streamState === 'streaming' ? 'done' : base.streamState,
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

    const clearContent = (): ChatMessage => ({
      ...base,
      content: '',
      process: {...(base.process || {}), answerRounds: (base.process?.answerRounds || 0) + 1},
    }) as ChatMessage;

    switch (chunk.event) {
      case 'meta':
        return {
          ...base,
          messageCode: payload.messageCode || base.messageCode,
          fromCache: !!payload.cached,
          process: {
            ...(base.process || {}),
            tools: payload.tools || [],
            toolChoice: payload.toolChoice,
            contextUsage: base.process?.contextUsage,
          },
        } as ChatMessage;

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

      case 'reset':
        return clearContent();

      case 'delta':
      default: {
        /*旧版服务端把 reset 包在 delta 里下发，保留哨兵识别以便前端可先于服务端上线*/
        if (payload.tool_call_id === 'clear_answer_content') {
          return clearContent();
        }
        const content = typeof payload.content === 'string' ? payload.content : '';
        const reasoning = typeof payload.reasoning_content === 'string' ? payload.reasoning_content : '';
        return {
          ...base,
          content: `${asText(base.content)}${content}`,
          answerReasoning: reasoning ? `${base.answerReasoning || ''}${reasoning}` : base.answerReasoning,
          messageCode: payload.messageCode || base.messageCode,
          streamState: base.streamState || 'streaming',
        } as ChatMessage;
      }
    }
  }
}

export default LiteratureChatProvider;
