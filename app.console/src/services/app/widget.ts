// @ts-ignore
/* eslint-disable */

import {ResponseStructure, appRequest} from '@/services/request'

/** 获取小组件列表 */
export async function getWidgetList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/widget/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加小组件 */
export async function addWidget(params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/widget/add', {
    method: 'POST',
    data: params
  })
}

/** 修改小组件 */
export async function updateWidget(params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/widget/ipmi/update', {
    method: 'POST',
    data: params,
    params: {widgetCode: params.widgetCode}
  })
}

/** 删除小组件 */
export async function deleteWidget(widgetCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/widget/ipmi/delete', {
    method: 'POST',
    data: {widgetCode}
  })
}

/** 启用小组件 */
export async function enableWidget(widgetCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/widget/ipmi/enable', {
    method: 'POST',
    data: {widgetCode}
  })
}

/** 禁用小组件 */
export async function disableWidget(widgetCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/widget/ipmi/disable', {
    method: 'POST',
    data: {widgetCode}
  })
}

/** 获取小组件基本信息 */
export async function getWidget(widgetCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/widget/ipmi/detail', {
    method: 'GET',
    params: {widgetCode}
  })

  return ret?.data
}