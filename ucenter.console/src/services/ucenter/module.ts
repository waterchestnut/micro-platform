// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取功能模块列表 */
export async function getModuleList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/auth/module/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加功能模块 */
export async function addModule(params: any) {
  return ucenterRequest('/auth/module/add', {
    method: 'POST',
    data: params
  });
}

/** 修改功能模块 */
export async function updateModule(params: any) {
  return ucenterRequest('/auth/module/update', {
    method: 'POST',
    data: params
  });
}

/** 删除功能模块 */
export async function deleteModule(moduleCode: string) {
  return ucenterRequest('/auth/module/delete', {
    method: 'POST',
    data: {moduleCode}
  });
}
