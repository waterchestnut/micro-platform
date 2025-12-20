// @ts-ignore
/* eslint-disable */

import {ResponseStructure, appRequest} from '@/services/request'

/** 获取模块权限列表 */
export async function getClientPrivList(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi-priv/list', {
    method: 'GET',
    params: {clientCode}
  })
  return ret.data || []
}

/** 添加模块权限 */
export async function addClientPriv(clientCode: string, params: any, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-priv/add', {
    method: 'POST',
    params: {clientCode},
    data: params
  })
}

/** 删除模块权限 */
export async function deleteClientPriv(clientCode: string, modulePrivCode: string, relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-priv/delete', {
    method: 'POST',
    params: {clientCode},
    data: {modulePrivCode}
  })
}

/** 获取应用的角色权限列表 */
export async function getGroupPrivsList(clientCode: string, relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi-priv/group/list', {
    method: 'GET',
    params: {clientCode}
  })
  return ret.data || []
}

/** 保存用户组权限 */
export async function saveGroupPrivs(clientCode: string, groupCode: string, modulePrivCodes: string[], relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-priv/group/save-priv', {
    method: 'POST',
    params: {clientCode},
    data: {groupCode, modulePrivCodes}
  })
}

/** 获取应用授权给其他应用的权限列表 */
export async function getOtherClientPrivsList(clientCode: string, toClientCodes: string[], relativeUrl = '') {
  let ret = await appRequest(relativeUrl || '/core/client/ipmi-priv/other-client/list', {
    method: 'POST',
    params: {clientCode},
    data: {toClientCodes}
  })
  return ret.data || []
}

/** 保存给其他应用分配的权限 */
export async function saveOtherClientPrivs(clientCode: string, toClientCode: string, modulePrivCodes: string[], relativeUrl = '') {
  return appRequest(relativeUrl || '/core/client/ipmi-priv/other-client/save-priv', {
    method: 'POST',
    params: {clientCode},
    data: {toClientCode, modulePrivCodes}
  })
}
