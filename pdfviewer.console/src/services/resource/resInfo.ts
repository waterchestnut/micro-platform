/**
 * @fileOverview 资源阅读相关的接口调用
 * @author xianyang 2025/11/19
 * @module
 */

import {resourceRequest} from '@/services/request'

/** 获取待阅读的资源文献列表 */
export async function getToReadResList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await resourceRequest('/core/res-info/ipmi/list', {
    method: 'POST',
    data: {filter: {manageType: 'platform', ...filter}, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 获取当前用户已阅读的资源文献列表 */
export async function getMyReadResList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await resourceRequest('/core/res-my/list', {
    method: 'POST',
    data: {
      filter: {...filter, manageType: 'literature'},
      pageIndex,
      pageSize,
      options: {sort: {latestReadTime: -1}, ...options}
    }
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}
