// @ts-ignore
/* eslint-disable */

import {ResponseStructure, appRequest} from '@/services/request'

/** 获取模块列表 */
export async function getClientModuleList(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi-module/list', {
    method: 'GET',
    params: {clientCode}
  })
  return ret.data || []
}

/** 添加模块 */
export async function addClientModule(clientCode: string, params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-module/add', {
    method: 'POST',
    params: {clientCode},
    data: params
  })
}

/** 删除模块 */
export async function deleteClientModule(clientCode: string, moduleCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-module/delete', {
    method: 'POST',
    params: {clientCode},
    data: {moduleCode}
  })
}
