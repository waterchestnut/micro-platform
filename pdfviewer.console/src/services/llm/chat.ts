/**
 * @fileOverview 大模型对话相关的接口调用
 * @author xianyang
 * @module
 */

import {llmRequest} from '@/services/request'

/*执行流式对话*/
export async function execChat(query: string, conversationCode: string, options: any): Promise<any> {
  // @ts-ignore
  return fetch(`${LLM_API_BASE}/core/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      conversationCode,
      options,
    }),
  })
}
