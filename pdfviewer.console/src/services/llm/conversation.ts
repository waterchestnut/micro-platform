/**
 * @fileOverview 会话历史相关的接口调用
 * @author xianyang
 * @module
 */

import {llmRequest} from '@/services/request'

/** 获取会话列表 */
export async function getConversationList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await llmRequest('/core/conversation/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 统计会话信息 */
export async function statConversationByChannelGroup(channel: string | string[], channelGroup: string | string[]) {
  let ret = await llmRequest('/core/conversation/stat-channel-group', {
    method: 'POST',
    data: {channel, channelGroup}
  })
  return ret?.data || []
}
