// @ts-ignore
/* eslint-disable */

import {ResponseStructure, appRequest} from '@/services/request'

/** 获取应用列表 */
export async function getClientList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加应用 */
export async function addClient(params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/add', {
    method: 'POST',
    data: params
  })
}

/** 修改应用 */
export async function updateClient(params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi/update', {
    method: 'POST',
    data: params,
    params: {clientCode: params.clientCode}
  })
}

/** 删除应用 */
export async function deleteClient(clientCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi/delete', {
    method: 'POST',
    data: {clientCode}
  })
}

/** 启用应用 */
export async function enableClient(clientCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi/enable', {
    method: 'POST',
    data: {clientCode}
  })
}

/** 禁用应用 */
export async function disableClient(clientCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi/disable', {
    method: 'POST',
    data: {clientCode}
  })
}

/** 获取应用基本信息 */
export async function getClient(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi/detail', {
    method: 'GET',
    params: {clientCode}
  })

  return ret?.data
}

/** 获取应用在授权中心的基本信息 */
export async function getUcenterClient(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi/ucenter/detail', {
    method: 'GET',
    params: {clientCode}
  })

  return ret?.data
}

/** 保存应用在授权中心的信息 */
export async function saveUcenterClient(params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi/ucenter/save', {
    method: 'POST',
    data: params,
    params: {clientCode: params.clientCode}
  })
}
