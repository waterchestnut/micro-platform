// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取地区列表 */
export async function getRegionList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/region/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加地区 */
export async function addRegion(params: any) {
  return ucenterRequest('/core/region/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改地区 */
export async function updateRegion(params: any) {
  return ucenterRequest('/core/region/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除地区 */
export async function deleteRegion(regionCode: string) {
  return ucenterRequest('/core/region/ipmi/delete', {
    method: 'POST',
    data: {regionCode}
  });
}
