// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 大模型对话（流式） 大模型对话，以event-stream返回 POST /core/chat/stream */
export async function postCoreChatStream(
  body: {
    /** 用户问题 */
    query?: string;
    /** 会话标识 */
    conversationCode?: string;
    options?: {
      llmModel?: string;
      channel?: string;
      channelGroup?: string;
      llmParams?: { maxTokens?: number };
      ragParams?: { resCode?: string; maxLength?: number; maxTokens?: number };
    };
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 会话列表 获取大模型会话列表 POST /core/conversation/list */
export async function postCoreConversationList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/conversation/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 按照频道分组统计会话信息 按照频道分组统计会话信息 POST /core/conversation/stat-channel-group */
export async function postCoreConversationStatChannelGroup(
  body: {
    channel: string | string[];
    channelGroup: string | string[];
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/conversation/stat-channel-group', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 回答反馈 用户对大模型回答的内容进行反馈 POST /core/message/feedback */
export async function postCoreMessageFeedback(
  body: {
    /** 会话消息标识 */
    messageCode?: string;
    /** -1=不喜欢，0=不作反馈，1-喜欢 */
    like?: number;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/message/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 消息列表 获取大模型会话消息列表 POST /core/message/list */
export async function postCoreMessageList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/message/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
