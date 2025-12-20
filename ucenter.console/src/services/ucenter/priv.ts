// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取功能权限列表 */
export async function getPrivList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/auth/priv/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加功能权限 */
export async function addPriv(params: any) {
  return ucenterRequest('/auth/priv/add', {
    method: 'POST',
    data: params
  });
}

/** 修改功能权限 */
export async function updatePriv(params: any) {
  return ucenterRequest('/auth/priv/update', {
    method: 'POST',
    data: params
  });
}

/** 删除功能权限 */
export async function deletePriv(modulePrivCode: string) {
  return ucenterRequest('/auth/priv/delete', {
    method: 'POST',
    data: {modulePrivCode}
  });
}
