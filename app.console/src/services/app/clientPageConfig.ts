// @ts-ignore
/* eslint-disable */

import {ResponseStructure, appRequest} from '@/services/request'

/** 获取应用的路由权限列表 */
export async function getClientPageConfigList(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi-page/list', {
    method: 'GET',
    params: {clientCode}
  })
  return ret.data || []
}

/** 保存应用的路由权限 */
export async function saveClientPageConfig(clientCode: string, pageConfigs: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-page/save', {
    method: 'POST',
    params: {clientCode},
    data: {pageConfigs}
  })
}
