// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取路由配置列表 */
export async function getPageList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/auth/page/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 保存路由配置 */
export async function savePage(params: any) {
  return ucenterRequest('/auth/page/save', {
    method: 'POST',
    data: params
  });
}

/** 删除路由配置 */
export async function deletePage(pageConfigCode: string) {
  return ucenterRequest('/auth/page/delete', {
    method: 'POST',
    data: {pageConfigCode}
  });
}
