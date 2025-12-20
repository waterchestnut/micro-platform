import {AbstractChatProvider, TransformMessage, XRequestOptions} from '@ant-design/x-sdk'

// 类型定义
export type LiteratureChatInput = {
  query: string;
  conversationCode: string;
  options?: {
    channel?: 'pdfviewer_literature',
    channelGroup?: string;
    ragParams?: { resCode: string; },
    inputs?: any[];
    cache?: number;
    channelCacheKey?: string;
  };
  messages?: LiteratureChatMessage[];
};

export type LiteratureChatOutput = {
  event: string;
  data: string;
};

export type LiteratureChatMessage = {
  content: string | any[];
  role: 'user' | 'assistant';
  messageCode?: string;
  answerFeedback?: string;
};

class LiteratureChatProvider<
  ChatMessage extends LiteratureChatMessage = LiteratureChatMessage,
  Input extends LiteratureChatInput = LiteratureChatInput,
  Output extends LiteratureChatOutput = LiteratureChatOutput,
> extends AbstractChatProvider<ChatMessage, Input, Output> {
  transformParams(requestParams: Partial<Input>, options: XRequestOptions<Input, Output>): Input {
    if (typeof requestParams !== 'object') {
      throw new Error('请求对象必须是一个对象')
    }
    delete requestParams?.messages
    /*console.log(requestParams, options)*/
    return {
      ...(options?.params || {}),
      ...(requestParams || {}),
    } as Input
  }

  transformLocalMessage(requestParams: Partial<Input>): ChatMessage[] {
    return (requestParams.messages || [{
      content: requestParams.query,
      role: 'user',
    }]) as ChatMessage[]
  }

  transformMessage(info: TransformMessage<ChatMessage, Output>): ChatMessage {
    const {originMessage, chunk} = info || {}
    if (!chunk) {
      return {
        ...originMessage,
        content: originMessage?.content || '',
        role: 'assistant',
      } as ChatMessage
    }
    let currentContent = ''
    let currentThink = ''
    let messageCode = ''
    try {
      if (chunk.event === 'error') {
        return {
          ...originMessage,
          content: chunk.data || '处理出错，请稍后重试！',
          role: 'assistant',
        } as ChatMessage
      }
      if (chunk.data && chunk.data !== 'done') {
        const message = JSON.parse(chunk?.data)
        messageCode = message.messageCode
        currentThink = message?.reasoning_content || ''
        currentContent = message?.content || ''
      }
    } catch (error) {
      console.error(error)
    }

    let content = ''

    if (!originMessage?.content && currentThink) {
      content = `<think>${currentThink}`
    } else if (
      originMessage?.content?.includes('<think>') &&
      !originMessage?.content.includes('</think>') &&
      currentContent
    ) {
      content = `${originMessage?.content}</think>${currentContent}`
    } else {
      content = `${originMessage?.content || ''}${currentThink}${currentContent}`
    }
    /*console.log(messageCode)*/
    return {
      content: content,
      role: 'assistant',
      messageCode,
    } as ChatMessage
  }
}

export default LiteratureChatProvider
