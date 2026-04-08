import {AbstractChatProvider, TransformMessage, XRequestOptions} from '@ant-design/x-sdk'

export type CommonChatInput = {
  query: string;
  conversationCode: string;
  options?: {
    channel?: 'xxzx_common',
    channelGroup?: string;
    inputs?: any[];
    cache?: number;
    channelCacheKey?: string;
    messageCode?: string;
    attachments?: any[];
  };
  messages?: CommonChatMessage[];
};

export type CommonChatOutput = {
  event: string;
  data: string;
};

export type CommonChatMessage = {
  content: string | any[];
  role: 'my' | 'ai' | 'system' | 'user' | 'divider' | 'notice';
  messageCode?: string;
  attachments?: any[];
  answerFeedback?: number;
  answerReasoning?: string;
};

class CommonChatProvider<
  ChatMessage extends CommonChatMessage = CommonChatMessage,
  Input extends CommonChatInput = CommonChatInput,
  Output extends CommonChatOutput = CommonChatOutput,
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
      role: 'my',
    }]) as ChatMessage[]
  }

  transformMessage(info: TransformMessage<ChatMessage, Output>): ChatMessage {
    const {originMessage, chunk} = info || {}
    if (!chunk) {
      return {
        ...originMessage,
        content: originMessage?.content || '',
        role: 'ai',
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
          role: 'ai',
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
    /*console.log(messageCode)*/
    return {
      content: `${originMessage?.content || ''}${currentContent}`,
      role: 'ai',
      messageCode,
      answerReasoning:`${originMessage?.answerReasoning || ''}${currentThink}`
    } as ChatMessage
  }
}

export default CommonChatProvider
