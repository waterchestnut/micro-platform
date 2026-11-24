// @ts-ignore
/* eslint-disable */

import {appRequest, ResponseStructure} from '@/services/request'

/** 获取PC端桌面小组件 */
export async function getPCWidgets(): Promise<APPAPI.Widget[]> {
  let ret = await appRequest('/core/home/widget/list', {
    method: 'GET',
    skipErrorHandler: true,
    params: {homeEndpoint: 'pc'}
  })
  return ret?.data || []
}

/** 批量保存用户首页小组件排布（顺序即 order） */
export async function saveHomeWidgets(widgetCodes: string[]): Promise<void> {
  await appRequest('/core/home/widget/batch/save', {
    method: 'POST',
    data: {widgetCodes, homeEndpoint: 'pc'}
  })
}

/** 添加小组件到用户首页 */
export async function addHomeWidget(widgetCode: string): Promise<void> {
  await appRequest('/core/home/widget/add', {
    method: 'POST',
    data: {widgetCode, homeEndpoint: 'pc'}
  })
}

/** 从用户首页移除小组件 */
export async function removeHomeWidget(widgetCode: string): Promise<void> {
  await appRequest('/core/home/widget/remove', {
    method: 'POST',
    data: {widgetCode, homeEndpoint: 'pc'}
  })
}

/** 获取可添加的小组件全集（公开目录，按 clientCode 分组用） */
export async function getShowWidgets(clientCode?: string): Promise<APPAPI.Widget[]> {
  let ret = await appRequest('/public-bin/widget/show/pc', {
    method: 'GET',
    skipErrorHandler: true,
    params: {clientCode}
  })
  return ret?.data || []
}
