// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取机构列表 */
export async function getOrgList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/org/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加机构 */
export async function addOrg(params: any) {
  return ucenterRequest('/core/org/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改机构 */
export async function updateOrg(params: any) {
  return ucenterRequest('/core/org/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除机构 */
export async function deleteOrg(orgCode: string) {
  return ucenterRequest('/core/org/ipmi/delete', {
    method: 'POST',
    data: {orgCode}
  });
}
