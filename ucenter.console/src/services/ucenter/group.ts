// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取用户组列表 */
export async function getGroupList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/group/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加用户组 */
export async function addGroup(params: any) {
  return ucenterRequest('/core/group/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改用户组 */
export async function updateGroup(params: any) {
  return ucenterRequest('/core/group/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除用户组 */
export async function deleteGroup(groupCode: string) {
  return ucenterRequest('/core/group/ipmi/delete', {
    method: 'POST',
    data: {groupCode}
  });
}
