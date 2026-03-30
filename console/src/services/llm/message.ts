/**
 * @fileOverview 会话消息历史相关的接口调用
 * @author xianyang
 * @module
 */

import {llmRequest} from '@/services/request'

/** 获取消息列表 */
export async function getMessageList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await llmRequest('/core/message/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 对会话信息反馈 */
export async function feedback(messageCode: string, like: number) {
  let ret = await llmRequest('/core/message/feedback', {
    method: 'POST',
    data: {messageCode, like}
  })
  return ret
}
